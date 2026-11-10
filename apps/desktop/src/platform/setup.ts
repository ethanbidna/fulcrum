import type{StartupStatus,WorkspaceSelection}from'@fulcrum/domain';
export interface WorkspaceSetup{
 status():Promise<StartupStatus>;
 choose(location:'documents'|'dropbox'|'drive'|'choose',mode:'create'|'open'):Promise<WorkspaceSelection>;
 open(token:string,deviceLabel:string):Promise<void>;
}
