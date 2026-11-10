import {expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LocalPreferences} from '../../packages/store/src/preferences.ts';
import {connectHeadless} from '../../apps/core/src/mcp-lifecycle.ts';
test('headless launch requires local opt-in and uses only the saved workspace as an argument',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'fulcrum-headless-'));try{
 const profile=new LocalPreferences(directory);const client={close:vi.fn()};const ports={connect:vi.fn(async()=>client),launch:vi.fn(),wait:vi.fn(async()=>{})};await expect(connectHeadless(directory,'synthetic',ports)).rejects.toThrow('MCP_DISABLED');expect(ports.connect).not.toHaveBeenCalled();
 await profile.write('mcp',{enabled:true,sharingAcknowledged:true});await profile.write('activeWorkspace',{workspaceDirectory:path.join(directory,'Synthetic workspace $(literal)'),userEntityId:'08000000-0000-7000-8000-000000000001'});
 expect(await connectHeadless(directory,'synthetic',ports)).toBe(client);expect(ports.launch).not.toHaveBeenCalled();
 ports.connect.mockRejectedValueOnce(new Error('Offline'));expect(await connectHeadless(directory,'synthetic',ports)).toBe(client);expect(ports.launch).toHaveBeenCalledOnce();const args=ports.launch.mock.calls[0][0];expect(args.slice(1)).toEqual(['--workspace',path.join(directory,'Synthetic workspace $(literal)'),'--user-entity','08000000-0000-7000-8000-000000000001']);
 ports.connect.mockRejectedValue(new Error('Offline'));await expect(connectHeadless(directory,'synthetic',ports)).rejects.toThrow('MCP_CORE_STARTUP_FAILED');
 }finally{await rm(directory,{recursive:true,force:true});}
});
