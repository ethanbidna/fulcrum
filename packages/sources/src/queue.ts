import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { IngestionQueue, SourceScope, SourceItem, QueuedSource, ScopeProgress, QueueCounts } from './interfaces.js';
const SCHEMA_VERSION = '1';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scopes (connector TEXT, id TEXT, label TEXT NOT NULL, cursor TEXT, next TEXT, checked_at TEXT, scanning INTEGER NOT NULL DEFAULT 0, error TEXT, failures INTEGER NOT NULL DEFAULT 0, retry_at TEXT, PRIMARY KEY(connector,id));
CREATE TABLE IF NOT EXISTS items (connector TEXT, scope_id TEXT, remote_id TEXT, hash TEXT, happened_at TEXT NOT NULL, thread_id TEXT, status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(connector,scope_id,remote_id,hash));
`;
export class SqliteIngestionQueue implements IngestionQueue {
  private constructor(private readonly database: DatabaseSync) {}
  static async open(options: { localDirectory: string; workspaceDirectory: string; workspaceId: string }): Promise<SqliteIngestionQueue> {
    const entry = await lstat(options.localDirectory);
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()) throw new Error('INVALID_QUEUE_DIRECTORY');
    const local = await realpath(options.localDirectory); const workspace = await realpath(options.workspaceDirectory);
    const relative = path.relative(workspace, local);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('QUEUE_INSIDE_WORKSPACE');
    const file = path.join(local, 'ingestion.sqlite');
    try { const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error('INVALID_QUEUE_FILE'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = new DatabaseSync(file);
    try {
      await chmod(file, 0o600);
      database.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
      database.exec(SCHEMA);
      const metadata = Object.fromEntries((database.prepare('SELECT key,value FROM metadata').all() as { key: string; value: string }[]).map(row => [row.key, row.value]));
      if (metadata.workspace && metadata.workspace !== options.workspaceId) throw new Error('QUEUE_WORKSPACE_MISMATCH');
      if (metadata.version && metadata.version !== SCHEMA_VERSION) throw new Error('QUEUE_VERSION_UNSUPPORTED');
      const insert = database.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)');
      insert.run('workspace', options.workspaceId); insert.run('version', SCHEMA_VERSION);
      return new SqliteIngestionQueue(database);
    } catch (error) { database.close(); throw error; }
  }
  digest(text: string): string { return createHash('sha256').update(text.normalize('NFC').replaceAll('\r\n', '\n').trim()).digest('hex'); }
  scopes(): ScopeProgress[] {
    const rows = this.database.prepare('SELECT * FROM scopes ORDER BY connector,id').all() as unknown as ScopeRow[];
    return rows.map(row => ({ connector: row.connector, scope: { id: row.id, label: row.label }, cursor: row.cursor, next: row.next,
      checkedAt: row.checked_at, scanning: row.scanning === 1, error: row.error, failures: row.failures, retryAt: row.retry_at }));
  }
  configure(connector: string, scopes: SourceScope[]): void {
    if (!connector || scopes.some(scope => !scope.id || !scope.label) || new Set(scopes.map(scope => scope.id)).size !== scopes.length) throw new Error('INVALID_SCOPES');
    this.transaction(() => {
      const retained = new Set(scopes.map(scope => scope.id));
      for (const previous of this.scopes().filter(scope => scope.connector === connector)) {
        if (retained.has(previous.scope.id)) continue;
        this.database.prepare('DELETE FROM items WHERE connector=? AND scope_id=?').run(connector, previous.scope.id);
        this.database.prepare('DELETE FROM scopes WHERE connector=? AND id=?').run(connector, previous.scope.id);
      }
      for (const scope of scopes) this.database.prepare('INSERT INTO scopes(connector,id,label) VALUES(?,?,?) ON CONFLICT(connector,id) DO UPDATE SET label=excluded.label').run(connector, scope.id, scope.label);
    });
  }
  begin(connector: string, scopeId: string): void {
    this.database.prepare('UPDATE scopes SET scanning=1,error=NULL WHERE connector=? AND id=?').run(connector, scopeId);
  }
  recordPage(connector: string, scopeId: string, page: { items: SourceItem[]; next: string | null; checkpoint: string }, checkedAt: string): void {
    if (!this.scopes().some(scope => scope.connector === connector && scope.scope.id === scopeId)) throw new Error('SCOPE_NOT_OPTED_IN');
    if (page.items.some(item => item.connector !== connector || item.scopeId !== scopeId || !item.remoteId || !Number.isFinite(Date.parse(item.happenedAt)) || typeof item.text !== 'string')) throw new Error('INVALID_SOURCE_PAGE');
    this.transaction(() => {
      for (const item of page.items) {
        const hash = this.digest(item.text);
        // Edits supersede queued versions, but successful hashes remain dedupe receipts.
        this.database.prepare("DELETE FROM items WHERE connector=? AND scope_id=? AND remote_id=? AND hash!=? AND status IN ('pending','failed')").run(connector, scopeId, item.remoteId, hash);
        const previous = this.database.prepare("SELECT status FROM items WHERE connector=? AND remote_id=? AND hash=? AND status IN ('processed','ignored') LIMIT 1").get(connector, item.remoteId, hash) as { status: string } | undefined;
        this.database.prepare('INSERT OR IGNORE INTO items(connector,scope_id,remote_id,hash,happened_at,thread_id) VALUES(?,?,?,?,?,?)')
          .run(connector, scopeId, item.remoteId, hash, item.happenedAt, item.threadRemoteId ?? null);
        if (previous) this.database.prepare('UPDATE items SET status=? WHERE connector=? AND scope_id=? AND remote_id=? AND hash=?').run(previous.status, connector, scopeId, item.remoteId, hash);
      }
      this.database.prepare('UPDATE scopes SET next=?,cursor=CASE WHEN ? IS NULL THEN ? ELSE cursor END,checked_at=CASE WHEN ? IS NULL THEN ? ELSE checked_at END,scanning=?,error=NULL,failures=0,retry_at=NULL WHERE connector=? AND id=?')
        .run(page.next, page.next, page.checkpoint, page.next, checkedAt, page.next === null ? 0 : 1, connector, scopeId);
    });
  }
  failScope(connector: string, scopeId: string, retryAt: string, error: string): void {
    this.database.prepare('UPDATE scopes SET error=?,failures=failures+1,retry_at=? WHERE connector=? AND id=?').run(error, retryAt, connector, scopeId);
  }
  pending(): QueuedSource[] {
    const rows = this.database.prepare("SELECT * FROM items WHERE status='pending' ORDER BY happened_at DESC,connector,scope_id,remote_id,hash").all() as unknown as ItemRow[];
    return rows.map(row => ({ connector: row.connector, scopeId: row.scope_id, remoteId: row.remote_id, contentHash: row.hash, happenedAt: row.happened_at,
      ...(row.thread_id === null ? {} : { threadRemoteId: row.thread_id }) }));
  }
  finish(item: QueuedSource, outcome: 'processed' | 'ignored' | 'failed'): void {
    this.database.prepare('UPDATE items SET status=? WHERE connector=? AND remote_id=? AND hash=?').run(outcome, item.connector, item.remoteId, item.contentHash);
  }
  counts(): QueueCounts {
    const count = (status: string) => (this.database.prepare('SELECT count(*) AS count FROM (SELECT connector,remote_id,hash FROM items WHERE status=? GROUP BY connector,remote_id,hash)').get(status) as { count: number }).count;
    return { pending: count('pending'), failed: count('failed') };
  }
  close(): void { this.database.close(); }
  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try { operation(); this.database.exec('COMMIT'); } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}
interface ScopeRow { connector: string; id: string; label: string; cursor: string | null; next: string | null; checked_at: string | null; scanning: number; error: string | null; failures: number; retry_at: string | null }
interface ItemRow { connector: string; scope_id: string; remote_id: string; hash: string; happened_at: string; thread_id: string | null }
