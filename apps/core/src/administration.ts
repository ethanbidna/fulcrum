import { releaseLaunch } from './release-paths.js';
import type {AiSetup}from'./ai-setup.js';
import os from 'node:os';
import path from 'node:path';
import { McpInstallation } from '@fulcrum/store';
import type { Domain, AdministrationName, AdministrationArgs, AdministrationResults, LocalConfiguration } from '@fulcrum/domain';
import { WorkspaceArchives, LocalPreferences } from '@fulcrum/store';
import type { WorkspaceOptions } from './workspace.js';
import type { BackgroundPolicy } from '@fulcrum/ingest';
const STALE_DEVICE_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_FIELDS: Record<AdministrationName, string[]> = {'ai.preferences':['preference'],'ai.status':[],'ai.start':['choiceId','licenseAccepted','sharingAcknowledged','apiKey','initiativeIds','dailyTokenBudget'],'ai.job':['id'],'ai.cancel':['id'],'ai.none':[],'workspace.setupStatus':[],'workspace.configure':['deviceLabel','ingestion','handoverConfirmed','userEntityId'],'workspace.finishSetup':[],'mcp.install':['confirmed'], 'mcp.status':[], 'mcp.activity':[], 'mcp.configure':['enabled','readOnly','sharingAcknowledged','sourceExcerpts','questionsVisible','initiativeIds','categoryIds'], status:[], 'backup.create':[], 'backup.configure':['frequency'], 'backup.restore':['backupId'], 'history.preview':['eventId'], 'background.configure':['paused','onlyWhenPluggedIn']};
export async function openAdministration(options: WorkspaceOptions, deviceId: string, domain: ()=>Domain, background: BackgroundPolicy, ingestionEnabled: ()=>boolean, mcp: {status():AdministrationResults['mcp.status'];configure(input:unknown):Promise<AdministrationResults['mcp.configure']>;activity():Promise<AdministrationResults['mcp.activity']>},ai:AiSetup,configureIdentity:(userEntityId:string,label:string)=>Promise<void>) {
  const archives=await WorkspaceArchives.open({workspaceDirectory:options.workspaceDirectory,localDirectory:options.localDirectory,...(options.encryption?{encryption:options.encryption}:{}),...(options.schemaDirectory?{schemaDirectory:options.schemaDirectory}:{})});
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
      case 'ai.status':result=await ai.status();break;
      case 'ai.preferences':result=await ai.savePreference(args.preference);break;
      case 'ai.start':result=await ai.start(args as unknown as AdministrationArgs['ai.start']);break;
      case 'ai.job':if(typeof args.id!=='string')throw new Error('INVALID_SETUP_JOB');result=ai.statusJob(args.id);break;
      case 'ai.cancel':if(typeof args.id!=='string')throw new Error('INVALID_SETUP_JOB');ai.cancel(args.id);result={};break;
      case 'ai.none':result=await ai.none();break;
      case 'workspace.setupStatus':{const saved=await preferences.read('setup') as {workspaceIds?:string[]}|undefined;const snapshot=domain().getSnapshot();result={completed:saved?.workspaceIds?.includes(snapshot.workspaceId)??false,deviceId,deviceLabel:options.deviceLabel,ingestionDeviceId:snapshot.state.settings.ingestionDeviceId??null,people:snapshot.state.entities.filter(item=>item.type==='person').map(({id,label})=>({id,label})),userEntityId:options.userEntityId};break;}
      case 'workspace.configure':{
        if(typeof args.deviceLabel!=='string'||!args.deviceLabel.trim()||args.deviceLabel.length>80||!['keep','this_mac'].includes(String(args.ingestion))||typeof args.handoverConfirmed!=='boolean')throw new Error('INVALID_WORKSPACE_SETUP');
        if(ingestionEnabled())throw new Error('Pause source ingestion before changing local identity.');
        const state=domain().getSnapshot().state;let userEntityId=options.userEntityId;
        if(args.ingestion==='this_mac'&&state.settings.ingestionDeviceId&&state.settings.ingestionDeviceId!==deviceId&&args.handoverConfirmed!==true)throw new Error('Confirm the ingestion move.');
        const commands:{name:string;args:Record<string,unknown>}[]=[];
        if(args.userEntityId!==undefined){if(typeof args.userEntityId!=='string'||!state.entities.some(item=>item.id===args.userEntityId&&item.type==='person'))throw new Error('Choose your person record.');userEntityId=args.userEntityId;}
        else if(!state.entities.some(item=>item.id===userEntityId)){if(state.entities.some(item=>item.type==='person'))throw new Error('Choose which person is you in this workspace.');commands.push({name:'entity.create',args:{record:{id:userEntityId,type:'person',label:'You',aliases:[]}}});}
        if(state.devices?.find(item=>item.id===deviceId)?.label!==args.deviceLabel)commands.push({name:'device.rename',args:{id:deviceId,label:args.deviceLabel}});
        if(args.ingestion==='this_mac'&&state.settings.ingestionDeviceId!==deviceId)commands.push({name:'settings.setIngestionDevice',args:{ingestionDeviceId:deviceId}});
        if(commands.length){const applied=await domain().execute({name:'command.apply',args:{commands},actor:'user'});if(!applied.ok)throw new Error(applied.error.message);}
        await configureIdentity(userEntityId,args.deviceLabel);result={deviceId,userEntityId};break;
      }
      case 'workspace.finishSetup':{const snapshot=domain().getSnapshot();const saved=await preferences.read('setup') as {workspaceIds?:string[]}|undefined;await preferences.write('setup',{workspaceIds:[...new Set([...(saved?.workspaceIds??[]),snapshot.workspaceId])]});result={};break;}
      case 'mcp.install':if(args.confirmed!==true||!mcp.status().access.enabled)throw new Error('MCP_INSTALL_CONFIRMATION_REQUIRED');result=await new McpInstallation(path.join(os.homedir(),'Library','Application Support','Claude','claude_desktop_config.json'),releaseLaunch('mcp').command,releaseLaunch('mcp').args).install();break;
      case 'mcp.status':result=mcp.status();break;
      case 'mcp.configure':result=await mcp.configure(args);break;
      case 'mcp.activity':result=await mcp.activity();break;
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
