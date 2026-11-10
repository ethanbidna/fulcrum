import type {Meta,StoryObj} from '@storybook/react-vite';
import {expect,fn} from 'storybook/test';
import {McpSettings} from './mcp-settings.js';
import type {CoreTransport} from '../core-transport.js';
import type {McpConfiguration} from '@fulcrum/domain';
import './tokens.css';
const INITIATIVE='01000000-0000-7000-8000-000000000001';
const defaults:McpConfiguration={enabled:false,readOnly:true,sharingAcknowledged:false,sourceExcerpts:false,questionsVisible:true};
let access={...defaults};
const administer=fn(async(name:string,args:unknown)=>{
 if(name==='mcp.status')return {access,initiatives:[{id:INITIATIVE,title:'Synthetic launch'}],categories:[{id:'04000000-0000-7000-8000-000000000001',name:'Synthetic operations'}]};
 if(name==='mcp.configure'){access=args as McpConfiguration;return access;}
 if(name==='mcp.install')return {configurationFile:'Synthetic Claude configuration'};
 if(name==='mcp.activity')return [];
 throw new Error('Unavailable');
}) as NonNullable<CoreTransport['administer']>;
const meta={title:'Settings/MCP sharing',component:McpSettings,args:{administer},beforeEach:()=>{access={...defaults};},parameters:{layout:'padded'}} satisfies Meta<typeof McpSettings>;
export default meta;type Story=StoryObj<typeof meta>;
export const DisabledByDefault:Story={play:async({canvas,userEvent})=>{const allow=await canvas.findByRole('checkbox',{name:'Allow MCP clients'});await expect(allow).toBeDisabled();await expect(canvas.getByLabelText('Access')).toHaveValue('read');await userEvent.click(canvas.getByRole('checkbox',{name:'I understand that returned data may leave this Mac through my MCP client.'}));await userEvent.click(allow);await userEvent.click(canvas.getByRole('button',{name:'Save MCP settings'}));await canvas.findByText('MCP sharing settings saved on this Mac.');await expect(canvas.getByRole('checkbox',{name:'Share retained source excerpts'})).not.toBeChecked();}};
export const SelectedInitiatives:Story={beforeEach:()=>{access={...defaults,enabled:true,sharingAcknowledged:true,initiativeIds:[INITIATIVE]};},play:async({canvas,userEvent})=>{await canvas.findByRole('group',{name:'Shared initiatives'});await userEvent.click(canvas.getByRole('checkbox',{name:'Synthetic launch'}));await userEvent.click(canvas.getByRole('button',{name:'Save MCP settings'}));await canvas.findByText('MCP sharing settings saved on this Mac.');await expect(canvas.getByRole('checkbox',{name:'Synthetic launch'})).not.toBeChecked();}};
export const ClientInstallation:Story={beforeEach:()=>{access={...defaults,enabled:true,sharingAcknowledged:true};},play:async({canvas,userEvent})=>{const install=await canvas.findByRole('button',{name:'Add to Claude Desktop'});await expect(install).toBeDisabled();await userEvent.click(canvas.getByRole('checkbox',{name:'Add Fulcrum to my Claude Desktop configuration.'}));await userEvent.click(install);await canvas.findByText('Fulcrum added. Fully quit and reopen Claude Desktop.');}};
export const EmptyActivity:Story={play:async({canvas,userEvent})=>{await userEvent.click(await canvas.findByRole('button',{name:'Refresh MCP activity'}));await canvas.findByText('No MCP calls recorded.');}};
export const Loading:Story={args:{administer:fn(()=>new Promise(()=>{})) as NonNullable<CoreTransport['administer']>}};
export const Unavailable:Story={args:{administer:fn(async()=>{throw new Error('Unavailable');})},play:async({canvas,userEvent})=>{await canvas.findByRole('alert');await userEvent.click(canvas.getByRole('button',{name:'Retry MCP settings'}));await canvas.findByRole('alert');}};
export const FailedSave:Story={args:{administer:fn(async(name:string)=>{if(name==='mcp.status')return {access:defaults,initiatives:[],categories:[]};throw new Error('Disk unavailable');}) as NonNullable<CoreTransport['administer']>},play:async({canvas,userEvent})=>{await userEvent.click(await canvas.findByRole('button',{name:'Save MCP settings'}));await canvas.findByRole('alert');await expect(canvas.queryByText('MCP sharing settings saved on this Mac.')).not.toBeInTheDocument();}};
export const UnsavedScopeBeforeInstallation:Story={beforeEach:()=>{access={...defaults,enabled:true,sharingAcknowledged:true};},play:async({canvas,userEvent})=>{
 await userEvent.click(await canvas.findByRole('checkbox',{name:'Add Fulcrum to my Claude Desktop configuration.'}));
 const install=canvas.getByRole('button',{name:'Add to Claude Desktop'});await expect(install).toBeEnabled();
 await userEvent.selectOptions(canvas.getByLabelText('Initiatives to share'),'initiatives');await expect(install).toBeDisabled();await canvas.findByText('Save your sharing changes before adding the client.');
 await userEvent.click(canvas.getByRole('button',{name:'Save MCP settings'}));await canvas.findByText('MCP sharing settings saved on this Mac.');await expect(install).toBeEnabled();
}};
