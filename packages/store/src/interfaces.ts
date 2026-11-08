import type { ChangeEvent, WorkspaceManifest, WorkspaceStateDoc } from '@fulcrum/schema';

export type EventDraft = Omit<ChangeEvent, 'seq' | 'hlc'>;
export interface StoreDiagnostic { code: string; file?: string; eventId?: string }
export interface WorkspaceRead {
  manifest: WorkspaceManifest;
  events: ChangeEvent[];
  checkpoints: { deviceId: string; file: string; body: WorkspaceStateDoc }[];
  diagnostics: StoreDiagnostic[];
}
export interface OpenedWorkspace {
  manifest: WorkspaceManifest;
  deviceId: string;
  readOnly: boolean;
  registrationRequired: boolean;
  diagnostics: StoreDiagnostic[];
}
export interface WorkspaceStore {
  open(directory: string): Promise<OpenedWorkspace>;
  append(events: ChangeEvent[]): Promise<void>;
  commit(drafts: EventDraft[]): Promise<ChangeEvent[]>;
  readAll(): AsyncIterable<ChangeEvent>;
  read(): Promise<WorkspaceRead>;
  writeCheckpoint(checkpoint: WorkspaceStateDoc): Promise<void>;
  latestUsableCheckpoint(): Promise<WorkspaceStateDoc | null>;
  watch(listener: () => void): () => void;
  close(): Promise<void>;
}
export type FaultStage = 'append-half' | 'append-fsync' | 'batch-before-publish' | 'checkpoint-before-rename' | 'identity-before-save';
export interface StoreOptions {
  localDirectory: string;
  deviceLabel: string;
  readerVersion?: number;
  now?: () => Date;
  fault?: (stage: FaultStage) => Promise<void>;
  lockStaleMs?: number;
}
