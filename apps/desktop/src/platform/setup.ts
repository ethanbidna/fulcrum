import type{StartupStatus,WorkspaceSelection}from'@fulcrum/domain';
export type PrivacyAction = 'copy' | 'lock' | 'restore';
export interface WorkspaceSetup{
 privacy?(action: PrivacyAction, backupId?: string): Promise<void>;
 status():Promise<StartupStatus>;
 choose(location:'documents'|'dropbox'|'drive'|'choose',mode:'create'|'open'):Promise<WorkspaceSelection>;
 open(token:string,deviceLabel:string):Promise<void>;
}
