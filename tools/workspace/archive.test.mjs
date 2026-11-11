import { expect, test } from 'vitest';
import { mkdtemp, cp, mkdir, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const RETENTION_TEST_TIMEOUT_MS = 30_000;
import { WorkspaceArchives } from '../../packages/store/src/archive.ts';
async function fixture(run){const root=await mkdtemp(path.join(os.tmpdir(),'fulcrum-archive-'));try{const workspaceDirectory=path.join(root,'workspace');await cp(new URL('../../fixtures/workspace-example/',import.meta.url),workspaceDirectory,{recursive:true});const localDirectory=path.join(root,'local');await mkdir(localDirectory,{mode:0o700});let now=new Date('2026-11-10T12:00:00Z');const archive=await WorkspaceArchives.open({workspaceDirectory,localDirectory,now:()=>now});await run({root,workspaceDirectory,localDirectory,archive,setNow:value=>{now=new Date(value);}});}finally{await rm(root,{recursive:true,force:true});}}
test('backup verifies exact retained bytes; restore uses a fresh identity and leaves source/backup untouched',async()=>fixture(async f=>{
 const manifest=await readFile(path.join(f.workspaceDirectory,'workspace.json'));const summary=await f.archive.backup();const verified=await f.archive.verify(summary.id);expect(await readFile(path.join(verified.directory,'workspace.json'))).toEqual(manifest);expect(summary.eventCount).toBeGreaterThan(0);
 const restored=await f.archive.restore(summary.id);expect(restored.workspaceId).not.toBe(summary.workspaceId);const restoredManifest=JSON.parse(await readFile(path.join(restored.directory,'workspace.json'),'utf8'));expect(restoredManifest.workspaceId).toBe(restored.workspaceId);expect(await readFile(path.join(f.workspaceDirectory,'workspace.json'))).toEqual(manifest);expect((await f.archive.verify(summary.id)).read.events).toEqual(verified.read.events);expect((await readdir(restored.directory)).sort()).toEqual(['log','workspace.json']);
}));
test('schedule is opt-in and daily/weekly cadence uses the injected clock',async()=>fixture(async f=>{
 expect(await f.archive.due()).toBe(false);await f.archive.configure('daily');expect(await f.archive.due()).toBe(true);await f.archive.backup();expect(await f.archive.due()).toBe(false);f.setNow('2026-11-11T12:00:00Z');expect(await f.archive.due()).toBe(true);await f.archive.configure('weekly');expect(await f.archive.due()).toBe(false);f.setNow('2026-11-17T12:00:00Z');expect(await f.archive.due()).toBe(true);
}));
test('corrupt backups, path traversal and workspace-local archives fail closed',async()=>fixture(async f=>{
 const summary=await f.archive.backup();const checked=await f.archive.verify(summary.id);await writeFile(path.join(checked.directory,'workspace.json'),'{}');await expect(f.archive.restore(summary.id)).rejects.toThrow();await expect(f.archive.restore('../other')).rejects.toThrow();await expect(WorkspaceArchives.open({workspaceDirectory:f.workspaceDirectory,localDirectory:path.join(f.workspaceDirectory,'backups')})).rejects.toThrow();
}));
test('failure before completion receipt never lists a successful backup; source changes abort acknowledgement',async()=>fixture(async f=>{
 const failed=await WorkspaceArchives.open({workspaceDirectory:f.workspaceDirectory,localDirectory:f.localDirectory,fault:async stage=>{if(stage==='backup-before-receipt')throw new Error('Synthetic disk failure');}});await expect(failed.backup()).rejects.toThrow('Synthetic disk failure');expect(await failed.list()).toEqual([]);
 const changing=await WorkspaceArchives.open({workspaceDirectory:f.workspaceDirectory,localDirectory:f.localDirectory,fault:async stage=>{if(stage==='backup-before-manifest')await writeFile(path.join(f.workspaceDirectory,'workspace.json'),(await readFile(path.join(f.workspaceDirectory,'workspace.json'),'utf8'))+'\n');}});await expect(changing.backup()).rejects.toThrow('Workspace changed');expect(await changing.list()).toEqual([]);
}));
test('a crash boundary before restore manifest leaves only an incomplete candidate',async()=>fixture(async f=>{
 const summary=await f.archive.backup();const failed=await WorkspaceArchives.open({workspaceDirectory:f.workspaceDirectory,localDirectory:f.localDirectory,fault:async stage=>{if(stage==='restore-before-manifest')throw new Error('Synthetic interrupted restore');}});await expect(failed.restore(summary.id)).rejects.toThrow('Synthetic interrupted restore');const folders=await readdir(path.join(f.localDirectory,'restored'));expect(folders).toHaveLength(1);await expect(readFile(path.join(f.localDirectory,'restored',folders[0],'workspace.json'))).rejects.toMatchObject({code:'ENOENT'});expect((await f.archive.verify(summary.id)).read.events.length).toBe(summary.eventCount);
}));
test('archive directories and files cannot redirect writes through symbolic links',async()=>fixture(async f=>{
 const outside=path.join(f.root,'outside');await mkdir(outside);await symlink(outside,path.join(f.localDirectory,'backups'));await expect(f.archive.backup()).rejects.toThrow();expect(await readdir(outside)).toEqual([]);
}));

test('retention keeps fourteen daily and eight weekly verified copies and retains manual backups',async()=>fixture(async f=>{
 for(let day=0;day<16;day++){f.setNow(new Date(Date.parse('2026-11-01T12:00:00Z')+day*24*60*60*1000).toISOString());await f.archive.backup({kind:'daily'});}
 for(let week=0;week<10;week++){f.setNow(new Date(Date.parse('2026-11-01T12:00:00Z')+week*7*24*60*60*1000).toISOString());await f.archive.backup({kind:'weekly'});}
 await f.archive.backup();const copies=await f.archive.list();expect(copies.filter(item=>item.kind==='daily')).toHaveLength(14);expect(copies.filter(item=>item.kind==='weekly')).toHaveLength(8);expect(copies.filter(item=>item.kind==='manual')).toHaveLength(1);
 const cleanupFailure=await WorkspaceArchives.open({workspaceDirectory:f.workspaceDirectory,localDirectory:f.localDirectory,fault:async stage=>{if(stage==='retention-before-remove')throw new Error('Synthetic cleanup failure');}});const completed=await cleanupFailure.backup({kind:'daily'});expect(cleanupFailure.retentionFailed).toBe(true);await expect(cleanupFailure.verify(completed.id)).resolves.toBeDefined();
 f.setNow('2026-10-01T12:00:00Z');const rolledBack=await f.archive.backup({kind:'daily'});await expect(f.archive.verify(rolledBack.id)).resolves.toBeDefined();expect((await f.archive.list()).filter(item=>item.kind==='daily')).toHaveLength(14);
}),RETENTION_TEST_TIMEOUT_MS);
