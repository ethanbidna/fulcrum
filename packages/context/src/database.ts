import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath, chmod, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContextOptions } from './interfaces.js';
const CACHE_VERSION = 1;
const PRIVATE_FILE_MODE = 0o600;
const SQLITE_CORRUPT = 11;
const SQLITE_NOT_A_DATABASE = 26;
const SQLITE_PRIMARY_CODE_MASK = 0xff;
export class ContextError extends Error {
  constructor(readonly code: 'CONTEXT_UNAVAILABLE' | 'VALIDATION_FAILED', message: string) { super(message); }
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS aliases (entity_id TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(entity_id,label));
CREATE INDEX IF NOT EXISTS aliases_label ON aliases(label);
CREATE TABLE IF NOT EXISTS external_ids (entity_id TEXT NOT NULL, connector TEXT NOT NULL, remote_id TEXT NOT NULL, PRIMARY KEY(entity_id,connector,remote_id));
CREATE INDEX IF NOT EXISTS external_identity ON external_ids(connector,remote_id);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title,body,content='records',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS records_insert AFTER INSERT ON records BEGIN INSERT INTO search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
CREATE TRIGGER IF NOT EXISTS records_delete AFTER DELETE ON records BEGIN INSERT INTO search(search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body); END;
CREATE TRIGGER IF NOT EXISTS records_update AFTER UPDATE ON records BEGIN INSERT INTO search(search,rowid,title,body) VALUES('delete',old.rowid,old.title,old.body); INSERT INTO search(rowid,title,body) VALUES(new.rowid,new.title,new.body); END;
`;
export async function contextFile(options: ContextOptions): Promise<string> {
  const entry = await lstat(options.localDirectory);
  if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()) throw new ContextError('CONTEXT_UNAVAILABLE', 'Invalid local context directory');
  const local = await realpath(options.localDirectory); const workspace = await realpath(options.workspaceDirectory);
  const relative = path.relative(workspace, local);
  if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) throw new ContextError('CONTEXT_UNAVAILABLE', 'Context must be outside the workspace');
  const file = path.join(local, 'context.sqlite');
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ContextError('CONTEXT_UNAVAILABLE', 'Invalid context file');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}
export function clearContext(database: DatabaseSync) { database.exec('DELETE FROM records; DELETE FROM aliases; DELETE FROM external_ids;'); }
function openDatabase(file: string, workspaceId: string): DatabaseSync {
  const database = new DatabaseSync(file);
  try {
    database.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;');
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version !== 0 && version.user_version !== CACHE_VERSION) throw new ContextError('CONTEXT_UNAVAILABLE', 'Unsupported context version');
    database.exec(SCHEMA);
    database.exec(`PRAGMA user_version=${CACHE_VERSION}`);
    database.prepare("INSERT INTO search(search,rank) VALUES('secure-delete',1)").run();
    const previous = database.prepare("SELECT value FROM metadata WHERE key='workspace'").get();
    if (previous?.value !== workspaceId) {
      database.exec('BEGIN IMMEDIATE');
      clearContext(database);
      database.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('workspace',?)").run(workspaceId);
      database.exec('COMMIT');
    }
    return database;
  } catch (error) { database.close(); throw error; }
}
export async function openContextDatabase(file: string, workspaceId: string): Promise<DatabaseSync> {
  let database: DatabaseSync;
  try { database = openDatabase(file, workspaceId); }
  catch (error) {
    const code = ((error as { errcode?: number }).errcode ?? 0) & SQLITE_PRIMARY_CODE_MASK;
    if (![SQLITE_CORRUPT, SQLITE_NOT_A_DATABASE].includes(code)) throw error;
    await rename(file, `${file}.invalid-${randomUUID()}`);
    database = openDatabase(file, workspaceId);
  }
  try { await chmod(file, PRIVATE_FILE_MODE); return database; } catch (error) { database.close(); throw error; }
}
