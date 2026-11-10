export { FileWorkspaceStore } from './store.js';
export { StoreError, SEGMENT_BYTES, WATCH_INTERVAL_MS } from './files.js';
export type { WorkspaceStore, StoreOptions, WorkspaceRead, OpenedWorkspace, StoreDiagnostic, EventDraft, FaultStage } from './interfaces.js';
export { loadStoreValidators } from './validation.js';
export { questionId, QUESTION_NAMESPACE } from './question-id.js';

export { WorkspaceArchives } from './archive.js';
export type { BackupCadence, BackupSummary, ArchiveOptions } from './archive.js';

export { LocalPreferences } from './preferences.js';
export { LocalMcpActivity } from './activity.js';
export type { McpActivity } from './activity.js';
export { McpInstallation } from './mcp-installation.js';
