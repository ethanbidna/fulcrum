import { DatabaseSync } from 'node:sqlite';
import { realpath, lstat, rename, chmod, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { IndexOptions, ReadIndex, IndexChange, IndexProgress, SearchHit, SearchScope } from './interfaces.js';
import { projectDocuments } from './documents.js';
import type { SearchDocument } from './documents.js';
import { IndexError, searchInput } from './search-input.js';
const CACHE_VERSION = 1;
const SQLITE_CORRUPT = 11;
const SQLITE_NOT_A_DATABASE = 26;
const SQLITE_PRIMARY_CODE_MASK = 0xff;
const TITLE_WEIGHT = 5;
const BODY_WEIGHT = 1;
const PROGRESS_BATCH = 100;
const SNIPPET_TOKENS = 16;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, initiative_ids TEXT NOT NULL, digest TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, body, content='documents', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS documents_insert AFTER INSERT ON documents BEGIN INSERT INTO search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
CREATE TRIGGER IF NOT EXISTS documents_delete AFTER DELETE ON documents BEGIN INSERT INTO search(search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body); END;
CREATE TRIGGER IF NOT EXISTS documents_update AFTER UPDATE ON documents BEGIN INSERT INTO search(search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body); INSERT INTO search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
`;
export class SqliteReadIndex implements ReadIndex {
  private progress: IndexProgress = { phase: 'unavailable', completed: 0, total: 0 };
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private readonly database: DatabaseSync, private readonly file: string, private readonly options: IndexOptions) {}
  static async open(options: IndexOptions): Promise<SqliteReadIndex> {
    const localEntry = await lstat(options.localDirectory);
    if (!localEntry.isDirectory() || localEntry.isSymbolicLink() || localEntry.uid !== process.getuid?.()) throw new IndexError('INDEX_UNAVAILABLE', 'Invalid local index directory');
    const local = await realpath(options.localDirectory); const workspace = await realpath(options.workspaceDirectory); const relative = path.relative(workspace, local);
    if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) throw new IndexError('INDEX_UNAVAILABLE', 'Index must be outside the workspace');
    const file = path.join(local, 'index.sqlite');
    try { const entry = await lstat(file); if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) throw new IndexError('INDEX_UNAVAILABLE', 'Invalid index file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let database: DatabaseSync;
    try { database = openDatabase(file); }
    catch (error) {
      const code = (error as { errcode?: number }).errcode;
      if (![SQLITE_CORRUPT, SQLITE_NOT_A_DATABASE].includes((code ?? 0) & SQLITE_PRIMARY_CODE_MASK)) throw error;
      let invalid = `${file}.invalid`; try { await access(invalid); invalid += `-${randomUUID()}`; } catch { /* Preserve the first invalid cache at the stable name. */ }
      await rename(file, invalid); database = openDatabase(file);
    }
    const index = new SqliteReadIndex(database, file, options);
    try {
      await chmod(file, 0o600);
      const snapshot = options.getSnapshot(); const docs = projectDocuments(snapshot);
      const revision = index.metadata('revision');
      if (index.metadata('workspace') !== snapshot.workspaceId || revision !== hash(docs)) await index.rebuild(snapshot);
      else index.report({ phase: 'ready', completed: docs.length, total: docs.length });
      return index;
    } catch (error) { database.close(); throw error; }
  }
  status(): IndexProgress { return { ...this.progress }; }
  rebuild(snapshot: WorkspaceStateDoc): Promise<void> {
    const submitted = structuredClone(snapshot);
    return this.enqueue(async () => { await this.update(submitted, 'rebuild'); });
  }
  async apply(change: IndexChange): Promise<void> {
    if (!change || typeof change.eventId !== 'string' || !change.eventId || !Array.isArray(change.ops)) throw new IndexError('VALIDATION_FAILED', 'Invalid index notification');
    return this.enqueue(async () => { await this.update(this.options.getSnapshot(), 'incremental'); });
  }
  private async update(snapshot: WorkspaceStateDoc, mode: 'rebuild' | 'incremental') {
    await access(this.file);
    const docs = projectDocuments(snapshot); this.report({ phase: 'rebuilding', completed: 0, total: docs.length });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (mode === 'rebuild') this.database.exec('DELETE FROM documents');
      const existing = new Map((this.database.prepare('SELECT key, digest FROM documents').all() as { key: string; digest: string }[]).map(row => [row.key, row.digest]));
      const current = new Set(docs.map(doc => doc.key));
      for (const key of existing.keys()) if (!current.has(key)) this.database.prepare('DELETE FROM documents WHERE key=?').run(key);
      for (let position = 0; position < docs.length; position++) {
        const doc = docs[position]!; if (existing.get(doc.key) !== hash(doc)) this.writeDocument(doc);
        if ((position + 1) % PROGRESS_BATCH === 0) { this.report({ phase: 'rebuilding', completed: position + 1, total: docs.length }); await new Promise<void>(resolve => setImmediate(resolve)); }
      }
      this.setMetadata('workspace', snapshot.workspaceId); this.setMetadata('revision', hash(docs));
      this.database.exec('COMMIT'); this.report({ phase: 'ready', completed: docs.length, total: docs.length });
    } catch (error) { this.database.exec('ROLLBACK'); this.report({ phase: 'unavailable', completed: 0, total: docs.length }); throw error; }
  }
  private writeDocument(doc: SearchDocument) {
    this.database.prepare('INSERT INTO documents(key,kind,id,title,body,initiative_ids,digest) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,id=excluded.id,title=excluded.title,body=excluded.body,initiative_ids=excluded.initiative_ids,digest=excluded.digest')
      .run(doc.key, doc.kind, doc.id, doc.title, doc.body, JSON.stringify(doc.initiativeIds), hash(doc));
  }
  search(text: string, scope: SearchScope = {}): Promise<SearchHit[]> {
    return this.enqueue(async () => {
      const { expression, limit } = searchInput(text, scope);
      if (!expression || scope.initiativeIds?.length === 0 || scope.kinds?.length === 0) return [];
      if (this.progress.phase !== 'ready') throw new IndexError('INDEX_UNAVAILABLE', 'Index is unavailable');
      await access(this.file);
      const query = `SELECT d.kind,d.id,d.title,d.initiative_ids,snippet(search,1,'','',' … ',${SNIPPET_TOKENS}) AS excerpt FROM search JOIN documents d ON d.rowid=search.rowid
WHERE search MATCH ? AND (? OR d.kind!='source' OR d.rowid IN (SELECT rowid FROM search WHERE search MATCH ?))
AND (? IS NULL OR d.kind IN (SELECT value FROM json_each(?)))
AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(d.initiative_ids) WHERE value IN (SELECT value FROM json_each(?))))
ORDER BY bm25(search,${TITLE_WEIGHT},${BODY_WEIGHT}),d.kind,d.id LIMIT ?`;
      const kinds = scope.kinds ? JSON.stringify(scope.kinds) : null; const initiatives = scope.initiativeIds ? JSON.stringify(scope.initiativeIds) : null;
      const rows = this.database.prepare(query).all(expression, scope.includeExcerpts ? 1 : 0, `title : (${expression})`, kinds, kinds, initiatives, initiatives, limit);
      return rows.map(row => ({ kind: row.kind as SearchHit['kind'], id: String(row.id), title: String(row.title), initiativeIds: (JSON.parse(String(row.initiative_ids)) as string[]).filter(id => !scope.initiativeIds || scope.initiativeIds.includes(id)), ...(scope.includeExcerpts && row.kind === 'source' && row.excerpt ? { untrustedExcerpt: String(row.excerpt) } : {}) }));
    });
  }
  private metadata(key: string): string | undefined { return (this.database.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  private setMetadata(key: string, value: string) { this.database.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  private report(progress: IndexProgress) { this.progress = progress; try { this.options.onProgress?.({ ...progress }); } catch { return; } }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new IndexError('INDEX_UNAVAILABLE', 'Index is closed'));
    const result = this.tail.then(operation).catch(error => { if (!(error instanceof IndexError && error.code === 'VALIDATION_FAILED')) this.report({ phase: 'unavailable', completed: 0, total: this.progress.total }); throw error; }); this.tail = result.catch(() => undefined); return result;
  }
  async close() { if (this.closed) return; this.closed = true; await this.tail; this.database.close(); }
}
function openDatabase(file: string): DatabaseSync {
  const database = new DatabaseSync(file);
  try {
    database.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;');
    const version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version !== 0 && version !== CACHE_VERSION) throw new IndexError('INDEX_UNAVAILABLE', 'Unsupported local index version');
    database.exec(SCHEMA); database.exec(`PRAGMA user_version=${CACHE_VERSION}`);
    database.prepare("INSERT INTO search(search, rank) VALUES('secure-delete', 1)").run();
    return database;
  } catch (error) { database.close(); throw error; }
}
