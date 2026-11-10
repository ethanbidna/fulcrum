import type { Domain, AdministrationName, AdministrationArgs, AdministrationResults, LocalConfiguration } from '@fulcrum/domain';
import { WorkspaceArchives, LocalPreferences } from '@fulcrum/store';
import type { WorkspaceOptions } from './workspace.js';
import type { BackgroundPolicy } from '@fulcrum/ingest';
const STALE_DEVICE_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_FIELDS: Record<AdministrationName, string[]> = {status:[], 'backup.create':[], 'backup.configure':['frequency'], 'backup.restore':['backupId'], 'history.preview':['eventId'], 'background.configure':['paused','onlyWhenPluggedIn']};
export async function openAdministration(options: WorkspaceOptions, deviceId: string, domain: ()=>Domain, background: BackgroundPolicy, ingestionEnabled: ()=>boolean) {
  const archives=await WorkspaceArchives.open({workspaceDirectory:options.workspaceDirectory,localDirectory:options.localDirectory,...(options.schemaDirectory?{schemaDirectory:options.schemaDirectory}:{})});
  let backupError=false;
  const preferences=new LocalPreferences(options.localDirectory);
  const saved=await preferences.read('background');
  if(saved!==undefined){
    if(!saved||typeof saved!=='object'||Array.isArray(saved))throw new Error('INVALID_BACKGROUND_SETTING');
    background.configure(saved);
  }
  async function status():Promise<LocalConfiguration>{
    const snapshot=domain().getSnapshot();const settings=snapshot.state.settings;const devices=snapshot.state.devices??[];
    const event=domain().history().filter(event=>event.deviceId===settings.ingestionDeviceId).at(-1);
    const lastSeen=event?Number(event.hlc.split('-')[0]):null;const current=background.status(Date.now());
    return {workspaceId:snapshot.workspaceId,workspaceDirectory:options.workspaceDirectory,deviceId,deviceLabel:options.deviceLabel,devices:devices.map(({id,label})=>({id,label})),
      ingestionDeviceId:settings.ingestionDeviceId??null,ingestionLastSeenAt:lastSeen===null?null:new Date(lastSeen).toISOString(),ingestionStale:lastSeen!==null&&Date.now()-lastSeen>=STALE_DEVICE_MS,
      cachePolicy:settings.defaultCachePolicy??'none',backupFrequency:await archives.cadence(),backups:await archives.list(),backgroundPaused:current.settings.paused,onlyWhenPluggedIn:current.settings.onlyWhenPluggedIn,backgroundReason:current.sourcePause,ingestionEnabled:ingestionEnabled(),backupError,backupRetentionError:archives.retentionFailed};
  }
  async function request<N extends AdministrationName>(name:N,input:AdministrationArgs[N]):Promise<AdministrationResults[N]>{
    if(!Object.hasOwn(ALLOWED_FIELDS,name)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!ALLOWED_FIELDS[name].includes(key)))throw new Error('INVALID_ADMINISTRATION_REQUEST');
    const args=input as Record<string,unknown>;let result:AdministrationResults[AdministrationName];
    switch(name){
      case 'status':result=await status();break;
      case 'backup.create':result=await archives.backup();backupError=false;break;
      case 'backup.configure':await archives.configure(args.frequency as AdministrationArgs['backup.configure']['frequency']);result={frequency:await archives.cadence()};break;
      case 'backup.restore':if(typeof args.backupId!=='string')throw new Error('INVALID_BACKUP');result=await archives.restore(args.backupId);break;
      case 'history.preview':if(typeof args.eventId!=='string')throw new Error('INVALID_HISTORY');result=domain().snapshotAt(args.eventId);break;
      case 'background.configure':{
        const previous=background.status(Date.now()).settings;background.configure(args);
        const settings=background.status(Date.now()).settings;
        try{await preferences.write('background',{paused:settings.paused,onlyWhenPluggedIn:settings.onlyWhenPluggedIn});}
        catch(error){background.configure(previous);throw error;}
        result={paused:settings.paused,onlyWhenPluggedIn:settings.onlyWhenPluggedIn};break;
      }
      default:throw new Error('INVALID_ADMINISTRATION_REQUEST');
    }
    return result as AdministrationResults[N];
  }
  return {request,async tick(){try{if(await archives.due()){const cadence=await archives.cadence();if(cadence!=='disabled')await archives.backup({kind:cadence});}backupError=false;}catch{backupError=true;}}};
}
