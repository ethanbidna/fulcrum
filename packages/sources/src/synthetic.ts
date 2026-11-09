import type { SourceAdapter, SourceScope, SourceItem, SourceItemRef, PullLimits, SourcePage } from './interfaces.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
export class SyntheticSourceAdapter implements SourceAdapter {
  readonly id = 'synthetic';
  private readonly items: SourceItem[];
  constructor(options: { now: string; days?: number; title?: string; userId?: string }) {
    this.items = Array.from({ length: options.days ?? DEFAULT_DAYS }, (_, day) => ({
      connector: this.id, scopeId: 'fixture', remoteId: `day-${day}`, threadRemoteId: 'vendor-review',
      happenedAt: new Date(Date.parse(options.now) - day * DAY_MS).toISOString(),
      authorId: options.userId ?? 'synthetic-user', text: `${options.title ?? 'Vendor evaluation'}: I will review the synthetic update for day ${day}.`,
      permalink: `https://example.invalid/synthetic/day-${day}`,
    }));
  }
  async scopes(): Promise<SourceScope[]> { return [{ id: 'fixture', label: 'Synthetic fixture' }]; }
  async pull(scope: SourceScope, cursor: string | null, limits: PullLimits): Promise<SourcePage> {
    limits.signal.throwIfAborted();
    if (scope.id !== 'fixture' || !Number.isInteger(limits.limit) || limits.limit < 1) throw new Error('INVALID_SYNTHETIC_PULL');
    const position = cursor === null ? { after: '', offset: 0 } : JSON.parse(cursor) as { after: string; offset: number };
    const items = this.items.filter(item => item.happenedAt >= limits.since && item.happenedAt > position.after)
      .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
    const page = items.slice(position.offset, position.offset + limits.limit);
    const offset = position.offset + page.length;
    return { items: structuredClone(page), next: offset < items.length ? JSON.stringify({ ...position, offset }) : null,
      checkpoint: JSON.stringify({ after: items[0]?.happenedAt ?? position.after, offset: 0 }) };
  }
  async read(ref: SourceItemRef, signal: AbortSignal): Promise<SourceItem | null> {
    signal.throwIfAborted();
    const item = this.items.find(item => item.connector === ref.connector && item.scopeId === ref.scopeId && item.remoteId === ref.remoteId);
    return item ? structuredClone(item) : null;
  }
  permalink(ref: SourceItemRef): string | null { return this.items.find(item => item.remoteId === ref.remoteId && item.scopeId === ref.scopeId && ref.connector === this.id)?.permalink ?? null; }
}
