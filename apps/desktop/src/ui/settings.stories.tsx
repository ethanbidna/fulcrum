import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Settings } from './settings.js';
import { App } from './app.js';
import { workshopFixture } from './workshop-fixture.js';
import type { LocalConfiguration, CommandResult } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import './tokens.css';
const initial: LocalConfiguration={workspaceId:'10000000-0000-7000-8000-000000000001',workspaceDirectory:'Synthetic workspace folder',deviceId:'09000000-0000-7000-8000-000000000001',deviceLabel:'Synthetic Mac',cachePolicy:'none',ingestionDeviceId:'09000000-0000-7000-8000-000000000002',devices:[{id:'09000000-0000-7000-8000-000000000001',label:'Synthetic Mac'},{id:'09000000-0000-7000-8000-000000000002',label:'Synthetic Desk Mac'}],ingestionLastSeenAt:'2026-11-01T12:00:00Z',ingestionStale:true,backupFrequency:'disabled',backups:[{kind:'manual',id:'09000000-0000-7000-8000-000000000003',workspaceId:'10000000-0000-7000-8000-000000000001',createdAt:'2026-11-10T12:00:00Z',eventCount:12,lastHlc:'1794312000000-0000'}],backgroundPaused:false,onlyWhenPluggedIn:false,backgroundReason:'Native signals unavailable in browser preview.',ingestionEnabled:false,backupError:false};
let current=structuredClone(initial);
const administer=fn(async(name:string,args:Record<string,unknown>)=>{
 if(name==='status')return current;
 if(name==='mcp.configure')return args;
 if(name==='mcp.status')return {access:{enabled:false,readOnly:true,sharingAcknowledged:false,sourceExcerpts:false,questionsVisible:true},initiatives:[{id:'01000000-0000-7000-8000-000000000001',title:'Synthetic launch'}],categories:[]};
 if(name==='background.configure'){current={...current,...(args.paused===undefined?{}:{backgroundPaused:args.paused as boolean}),...(args.onlyWhenPluggedIn===undefined?{}:{onlyWhenPluggedIn:args.onlyWhenPluggedIn as boolean})};return {paused:current.backgroundPaused,onlyWhenPluggedIn:current.onlyWhenPluggedIn};}
 if(name==='backup.configure'){current={...current,backupFrequency:args.frequency as LocalConfiguration['backupFrequency']};return {frequency:current.backupFrequency};}
 if(name==='backup.create')return current.backups[0];
 if(name==='backup.restore')return {workspaceId:'10000000-0000-7000-8000-000000000002',directory:'Synthetic restored folder'};
 throw new Error('Unavailable');
}) as NonNullable<CoreTransport['administer']>;
const query=fn(async()=>[]) as CoreTransport['query'];
const execute=fn(async():Promise<CommandResult>=>({ok:true,eventId:'synthetic',ops:[],raisedQuestionIds:[],suggestedAssertionIds:[]}));
const meta={component:Settings,title:'Settings/Local workspace',args:{administer,query,execute},beforeEach:()=>{current=structuredClone(initial);window.location.hash='#settings/workspace';},parameters:{layout:'padded'}} satisfies Meta<typeof Settings>;
export default meta;
type Story=StoryObj<typeof meta>;
export const WorkspaceAndHandover:Story={play:async({canvas,userEvent})=>{await canvas.findByText('Synthetic workspace folder');const button=canvas.getByRole('button',{name:'Make this Mac the ingestion device'});await expect(button).toBeDisabled();await userEvent.click(canvas.getByRole('checkbox',{name:'I will reconnect sources and choose scopes on this Mac.'}));await expect(button).toBeEnabled();}};
export const BackupAndRecovery:Story={beforeEach:()=>{window.location.hash='#settings/backup';},play:async({canvas,userEvent})=>{await canvas.findByRole('button',{name:'Create backup now'});await userEvent.selectOptions(canvas.getByLabelText('Backup'),initial.backups[0]!.id);const restore=canvas.getByRole('button',{name:'Restore as new workspace'});await expect(restore).toBeDisabled();await userEvent.click(canvas.getByRole('checkbox',{name:'Create a new plaintext workspace; keep the original and backup.'}));await userEvent.click(restore);await canvas.findByText('Restored folder: Synthetic restored folder');}};
export const BackgroundPreferences:Story={beforeEach:()=>{window.location.hash='#settings/background';},play:async({canvas,userEvent})=>{const checkbox=await canvas.findByRole('checkbox',{name:'Only work in the background when plugged in'});await userEvent.click(checkbox);await waitFor(()=>expect(checkbox).toBeChecked());}};
export const EmptyBackups:Story={beforeEach:()=>{current={...structuredClone(initial),backups:[]};window.location.hash='#settings/backup';}};
export const Loading:Story={args:{administer:fn(()=>new Promise(()=>{})) as NonNullable<CoreTransport['administer']>}};
export const Unavailable:Story={args:{administer:fn(async()=>{throw new Error('Unavailable');})},play:async({canvas,userEvent})=>{await canvas.findByRole('alert');await userEvent.click(canvas.getByRole('button',{name:'Retry settings'}));await canvas.findByRole('alert');}};
export const InApplication:Story={beforeEach:()=>{window.location.hash='#settings/backup';},render:()=>{const fixture=workshopFixture();fixture.transport.administer=administer;return <App platform={fixture.platform}/>;},play:async({canvas})=>{await canvas.findByRole('heading',{name:'Backup & Recovery',level:2});}};

export const HistoryUnavailable:Story={beforeEach:()=>{window.location.hash='#settings/backup';},args:{query:fn(async()=>{throw new Error('Unavailable');}) as CoreTransport['query']},play:async({canvas,userEvent})=>{await canvas.findByText('Could not load retained changes.');await expect(canvas.queryByText('No retained changes are available to preview.')).not.toBeInTheDocument();await userEvent.click(canvas.getByRole('button',{name:'Retry history'}));await canvas.findByText('Could not load retained changes.');}};

export const McpInApplication:Story={beforeEach:()=>{window.location.hash='#settings/mcp';},render:()=>{const fixture=workshopFixture();fixture.transport.administer=administer;return <App platform={fixture.platform}/>;},play:async({canvas})=>{await canvas.findByRole('checkbox',{name:'Allow MCP clients'});}};

const privacy = fn<(action: 'copy' | 'lock' | 'restore', backupId?: string) => Promise<void>>(async () => {});
export const PlaintextPrivacy:Story={
  args:{privacy},
  beforeEach:()=>{window.location.hash='#settings/privacy';privacy.mockClear();},
  play:async({canvas,userEvent})=>{
    const button=await canvas.findByRole('button',{name:'Create encrypted copy…'});
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(privacy).toHaveBeenCalledWith('copy');
  },
};
export const EncryptedPrivacy:Story={
  args:{privacy},
  beforeEach:()=>{current={...structuredClone(initial),encrypted:true};window.location.hash='#settings/privacy';privacy.mockClear();},
  play:async({canvas,userEvent})=>{
    await canvas.findByText('This workspace’s canonical history is encrypted.');
    await userEvent.click(canvas.getByRole('button',{name:'Lock workspace'}));
    await expect(privacy).toHaveBeenCalledWith('lock');
    await expect(canvas.queryByRole('button',{name:'Create encrypted copy…'})).not.toBeInTheDocument();
  },
};

export const EncryptedBackupRestore:Story={
 args:{privacy},
 beforeEach:()=>{current={...structuredClone(initial),encrypted:true};window.location.hash='#settings/backup';privacy.mockClear();},
 play:async({canvas,userEvent})=>{
  await userEvent.selectOptions(await canvas.findByLabelText('Backup'),initial.backups[0]!.id);
  const button=canvas.getByRole('button',{name:'Restore as new workspace'});
  await expect(button).toBeDisabled();
  await userEvent.click(canvas.getByRole('checkbox',{name:'Create a new encrypted workspace with a new recovery card; keep the original and backup.'}));
  await userEvent.click(button);
  await expect(privacy).toHaveBeenCalledWith('restore',initial.backups[0]!.id);
 },
};
