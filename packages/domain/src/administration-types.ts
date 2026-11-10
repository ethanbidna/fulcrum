import type { WorkspaceStateDoc } from '@fulcrum/schema';
export type BackupFrequency = 'disabled' | 'daily' | 'weekly';
export interface LocalBackup { kind: 'manual' | 'daily' | 'weekly'; id: string; workspaceId: string; createdAt: string; eventCount: number; lastHlc: string | null }
export interface LocalConfiguration {
  workspaceId: string; workspaceDirectory: string; deviceId: string; deviceLabel: string;
  cachePolicy: 'none' | 'excerpt'; ingestionDeviceId: string | null;
  devices: {id: string; label: string}[]; ingestionLastSeenAt: string | null; ingestionStale: boolean;
  backupFrequency: BackupFrequency; backups: LocalBackup[];
  backgroundPaused: boolean; onlyWhenPluggedIn: boolean; backgroundReason: string | null;
  ingestionEnabled: boolean; backupError: boolean; backupRetentionError?: boolean;
}
export interface AdministrationArgs {
  'mcp.status': Record<string, never>;
  'mcp.configure': Partial<McpConfiguration>;
  'mcp.activity': Record<string, never>;
  'mcp.install': {confirmed:boolean};
  status: Record<string, never>;
  'backup.create': Record<string, never>;
  'backup.configure': {frequency: BackupFrequency};
  'backup.restore': {backupId: string};
  'history.preview': {eventId: string};
  'background.configure': {paused?: boolean; onlyWhenPluggedIn?: boolean};
}
export interface AdministrationResults {
  'mcp.status': {access: McpConfiguration; initiatives: {id:string;title:string}[]; categories: {id:string;name:string}[]};
  'mcp.configure': McpConfiguration;
  'mcp.activity': McpActivityEntry[];
  'mcp.install': {configurationFile:string};
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
