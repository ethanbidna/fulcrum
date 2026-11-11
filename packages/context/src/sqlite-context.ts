import type { DatabaseSync } from 'node:sqlite';
import { access } from 'node:fs/promises';
import type { Entity, Source } from '@fulcrum/schema';
import type { ContextIndex, ContextOptions, ContextTarget, EntityResolution, Episode, Mention, RelatedContext } from './interfaces.js';
import { clearContext, contextFile, ContextError, openContextDatabase } from './database.js';
import { normalizeIdentity, resolution } from './identity.js';
import { emptyContext, selectRelated } from './related.js';
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
const MAX_MENTIONS = 100;
const FTS_TITLE_WEIGHT = 5;
const FTS_BODY_WEIGHT = 1;
export class SqliteContextIndex implements ContextIndex {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(private readonly database: DatabaseSync, private readonly file: string) {}
  static async open(options: ContextOptions): Promise<SqliteContextIndex> {
    if (!options.workspaceId) throw new ContextError('VALIDATION_FAILED', 'Workspace identity required');
    const file = await contextFile(options);
    return new SqliteContextIndex(await openContextDatabase(file, options.workspaceId), file);
  }
  ingest(episode: Episode): Promise<void> {
    const submitted = structuredClone(episode);
    return this.enqueue(() => this.transaction(async () => { this.write(submitted); }));
  }
  rebuild(from: AsyncIterable<Episode>): Promise<void> {
    return this.enqueue(() => this.transaction(async () => {
      clearContext(this.database);
      for await (const episode of from) this.write(episode);
    }));
  }
  resolveEntities(mentions: Mention[]): Promise<EntityResolution[]> {
    const submitted = structuredClone(mentions);
    return this.enqueue(async () => {
      if (!Array.isArray(submitted) || submitted.length > MAX_MENTIONS) throw new ContextError('VALIDATION_FAILED', 'Invalid mention batch');
      const entities = new Map(this.records('entity').map(entity => [entity.id, entity]));
      return submitted.map(mention => {
        if (!mention || typeof mention.text !== 'string' || mention.text.length > MAX_QUERY_LENGTH) throw new ContextError('VALIDATION_FAILED', 'Invalid mention');
        const rows = mention.externalId
          ? this.database.prepare('SELECT entity_id FROM external_ids WHERE connector=? AND remote_id=? ORDER BY entity_id').all(mention.externalId.connector, mention.externalId.remoteId)
          : this.database.prepare('SELECT entity_id FROM aliases WHERE label=? ORDER BY entity_id').all(normalizeIdentity(mention.text));
        return resolution(mention, rows.map(row => String(row.entity_id)), entities);
      });
    });
  }
  related(target: ContextTarget, limit: number): Promise<RelatedContext> {
    const submitted = structuredClone(target);
    return this.enqueue(async () => {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !submitted || !['text', 'entity', 'initiative', 'node', 'edge'].includes(submitted.kind)) throw new ContextError('VALIDATION_FAILED', 'Invalid context query');
      const matches = new Set<string>();
      if (submitted.kind === 'text') {
        if (typeof submitted.text !== 'string' || submitted.text.length > MAX_QUERY_LENGTH) throw new ContextError('VALIDATION_FAILED', 'Invalid context text');
        const tokens = submitted.text.match(/[\p{L}\p{N}_]+/gu) ?? [];
        if (!tokens.length) return emptyContext();
        const expression = tokens.map(token => `"${token}"`).join(' AND ');
        const rows = this.database.prepare(`SELECT r.kind,r.id FROM search JOIN records r ON r.rowid=search.rowid WHERE search MATCH ? ORDER BY bm25(search,${FTS_TITLE_WEIGHT},${FTS_BODY_WEIGHT}),r.kind,r.id LIMIT ?`).all(expression, limit);
        for (const row of rows) matches.add(`${row.kind}:${row.id}`);
      } else if (typeof submitted.id !== 'string' || !submitted.id) throw new ContextError('VALIDATION_FAILED', 'Invalid context target');
      return selectRelated({ entities: this.records('entity'), sources: this.records('source'), assertions: this.records('assertion'), targets: this.records('target') }, submitted, matches, limit);
    });
  }
  private records<K extends Episode['kind']>(kind: K): Extract<Episode, { kind: K }>['record'][] {
    return this.database.prepare('SELECT data FROM records WHERE kind=? ORDER BY id').all(kind).map(row => JSON.parse(String(row.data)));
  }
  private write(episode: Episode) {
    const record = episode.kind === 'source' ? permittedSource(episode.record) : episode.record;
    const id = episode.kind === 'target' ? `${episode.record.target.kind}:${episode.record.target.id}` : (record as { id: string }).id;
    let title = ''; let body = '';
    if (episode.kind === 'entity') { title = episode.record.label; body = episode.record.aliases.join(' '); this.writeIdentity(episode.record); }
    if (episode.kind === 'source') { const source = record as Source; title = source.title ?? ''; body = source.excerpt ?? ''; }
    if (episode.kind === 'target') title = episode.record.title;
    this.database.prepare('INSERT INTO records(kind,id,data,title,body) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,title=excluded.title,body=excluded.body')
      .run(episode.kind, id, JSON.stringify(record), title, body);
  }
  private writeIdentity(entity: Entity) {
    this.database.prepare('DELETE FROM aliases WHERE entity_id=?').run(entity.id);
    this.database.prepare('DELETE FROM external_ids WHERE entity_id=?').run(entity.id);
    for (const label of new Set([entity.label, ...entity.aliases].map(normalizeIdentity).filter(Boolean))) this.database.prepare('INSERT INTO aliases(entity_id,label) VALUES(?,?)').run(entity.id, label);
    for (const external of entity.externalIds ?? []) this.database.prepare('INSERT OR IGNORE INTO external_ids(entity_id,connector,remote_id) VALUES(?,?,?)').run(entity.id, external.connector, external.remoteId);
  }
  private async transaction(operation: () => Promise<void>) {
    this.database.exec('BEGIN IMMEDIATE');
    try { await operation(); this.database.exec('COMMIT'); } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ContextError('CONTEXT_UNAVAILABLE', 'Context index is closed'));
    const result = this.tail.then(async () => { await access(this.file); return operation(); });
    this.tail = result.catch(() => undefined); return result;
  }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; await this.tail; this.database.close(); }
}
function permittedSource(source: Source): Source {
  const result = structuredClone(source);
  if (result.cachePolicy !== 'excerpt') delete result.excerpt;
  return result;
}
