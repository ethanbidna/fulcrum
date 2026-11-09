import type { IngestionQueue, SourceAdapter, SourceItem, ScopeProgress } from '@fulcrum/sources/interfaces';
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 14;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_TICK = 20;
const REQUEST_DEADLINE_MS = 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;
export interface RelevanceContext {
  userId: string; terms: string[]; linkedThreadIds: string[]; excludedAuthorIds: string[];
}
export interface IngestionOptions {
  queue: IngestionQueue; adapters: SourceAdapter[]; deviceId: string;
  ingestionDeviceId(): string | undefined;
  relevance(): RelevanceContext;
  recordedSources?(): { connector: string; remoteId: string; contentHash: string }[];
  now(): string;
  process?: (item: SourceItem, context: { signal: AbortSignal; idempotencyKey: string }) => Promise<void>;
}
export interface IngestionStatus {
  state: 'viewer' | 'disabled' | 'paused' | 'reconnect' | 'failed' | 'catching-up' | 'awaiting-extraction' | 'current' | 'unknown';
  pending: number; failed: number; checkedAt: string | null; label: string;
}
export class IngestionScheduler {
  private paused = false;
  private running: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private stopped = false;
  constructor(private readonly options: IngestionOptions) {
    if (new Set(options.adapters.map(adapter => adapter.id)).size !== options.adapters.length) throw new Error('DUPLICATE_ADAPTER');
  }
  configure(connector: string, scopeIds: string[]): Promise<void> {
    return this.configureScopes(connector, scopeIds);
  }
  private async configureScopes(connector: string, scopeIds: string[]): Promise<void> {
    if (this.running) throw new Error('INGESTION_BUSY');
    const adapter = this.adapter(connector); const available = await adapter.scopes();
    if (this.running || this.stopped) throw new Error('INGESTION_BUSY');
    if (scopeIds.some(id => !available.some(scope => scope.id === id))) throw new Error('UNKNOWN_SOURCE_SCOPE');
    this.options.queue.configure(connector, scopeIds.map(id => available.find(scope => scope.id === id)!));
  }
  pause(): void { this.paused = true; this.controller?.abort(); }
  resume(): void { if (!this.stopped) this.paused = false; }
  active(): boolean { return !this.stopped && !this.paused && this.designated() && this.options.queue.scopes().length > 0; }
  async close(): Promise<void> { this.stopped = true; this.controller?.abort(); await this.running; }
  tick(): Promise<void> {
    if (this.running) return this.running;
    if (!this.active()) return Promise.resolve();
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }
  status(): IngestionStatus {
    const scopes = this.options.queue.scopes(); const counts = this.options.queue.counts();
    const checkedAt = scopes.length && scopes.every(scope => scope.checkedAt) ? scopes.map(scope => scope.checkedAt!).sort()[0]! : null;
    const result = (state: IngestionStatus['state'], label: string): IngestionStatus => ({ state, label, checkedAt, ...counts });
    if (!this.designated()) return result('viewer', 'Viewer/editor — sources checked on the ingestion Mac');
    if (!scopes.length) return result('disabled', 'No source scopes enabled');
    if (this.paused || this.stopped) return result('paused', 'Local ingestion paused');
    if (scopes.some(scope => scope.error)) return result('reconnect', 'Source unavailable — check connection');
    if (counts.failed) return result('failed', `${counts.failed} items need attention`);
    if (scopes.some(scope => scope.scanning) || this.running) return result('catching-up', `Catching up — ${counts.pending} known items`);
    if (counts.pending) return result(this.options.process ? 'catching-up' : 'awaiting-extraction', this.options.process ? `Catching up — ${counts.pending} items` : `Local AI unavailable — ${counts.pending} items waiting`);
    if (!checkedAt) return result('unknown', 'Sources not checked yet');
    return result('current', `Up to date as of ${checkedAt}`);
  }
  private designated(): boolean { return this.options.ingestionDeviceId() === this.options.deviceId; }
  private allowed(): void {
    if (!this.active()) throw new Error('INGESTION_PAUSED_OR_NOT_DESIGNATED');
  }
  private adapter(id: string): SourceAdapter {
    const adapter = this.options.adapters.find(adapter => adapter.id === id);
    if (!adapter) throw new Error('SOURCE_UNAVAILABLE');
    return adapter;
  }
  private async request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.allowed(); const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(new Error('SOURCE_DEADLINE')), REQUEST_DEADLINE_MS);
    try {
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      const result = await Promise.race([operation(controller.signal), aborted]);
      controller.signal.throwIfAborted(); this.allowed(); return result;
    } finally { clearTimeout(timer); this.controller = undefined; }
  }
  private async run(): Promise<void> {
    for (const scope of this.options.queue.scopes()) {
      if (!this.active()) return;
      await this.pull(scope);
    }
    if (!this.options.process || !this.active()) return;
    // A failing source cannot block healthy scopes; incomplete scans wait for newer pages.
    const ready = this.options.queue.scopes().filter(scope => !scope.scanning && !scope.error);
    const pending = this.options.queue.pending().filter(item => ready.some(scope => scope.connector === item.connector && scope.scope.id === item.scopeId));
    const handled = new Set<string>();
    for (const item of pending) {
      const key = JSON.stringify([item.connector, item.remoteId, item.contentHash]);
      if (handled.has(key)) continue;
      handled.add(key);
      if (!this.active()) return;
      try {
        const source = await this.request(signal => this.adapter(item.connector).read(item, signal));
        if (!source || source.connector !== item.connector || source.scopeId !== item.scopeId || source.remoteId !== item.remoteId || this.options.queue.digest(source.text) !== item.contentHash) {
          this.options.queue.finish(item, 'failed'); continue;
        }
        if (this.recorded(source) || !relevant(source, this.options.relevance())) { this.options.queue.finish(item, 'ignored'); continue; }
        const idempotencyKey = JSON.stringify([item.connector, item.remoteId, item.contentHash]);
        await this.request(signal => this.options.process!(source, { signal, idempotencyKey }));
        this.options.queue.finish(item, 'processed');
      } catch {
        if (!this.active()) return;
        this.options.queue.finish(item, 'failed');
      }
    }
  }
  private recorded(item: SourceItem): boolean {
    const hash = this.options.queue.digest(item.text);
    return this.options.recordedSources?.().some(source => source.connector === item.connector && source.remoteId === item.remoteId && source.contentHash === hash) ?? false;
  }
  private async pull(scope: ScopeProgress): Promise<void> {
    const now = this.options.now();
    if (scope.retryAt && scope.retryAt > now) return;
    if (!scope.scanning && scope.checkedAt && Date.parse(now) - Date.parse(scope.checkedAt) < POLL_INTERVAL_MS) return;
    this.options.queue.begin(scope.connector, scope.scope.id);
    let cursor = scope.scanning ? scope.next ?? scope.cursor : scope.cursor;
    const since = new Date(Date.parse(now) - BACKFILL_DAYS * DAY_MS).toISOString();
    try {
      for (let count = 0; count < MAX_PAGES_PER_TICK; count++) {
        const page = await this.request(signal => this.adapter(scope.connector).pull(scope.scope, cursor, { since, limit: PAGE_SIZE, signal }));
        if (page.next !== null && page.next === cursor) throw new Error('SOURCE_CURSOR_STALLED');
        this.options.queue.recordPage(scope.connector, scope.scope.id, page, now);
        for (const source of page.items) {
          if (!this.recorded(source) && relevant(source, this.options.relevance())) continue;
          this.options.queue.finish({ ...source, contentHash: this.options.queue.digest(source.text) }, 'ignored');
        }
        if (page.next === null) return;
        cursor = page.next;
      }
    } catch {
      if (!this.active()) return;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** scope.failures);
      this.options.queue.failScope(scope.connector, scope.scope.id, new Date(Date.parse(now) + delay).toISOString(), 'SOURCE_UNAVAILABLE');
    }
  }
}
function relevant(item: SourceItem, context: RelevanceContext): boolean {
  if (context.excludedAuthorIds.includes(item.authorId)) return false;
  if (item.authorId === context.userId || item.addresseeIds?.includes(context.userId)) return true;
  if (item.threadRemoteId && context.linkedThreadIds.includes(item.threadRemoteId)) return true;
  const text = item.text.toLocaleLowerCase('en-US');
  return context.terms.some(term => term.trim() && text.includes(term.toLocaleLowerCase('en-US'))) || /\b(i will|i'll|i commit|we will)\b/i.test(item.text);
}
