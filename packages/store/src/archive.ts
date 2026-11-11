import { mkdir, readFile, readdir, lstat, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkspaceManifest } from '@fulcrum/schema';
import { durableFile, syncDirectory, atomicFile, uuid, UUID, StoreError, resolvedLocation } from './files.js';
import { inventory, readWorkspace } from './reader.js';
import { loadStoreValidators } from './validation.js';
import type { WorkspaceEncryption } from './encryption.js';
import type { StoreValidators } from './validation.js';
export type BackupCadence = 'disabled' | 'daily' | 'weekly';
export type BackupKind = 'manual' | 'daily' | 'weekly';
export interface BackupSummary { kind: BackupKind; id: string; workspaceId: string; createdAt: string; eventCount: number; lastHlc: string | null }
interface Receipt extends BackupSummary { digest: string }
export interface ArchiveOptions { encryption?: WorkspaceEncryption; workspaceDirectory: string; localDirectory: string; schemaDirectory?: URL; now?: () => Date; fault?: (stage: 'backup-before-manifest' | 'backup-before-receipt' | 'restore-before-manifest' | 'retention-before-remove') => Promise<void> }
const DAY_MS = 24 * 60 * 60 * 1000;
const CADENCE_MS = { daily: DAY_MS, weekly: 7 * DAY_MS };
const PRIVATE_DIRECTORY_MODE = 0o700;
const RETAINED_BACKUPS = {daily: 14, weekly: 8};
const SETTINGS_FILE = 'backup-settings.json';
export class WorkspaceArchives {
  private cleanupFailed=false;
  get retentionFailed(){return this.cleanupFailed;}
  private constructor(private readonly options: ArchiveOptions, private readonly validators: StoreValidators) {}
  static async open(options: ArchiveOptions) {
    const workspace = await resolvedLocation(options.workspaceDirectory); const local = await resolvedLocation(options.localDirectory);
    const relative = path.relative(workspace, local);
    if (!relative || relative === '.' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new StoreError('LOCAL_DIRECTORY_IN_WORKSPACE','Archives must remain outside the workspace');
    await mkdir(local,{recursive:true,mode:PRIVATE_DIRECTORY_MODE});
    const localEntry=await lstat(local);if(!localEntry.isDirectory()||localEntry.isSymbolicLink()||localEntry.uid!==process.getuid?.())throw new StoreError('ARCHIVE_PATH_UNSAFE','Expected a local profile directory');
    await chmod(local,PRIVATE_DIRECTORY_MODE);
    return new WorkspaceArchives({...options,workspaceDirectory:workspace,localDirectory:local},await loadStoreValidators(options.schemaDirectory));
  }
  async list(): Promise<BackupSummary[]> {
    const root = await this.backupRoot(); const result: BackupSummary[] = [];
    for (const entry of await readdir(root,{withFileTypes:true})) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try { const receipt = await this.receipt(entry.name); const {digest: _digest, ...summary}=receipt; void _digest; result.push(summary); }
      catch { /* An unfinished backup has no valid completion receipt. */ }
    }
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  }
  async cadence(): Promise<BackupCadence> {
    try { const value=JSON.parse(await regularFile(path.join(this.options.localDirectory,SETTINGS_FILE))); if(!['disabled','daily','weekly'].includes(value.cadence)||Object.keys(value).length!==1)throw new Error();return value.cadence; }
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 'disabled';throw new StoreError('BACKUP_SETTINGS_INVALID','Backup settings could not be read');}
  }
  async configure(cadence: BackupCadence) {
    if(!['disabled','daily','weekly'].includes(cadence))throw new StoreError('BACKUP_SETTINGS_INVALID','Choose disabled, daily or weekly');
    await atomicFile(path.join(this.options.localDirectory,SETTINGS_FILE),JSON.stringify({cadence}));
  }
  async due(): Promise<boolean> {
    const cadence=await this.cadence();if(cadence==='disabled')return false;
    const workspaceId=(await this.readSupported(this.options.workspaceDirectory)).manifest.workspaceId;
    const latest=(await this.list()).find(item=>item.workspaceId===workspaceId);return !latest||this.now().getTime()-Date.parse(latest.createdAt)>=CADENCE_MS[cadence];
  }
  async backup(options: {kind: BackupKind} = {kind:'manual'}): Promise<BackupSummary> {
    if(!['manual','daily','weekly'].includes(options.kind))throw new StoreError('BACKUP_SETTINGS_INVALID','Unknown backup kind');
    const source=this.options.workspaceDirectory;const read=await this.readSupported(source);const before=await fileImage(source);
    const id=uuid();const root=path.join(await this.backupRoot(),id);await privateDirectory(root);
    const destination=path.join(root,'workspace');await privateDirectory(destination);
    await copyImage(source,destination,before.files.filter(file=>file!=='workspace.json'));
    await this.options.fault?.('backup-before-manifest');await durableFile(path.join(destination,'workspace.json'),await regularBytes(path.join(source,'workspace.json')));await syncDirectory(destination);
    const verified=await this.readSupported(destination);const after=await fileImage(source);const copied=await fileImage(destination);
    if(before.digest!==after.digest||before.digest!==copied.digest||JSON.stringify(read.events)!==JSON.stringify(verified.events))throw new StoreError('BACKUP_SOURCE_CHANGED','Workspace changed during backup; retry');
    await this.options.fault?.('backup-before-receipt');
    const summary:BackupSummary={kind:options.kind,id,workspaceId:read.manifest.workspaceId,createdAt:this.now().toISOString(),eventCount:read.events.length,lastHlc:read.events.at(-1)?.hlc??null};
    await durableFile(path.join(root,'receipt.json'),JSON.stringify({...summary,digest:copied.digest}));await syncDirectory(root);await syncDirectory(path.dirname(root));try{await this.prune(summary);this.cleanupFailed=false;}catch{this.cleanupFailed=true;}return summary;
  }
  async verify(id:string) {
    const receipt=await this.receipt(id);const directory=path.join(await this.backupRoot(),id,'workspace');
    const image=await fileImage(directory);const read=await this.readSupported(directory);
    if(image.digest!==receipt.digest||read.manifest.workspaceId!==receipt.workspaceId||read.events.length!==receipt.eventCount|| (read.events.at(-1)?.hlc??null)!==receipt.lastHlc)throw new StoreError('BACKUP_INVALID','Backup verification failed');
    return {directory,read};
  }
  async restore(id:string):Promise<{workspaceId:string;directory:string}> {
    const source=await this.verify(id);
    if(source.read.manifest.encryption)throw new StoreError('ENCRYPTED_RESTORE_REQUIRED','An encrypted backup requires a new encrypted copy and recovery key');
    const before=await fileImage(source.directory);
    const root=path.join(this.options.localDirectory,'restored');await privateDirectory(root);
    const manifest:WorkspaceManifest={format:'fulcrum-workspace',schemaVersion:1,workspaceId:uuid(),createdAt:this.now().toISOString()};
    const directory=path.join(root,manifest.workspaceId);await privateDirectory(directory);
    // Retained logs carry undo/protection history; checkpoints rebuild for the new identity.
    await copyImage(source.directory,directory,before.files.filter(file=>file.startsWith(`log${path.sep}`)));
    await this.options.fault?.('restore-before-manifest');await publishManifest(directory,manifest);
    const verified=await this.readSupported(directory);await this.verify(id);
    if(JSON.stringify(source.read.events)!==JSON.stringify(verified.events))throw new StoreError('RESTORE_INVALID','Restored history does not match the backup');
    await syncDirectory(root);return {workspaceId:manifest.workspaceId,directory};
  }
  private async prune(current:BackupSummary){
    if(current.kind==='manual')return;
    const keep=RETAINED_BACKUPS[current.kind];
    const older=(await this.list()).filter(item=>item.workspaceId===current.workspaceId&&item.kind===current.kind&&item.id!==current.id);
    for(const item of older.slice(keep-1)){
      const directory=path.join(await this.backupRoot(),item.id);await requirePrivateDirectory(directory);await this.receipt(item.id);await this.options.fault?.('retention-before-remove');await rm(directory,{recursive:true});
    }
    await syncDirectory(await this.backupRoot());
  }
  private now(){return this.options.now?.()??new Date();}
  private async readSupported(directory:string){const read=await readWorkspace(directory,this.validators,this.options.encryption);if(read.manifest.schemaVersion!==1&&!this.options.encryption)throw new StoreError('WORKSPACE_VERSION_UNSUPPORTED','Archives require a supported workspace codec');return read;}
  private async backupRoot(){const root=path.join(this.options.localDirectory,'backups');await privateDirectory(root);return root;}
  private async receipt(id:string):Promise<Receipt>{
    if(!UUID.test(id))throw new StoreError('BACKUP_INVALID','Invalid backup selection');
    const root=path.join(await this.backupRoot(),id);await requirePrivateDirectory(root);
    const receipt=JSON.parse(await regularFile(path.join(root,'receipt.json'))) as Receipt;
    if(Object.keys(receipt).some(key=>!['kind','id','workspaceId','createdAt','eventCount','lastHlc','digest'].includes(key))||!(receipt.lastHlc===null||/^\d{13}-\d{4}$/.test(receipt.lastHlc))||!['manual','daily','weekly'].includes(receipt.kind)||receipt.id!==id||!UUID.test(receipt.workspaceId)||!Number.isSafeInteger(receipt.eventCount)||receipt.eventCount<0||typeof receipt.createdAt!=='string'||!Number.isFinite(Date.parse(receipt.createdAt))||! /^[0-9a-f]{64}$/.test(receipt.digest))throw new StoreError('BACKUP_INVALID','Invalid backup receipt');
    return receipt;
  }
}
async function requirePrivateDirectory(directory:string){const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==PRIVATE_DIRECTORY_MODE)throw new StoreError('ARCHIVE_PATH_UNSAFE','Expected a private local archive directory');}
async function privateDirectory(directory:string){await mkdir(directory,{recursive:true,mode:PRIVATE_DIRECTORY_MODE});await requirePrivateDirectory(directory);}
async function regularBytes(file:string){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new StoreError('ARCHIVE_PATH_UNSAFE','Expected a regular archive file');return readFile(file);}
async function regularFile(file:string){return (await regularBytes(file)).toString('utf8');}
export async function fileImage(directory:string){
  const before=await inventory(directory);const digest=createHash('sha256');
  for(const relative of before.files){digest.update(relative);digest.update('\0');digest.update(await regularBytes(path.join(directory,relative)));digest.update('\0');}
  if(before.fingerprint!==(await inventory(directory)).fingerprint)throw new StoreError('WORKSPACE_CHANGING','Workspace changed during archive verification');
  return {files:before.files,digest:digest.digest('hex')};
}
async function copyImage(source:string,destination:string,files:string[]){for(const relative of files){const folder=path.dirname(path.join(destination,relative));await mkdir(folder,{recursive:true,mode:PRIVATE_DIRECTORY_MODE});await durableFile(path.join(destination,relative),await regularBytes(path.join(source,relative)));await syncDirectory(folder);await syncDirectory(path.dirname(folder));}}
async function publishManifest(directory:string,manifest:WorkspaceManifest){await durableFile(path.join(directory,'workspace.json'),JSON.stringify(manifest));await syncDirectory(directory);}
