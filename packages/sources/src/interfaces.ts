export interface SourceScope { id: string; label: string }
export type Cursor = string;
export interface SourceItemRef { connector: string; scopeId: string; remoteId: string }
export interface SourceItem extends SourceItemRef {
  threadRemoteId?: string; permalink?: string; happenedAt: string;
  authorId: string; addresseeIds?: string[]; text: string;
}
export interface PullLimits { since: string; limit: number; signal: AbortSignal }
export interface SourcePage {
  items: SourceItem[];
  next: Cursor | null;
  /** Incremental position to retain only after this scan completes. */
  checkpoint: Cursor;
}
export interface SourceAdapter {
  readonly id: string;
  scopes(): Promise<SourceScope[]>;
  pull(scope: SourceScope, cursor: Cursor | null, limits: PullLimits): Promise<SourcePage>;
  read(ref: SourceItemRef, signal: AbortSignal): Promise<SourceItem | null>;
  permalink(ref: SourceItemRef): string | null;
}
export interface QueuedSource extends SourceItemRef {
  contentHash: string; happenedAt: string; threadRemoteId?: string;
}
export interface ScopeProgress {
  scope: SourceScope; connector: string; cursor: Cursor | null; next: Cursor | null;
  checkedAt: string | null; scanning: boolean; error: string | null;
  failures: number; retryAt: string | null;
}
export interface QueueCounts { pending: number; failed: number }
export interface IngestionQueue {
  scopes(): ScopeProgress[];
  configure(connector: string, scopes: SourceScope[]): void;
  begin(connector: string, scopeId: string): void;
  recordPage(connector: string, scopeId: string, page: { items: SourceItem[]; next: Cursor | null; checkpoint: Cursor }, checkedAt: string): void;
  failScope(connector: string, scopeId: string, retryAt: string, error: string): void;
  pending(): QueuedSource[];
  finish(item: QueuedSource, outcome: 'processed' | 'ignored' | 'failed'): void;
  counts(): QueueCounts;
  digest(text: string): string;
  close(): void;
}
