import type { Op, WorkspaceStateDoc } from '@fulcrum/schema';
export type SearchKind = 'initiative' | 'node' | 'entity' | 'source';
export interface SearchScope { initiativeIds?: string[]; kinds?: SearchKind[]; limit?: number; includeExcerpts?: boolean }
export interface SearchHit { kind: SearchKind; id: string; title: string; initiativeIds: string[]; untrustedExcerpt?: string }
export interface IndexProgress { phase: 'rebuilding' | 'ready' | 'unavailable'; completed: number; total: number }
export interface IndexChange { eventId: string; ops: Op[] }
export interface ReadIndex {
  rebuild(snapshot: WorkspaceStateDoc): Promise<void>;
  apply(change: IndexChange): Promise<void>;
  search(text: string, scope?: SearchScope): Promise<SearchHit[]>;
  status(): IndexProgress;
  close(): Promise<void>;
}
export interface IndexOptions {
  localDirectory: string; workspaceDirectory: string;
  getSnapshot(): WorkspaceStateDoc;
  onProgress?: (progress: IndexProgress) => void;
}
