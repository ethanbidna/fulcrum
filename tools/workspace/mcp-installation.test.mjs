import {expect,test} from 'vitest';
import {mkdtemp,readFile,writeFile,readdir,rm,symlink,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {McpInstallation} from '../../packages/store/src/mcp-installation.ts';
import {LocalMcpActivity} from '../../packages/store/src/activity.ts';
test('Claude installation backs up existing configuration and preserves unrelated servers',async()=>{
 const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'fulcrum-install-')));try{
 const file=path.join(directory,'claude.json');const entry=path.join(directory,'mcp.mjs');await writeFile(entry,'// Synthetic entry');const original=JSON.stringify({theme:'system',mcpServers:{other:{command:'synthetic-other'}}});await writeFile(file,original);
 await new McpInstallation(file,'synthetic-node',entry).install();const configured=JSON.parse(await readFile(file,'utf8'));expect(configured).toMatchObject({theme:'system',mcpServers:{other:{command:'synthetic-other'},fulcrum:{command:'synthetic-node',args:[entry]}}});const backup=(await readdir(directory)).find(name=>name.includes('fulcrum-backup'));expect(await readFile(path.join(directory,backup),'utf8')).toBe(original);
 await writeFile(file,'{broken');await expect(new McpInstallation(file,'synthetic-node',entry).install()).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('{broken');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('activity log rejects symlink redirection and never records arguments',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'fulcrum-activity-'));try{const target=path.join(directory,'target');await writeFile(target,'unchanged');await symlink(target,path.join(directory,'mcp-access.log'));const activity=new LocalMcpActivity(directory);await expect(activity.append({at:'2026-11-10T12:00:00Z',tool:'unknown',outcome:'denied',recordIds:[]})).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('unchanged');}finally{await rm(directory,{recursive:true,force:true});}
});
