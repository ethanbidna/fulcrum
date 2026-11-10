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
  status: Record<string, never>;
  'backup.create': Record<string, never>;
  'backup.configure': {frequency: BackupFrequency};
  'backup.restore': {backupId: string};
  'history.preview': {eventId: string};
  'background.configure': {paused?: boolean; onlyWhenPluggedIn?: boolean};
}
export interface AdministrationResults {
  status: LocalConfiguration;
  'backup.create': LocalBackup;
  'backup.configure': {frequency: BackupFrequency};
  'backup.restore': {workspaceId: string; directory: string};
  'history.preview': WorkspaceStateDoc;
  'background.configure': {paused: boolean; onlyWhenPluggedIn: boolean};
}
export type AdministrationName = keyof AdministrationArgs;
