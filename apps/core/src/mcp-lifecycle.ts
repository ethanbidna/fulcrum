import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { LocalPreferences } from '@fulcrum/store';
import { SocketClient } from './socket-client.js';
import { validateMcpAccess } from './mcp-access.js';
import path from 'node:path';
const STARTUP_ATTEMPTS = 100;
const STARTUP_POLL_MS = 100;
export interface HeadlessPorts {
  connect(socketPath:string,secret:string):Promise<SocketClient>;
  launch(args:string[]):void;
  wait():Promise<void>;
}
const DEFAULT_PORTS:HeadlessPorts={connect:SocketClient.connect,launch:args=>{const child=spawn(process.execPath,args,{detached:true,stdio:'ignore'});child.on('error',()=>undefined);child.unref();},wait:()=>setTimeout(STARTUP_POLL_MS)};
export async function connectHeadless(localDirectory:string,secret:string,ports:HeadlessPorts=DEFAULT_PORTS){
  const preferences=new LocalPreferences(localDirectory);
  const access=validateMcpAccess(await preferences.read('mcp')??{});if(!access.enabled)throw new Error('MCP_DISABLED');
  const connect=()=>ports.connect(path.join(localDirectory,'core.sock'),secret);
  try{return await connect();}catch{/* The profile lock arbitrates competing launchers. */}
  const profile=await preferences.read('activeWorkspace');
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new Error('MCP_WORKSPACE_REQUIRED');
  const fields=profile as Record<string,unknown>;
  if(Object.keys(fields).some(key=>!['workspaceDirectory','userEntityId'].includes(key))||typeof fields.workspaceDirectory!=='string'||!path.isAbsolute(fields.workspaceDirectory)||typeof fields.userEntityId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fields.userEntityId))throw new Error('MCP_WORKSPACE_REQUIRED');
  ports.launch([fileURLToPath(new URL('./core.mjs',import.meta.url)),'--workspace',fields.workspaceDirectory,'--user-entity',fields.userEntityId]);
  for(let attempt=0;attempt<STARTUP_ATTEMPTS;attempt++){await ports.wait();try{return await connect();}catch{continue;}}
  throw new Error('MCP_CORE_STARTUP_FAILED');
}
