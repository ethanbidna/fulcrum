import {expect,test} from 'vitest';
import {mkdtemp,rm,mkdir,symlink,unlink,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {openWorkspaceHost} from '../../apps/core/src/workspace.ts';
const USER='08000000-0000-7000-8000-000000000001';const INITIATIVE='01000000-0000-7000-8000-000000000001';
async function fixture(run){const root=await mkdtemp(path.join(tmpdir(),'fulcrum-admin-'));const options={workspaceDirectory:path.join(root,'workspace'),localDirectory:path.join(root,'local'),userEntityId:USER,deviceLabel:'Synthetic Mac',create:true};let host;try{host=await openWorkspaceHost(options);await run({root,options,host});}finally{await host?.close();await rm(root,{recursive:true,force:true});}}
test('local administration backs up/restores a separate identity and point-in-time reads never write',async()=>fixture(async f=>{
 const first=await f.host.execute({name:'initiative.create',args:{record:{id:INITIATIVE,title:'Original synthetic title'}}});expect(first.ok).toBe(true);
 expect((await f.host.execute({name:'initiative.update',args:{id:INITIATIVE,patch:{title:'Later synthetic title'}}})).ok).toBe(true);
 const before=await f.host.query('history.list',{});const preview=await f.host.administer('history.preview',{eventId:first.eventId});expect(preview.state.initiatives[0].title).toBe('Original synthetic title');expect((await f.host.query('initiative.get',{id:INITIATIVE})).title).toBe('Later synthetic title');expect(await f.host.query('history.list',{})).toEqual(before);
 const backup=await f.host.administer('backup.create',{});const restored=await f.host.administer('backup.restore',{backupId:backup.id});expect(restored.workspaceId).not.toBe(backup.workspaceId);expect(restored.directory.startsWith(await realpath(f.options.localDirectory))).toBe(true);expect((await f.host.administer('status',{})).backups).toHaveLength(1);
 await expect(f.host.administer('history.preview',{eventId:'unknown'})).rejects.toThrow();await expect(f.host.administer('backup.restore',{backupId:'../workspace'})).rejects.toThrow();await expect(f.host.administer('backup.create',{destination:'chosen-by-source'})).rejects.toThrow();
}));
test('background and backup preferences persist locally; sources and MCP remain disabled',async()=>fixture(async f=>{
 const before=await f.host.administer('status',{});expect(before.ingestionEnabled).toBe(false);expect(before.backupFrequency).toBe('disabled');
 await f.host.administer('background.configure',{paused:true,onlyWhenPluggedIn:true});await f.host.administer('backup.configure',{frequency:'weekly'});await f.host.close();
 const reopened=await openWorkspaceHost({...f.options,create:false});try{const status=await reopened.administer('status',{});expect(status).toMatchObject({backgroundPaused:true,onlyWhenPluggedIn:true,backupFrequency:'weekly',ingestionEnabled:false});await expect(reopened.mcpQuery('administration',{})).rejects.toThrow('MCP_DISABLED');}finally{await reopened.close();}
}));
test('a failed local preference read releases the store lock before retry',async()=>fixture(async f=>{
 await f.host.close();const other=path.join(f.root,'other');await mkdir(other);const file=path.join(f.options.localDirectory,'background-settings.json');await symlink(other,file);await expect(openWorkspaceHost({...f.options,create:false})).rejects.toThrow();await unlink(file);const retried=await openWorkspaceHost({...f.options,create:false});await retried.close();
}));
