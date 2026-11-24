import type {AiSetupStatus,AiJob,AiProfile,OriginPreference}from'./setup-types.js';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
export type BackupFrequency = 'disabled' | 'daily' | 'weekly';
export interface LocalBackup { kind: 'manual' | 'daily' | 'weekly'; id: string; workspaceId: string; createdAt: string; eventCount: number; lastHlc: string | null }
export interface LocalConfiguration {
  encrypted?: boolean;
  workspaceId: string; workspaceDirectory: string; deviceId: string; deviceLabel: string;
  cachePolicy: 'none' | 'excerpt'; ingestionDeviceId: string | null;
  devices: {id: string; label: string}[]; ingestionLastSeenAt: string | null; ingestionStale: boolean;
  backupFrequency: BackupFrequency; backups: LocalBackup[];
  backgroundPaused: boolean; onlyWhenPluggedIn: boolean; backgroundReason: string | null;
  ingestionEnabled: boolean; backupError: boolean; backupRetentionError?: boolean;
}
export type GmailSettingsStatus =
  | { phase: 'unavailable' | 'disconnected' | 'connecting' | 'failed' }
  | { phase: 'select'; account: string; labels: { id: string; label: string }[] }
  | { phase: 'active'; account: string; label: { id: string; label: string } };
export type ManagedSourceId = 'gmail' | 'slack' | 'granola' | 'google_drive' | 'dropbox' | 'google_calendar';
export interface ManagedSourceStatus {
  source: ManagedSourceId;
  phase: 'unavailable' | 'disconnected' | 'connecting' | 'saved' | 'connected' | 'failed' | 'cancelling';
  ingestion: 'blocked';
}
export type ManagedAuthorization = { phase: 'authorization'; attemptId: string; authorizationUrl: string } | { phase: 'connected' };
export interface ConnectionRuntimeStatus {
  phase: 'checking' | 'not_installed' | 'stopped' | 'installing' | 'starting' | 'ready' | 'stopping' | 'failed' | 'unavailable';
  installed: boolean;
  message: string;
  completedBytes: number | null;
  totalBytes: number | null;
}
export interface AdministrationArgs {
  'sources.runtime.status': Record<string, never>;
  'sources.runtime.start': { acknowledged: boolean };
  'sources.runtime.stop': Record<string, never>;

  'sources.status': Record<string, never>;
  'sources.connect': { source: ManagedSourceId; acknowledged: boolean };
  'sources.begin': { source: ManagedSourceId; acknowledged: boolean };
  'sources.complete': { attemptId: string; code: string };
  'sources.granola': { apiKey: string; acknowledged: boolean };
  'sources.verify': { source: ManagedSourceId };
  'sources.cancel': { source: ManagedSourceId };
  'sources.disconnect': { source: ManagedSourceId };

  'gmail.status': Record<string, never>;
  'gmail.connect': { account?: string; acknowledged: boolean };
  'gmail.select': { id: string };
  'gmail.disconnect': Record<string, never>;
  'mcp.status': Record<string, never>;
  'mcp.configure': Partial<McpConfiguration>;
  'mcp.activity': Record<string, never>;
  'mcp.install': {confirmed:boolean};
  'ai.status':Record<string,never>;
  'ai.preferences':{preference:OriginPreference};
  'ai.start':{choiceId:string;licenseAccepted:boolean;sharingAcknowledged?:boolean;apiKey?:string;initiativeIds?:string[];dailyTokenBudget?:number};
  'ai.job':{id:string};
  'ai.cancel':{id:string};
  'ai.none':Record<string,never>;
  'workspace.setupStatus':Record<string,never>;
  'workspace.configure':{deviceLabel:string;ingestion:'keep'|'this_mac';handoverConfirmed:boolean;userEntityId?:string};
  'workspace.finishSetup':Record<string,never>;
  status: Record<string, never>;
  'backup.create': Record<string, never>;
  'backup.configure': {frequency: BackupFrequency};
  'backup.restore': {backupId: string};
  'history.preview': {eventId: string};
  'background.configure': {paused?: boolean; onlyWhenPluggedIn?: boolean};
}
export interface AdministrationResults {
  'sources.runtime.status': ConnectionRuntimeStatus;
  'sources.runtime.start': Record<string, never>;
  'sources.runtime.stop': Record<string, never>;

  'sources.status': ManagedSourceStatus[];
  'sources.connect': Record<string, never>;
  'sources.begin': ManagedAuthorization;
  'sources.complete': Record<string, never>;
  'sources.granola': Record<string, never>;
  'sources.verify': Record<string, never>;
  'sources.cancel': Record<string, never>;
  'sources.disconnect': Record<string, never>;

  'gmail.status': GmailSettingsStatus;
  'gmail.connect': Record<string, never>;
  'gmail.select': Record<string, never>;
  'gmail.disconnect': Record<string, never>;
  'mcp.status': {access: McpConfiguration; initiatives: {id:string;title:string}[]; categories: {id:string;name:string}[]};
  'mcp.configure': McpConfiguration;
  'mcp.activity': McpActivityEntry[];
  'mcp.install': {configurationFile:string};
  'ai.status':AiSetupStatus;
  'ai.preferences':OriginPreference;
  'ai.start':{id:string};
  'ai.job':AiJob;
  'ai.cancel':Record<string,never>;
  'ai.none':AiProfile;
  'workspace.setupStatus':{completed:boolean;deviceId:string;deviceLabel:string;ingestionDeviceId:string|null;people:{id:string;label:string}[];userEntityId:string};
  'workspace.configure':{deviceId:string;userEntityId:string};
  'workspace.finishSetup':Record<string,never>;
  status: LocalConfiguration;
  'backup.create': LocalBackup;
  'backup.configure': {frequency: BackupFrequency};
  'backup.restore': {workspaceId: string; directory: string};
  'history.preview': WorkspaceStateDoc;
  'background.configure': {paused: boolean; onlyWhenPluggedIn: boolean};
}
export type AdministrationName = keyof AdministrationArgs;

export interface McpConfiguration {
  enabled: boolean; readOnly: boolean; sharingAcknowledged: boolean;
  sourceExcerpts: boolean; questionsVisible: boolean;
  initiativeIds?: string[]; categoryIds?: string[];
}
export interface McpActivityEntry { at: string; tool: string; outcome: 'requested'|'allowed'|'denied'|'failed'; recordIds: string[] }
