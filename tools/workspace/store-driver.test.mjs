import { beforeAll, afterEach, afterAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileWorkspaceStore, SEGMENT_BYTES } from '../../packages/store/src/index.ts';
import { Domain } from '../../packages/domain/src/index.ts';
import { fold, toStateDocument } from '../reference/fold.mjs';
import { readJson, loadValidators } from '../reference/schemas.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cleanup = []; const opened = [];
const validators = loadValidators();
const id = (kind, n = 1) => `${kind}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
let clock = 0;
function draft(deviceId, n, extra = {}) {
  return { v: 1, eventId: id('09', n), deviceId, at: '2026-11-08T18:00:00.000Z', actor: 'user', command: { name: 'category.create', args: { record: { id: id('0c', n), label: 'Synthetic category' } } }, ops: [{ op: 'create', kind: 'category', id: id('0c', n), record: { id: id('0c', n), label: 'Synthetic category' } }], ...extra };
}
async function setup(options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'fulcrum-c4-')); cleanup.push(base);
  const directory = path.join(base, 'workspace'); const localDirectory = path.join(base, 'local');
  const manifest = await FileWorkspaceStore.create(directory);
  const configuration = { localDirectory, deviceLabel: 'Synthetic device', lockStaleMs: 5000, now: () => new Date(Date.UTC(2026, 10, 8, 18, 0, clock++)), ...options };
  const store = new FileWorkspaceStore(configuration);
  const info = await store.open(directory); opened.push(store);
  return { base, directory, localDirectory, store, info, manifest, configuration };
}
async function reopen(f, options = {}) {
  const store = new FileWorkspaceStore({ localDirectory: f.localDirectory, deviceLabel: 'Synthetic device', lockStaleMs: 5000, ...options });
  const info = await store.open(f.directory); opened.push(store); return { ...f, store, info };
}
function checkpoint(f, events) {
  const result = fold(events);
  return { v: 1, workspaceId: f.manifest.workspaceId, frontier: result.frontier, maxHlc: events.at(-1).hlc, state: toStateDocument(result.state) };
}
const errorCode = code => expect.objectContaining({ code });
afterEach(async () => { for (const store of opened.splice(0)) await store.close().catch(() => undefined); for (const directory of cleanup.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('workspace store', () => {
  test('durable commits reopen with contiguous sequences and causal clocks', async () => {
    let f = await setup();
    const first = await f.store.commit([draft(f.info.deviceId, 1)]);
    const second = await f.store.commit([draft(f.info.deviceId, 2)]);
    expect([first[0].seq, second[0].seq]).toEqual([1, 2]); expect(second[0].hlc > first[0].hlc).toBe(true);
    await f.store.close(); f = await reopen(f);
    expect(f.info.diagnostics).not.toContainEqual(errorCode('CLONED_DEVICE_ROTATED'));
    expect((await f.store.read()).events).toEqual([...first, ...second]);
    expect((await fs.readdir(f.directory)).sort()).toEqual(['log', 'workspace.json']);
    expect(await fs.readFile(path.join(f.localDirectory, 'device.json'), 'utf8')).toContain(f.info.deviceId);
  });
  test('rotation follows the day and the 1 MiB boundary', async () => {
    const f = await setup();
    const large = draft(f.info.deviceId, 1, { command: { name: 'category.create', args: { padding: 'x'.repeat(Math.floor(SEGMENT_BYTES * 0.6)) } } });
    await f.store.commit([large]); await f.store.commit([{ ...large, eventId: id('09', 2) }]);
    await f.store.commit([draft(f.info.deviceId, 3, { at: '2026-11-09T01:00:00.000Z' })]);
    const names = (await fs.readdir(path.join(f.directory, 'log', f.info.deviceId))).filter(n => n.endsWith('.jsonl'));
    expect(names).toHaveLength(3); expect(names.some(n => n.startsWith('2026-11-09'))).toBe(true);
  });
  test('multi-event batches publish as a complete new segment', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]);
    let seenDuringPublish;
    f.configuration.fault = async stage => { if (stage === 'batch-before-publish') seenDuringPublish = (await f.store.read()).events.length; };
    await f.store.commit([draft(f.info.deviceId, 2), draft(f.info.deviceId, 3)]);
    expect(seenDuringPublish).toBe(1); expect((await f.store.read()).events).toHaveLength(3);
  });
  test('an incoming segment cannot be overwritten during atomic batch publication', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]);
    const file = path.join(f.directory, 'log', f.info.deviceId, '2026-11-08-000002.jsonl');
    const incoming = JSON.stringify({ ...draft(f.info.deviceId, 90), seq: 2, hlc: '1794161400000-0002' }) + '\n';
    f.configuration.fault = async stage => { if (stage === 'batch-before-publish') await fs.writeFile(file, incoming); };
    await expect(f.store.commit([draft(f.info.deviceId, 2), draft(f.info.deviceId, 3)])).rejects.toMatchObject({ code: 'SEGMENT_COLLISION' });
    expect(await fs.readFile(file, 'utf8')).toBe(incoming);
  });
  test('canonical cross-device fixture retains events, conflicts and checkpoint eligibility', async () => {
    const f = await setup(); await f.store.close();
    await fs.rm(f.directory, { recursive: true, force: true });
    await fs.cp(path.join(root, 'fixtures/workspace-example'), f.directory, { recursive: true });
    const next = await reopen(f); const read = await next.store.read(); const expected = readJson('fixtures/scenarios/expectations.json').crossDeviceCollision;
    const result = fold(read.events);
    expect(read.events).toHaveLength(expected.eventCount); expect(result.frontier).toEqual(expected.frontier);
    expect(result.conflicts).toMatchObject(expected.conflicts);
    const initiative = toStateDocument(result.state).initiatives.find(i => i.id === expected.finalInitiative.id);
    expect(initiative).toMatchObject(expected.finalInitiative);
    for (const code of expected.diagnosticsInclude) expect(read.diagnostics.some(d => d.code === code)).toBe(true);
    expect(await next.store.latestUsableCheckpoint()).not.toBeNull();
  });
  test('conflicted copies dedupe and torn tails retain acknowledged events', async () => {
    const f = await setup(); const events = await f.store.commit([draft(f.info.deviceId, 1)]);
    const folder = path.join(f.directory, 'log', f.info.deviceId); const file = path.join(folder, (await fs.readdir(folder))[0]);
    await fs.copyFile(file, file.replace('.jsonl', ' (Synthetic conflicted copy).jsonl')); await fs.appendFile(file, '{"unfinished":');
    const read = await f.store.read(); expect(read.events).toEqual(events);
    expect(read.diagnostics.map(d => d.code)).toContain('TORN_TAIL_IGNORED'); expect(read.diagnostics.map(d => d.code)).toContain('DUPLICATE_EVENT_IGNORED');
    await f.store.commit([draft(f.info.deviceId, 2)]); expect((await f.store.read()).events).toHaveLength(2);
  });
  test('zero-byte placeholders block state reads and writes', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]);
    await fs.writeFile(path.join(f.directory, 'log', f.info.deviceId, 'placeholder.jsonl'), '');
    await expect(f.store.read()).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FULLY_DOWNLOADED' });
    await expect(f.store.commit([draft(f.info.deviceId, 2)])).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FULLY_DOWNLOADED' });
  });
  test('missing sequences are incomplete even when the highest acknowledged sequence is present', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]); await f.store.commit([draft(f.info.deviceId, 2)]);
    const folder = path.join(f.directory, 'log', f.info.deviceId); const file = path.join(folder, (await fs.readdir(folder))[0]);
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n'); await fs.writeFile(file, lines.slice(1).join('\n') + '\n');
    await expect(f.store.read()).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FULLY_DOWNLOADED' });
  });
  test('workspace log symlinks cannot point outside the workspace', async () => {
    const f = await setup(); const outside = path.join(f.base, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(f.directory, 'log'), 'dir');
    await expect(f.store.read()).rejects.toMatchObject({ code: 'WORKSPACE_PATH_UNSAFE' });
  });
  test('ID collisions and wrong device directories fail without partial state', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]);
    const folder = path.join(f.directory, 'log', f.info.deviceId); const file = path.join(folder, (await fs.readdir(folder))[0]);
    const changed = JSON.parse((await fs.readFile(file, 'utf8')).trim()); changed.command.args.note = 'Different bytes';
    await fs.writeFile(path.join(folder, 'collision.jsonl'), JSON.stringify(changed) + '\n');
    await expect(f.store.read()).rejects.toMatchObject({ code: 'EVENT_ID_COLLISION' });
    await fs.unlink(path.join(folder, 'collision.jsonl')); changed.deviceId = id('0d', 50);
    await fs.writeFile(path.join(folder, 'wrong.jsonl'), JSON.stringify(changed) + '\n');
    await expect(f.store.read()).rejects.toMatchObject({ code: 'EVENT_IN_WRONG_DEVICE_DIR' });
  });
  test('a second live core cannot acquire the same local profile', async () => {
    const f = await setup(); await expect(reopen(f)).rejects.toMatchObject({ code: 'CORE_LOCKED' });
    await f.store.close(); const next = await reopen(f); expect(next.info.deviceId).toBe(f.info.deviceId);
  });
  test('clone detection rotates the identity and never appends to the old log', async () => {
    const f = await setup(); const event = (await f.store.commit([draft(f.info.deviceId, 1)]))[0]; await f.store.close();
    const copy = { ...event, eventId: id('09', 2), seq: 2, hlc: '1794161400000-0002' };
    await fs.writeFile(path.join(f.directory, 'log', event.deviceId, 'remote.jsonl'), JSON.stringify(copy) + '\n');
    const next = await reopen(f); expect(next.info.deviceId).not.toBe(event.deviceId); expect(next.info.diagnostics).toContainEqual({ code: 'CLONED_DEVICE_ROTATED' });
    const written = await next.store.commit([draft(next.info.deviceId, 3)]); expect(written[0].seq).toBe(1);
    expect((await next.store.read()).events.filter(e => e.deviceId === event.deviceId)).toHaveLength(2);
  });
  test('future workspaces open read-only only within the minimum reader contract', async () => {
    const f = await setup(); await f.store.close();
    const file = path.join(f.directory, 'workspace.json');
    await fs.writeFile(file, JSON.stringify({ ...f.manifest, schemaVersion: 2, minReaderVersion: 1 }));
    const next = await reopen(f); expect(next.info.readOnly).toBe(true);
    await expect(next.store.commit([draft(next.info.deviceId, 1)])).rejects.toMatchObject({ code: 'WORKSPACE_READ_ONLY' });
    await next.store.close(); await fs.writeFile(file, JSON.stringify({ ...f.manifest, schemaVersion: 2, minReaderVersion: 2 }));
    await expect(reopen(f)).rejects.toMatchObject({ code: 'WORKSPACE_VERSION_UNSUPPORTED' });
  });
  test('atomic checkpoints retain three newest and reject missing-frontier coverage', async () => {
    const f = await setup(); const events = [];
    for (let n = 1; n <= 5; n++) { events.push(...await f.store.commit([draft(f.info.deviceId, n)])); await f.store.writeCheckpoint(checkpoint(f, events)); }
    expect((await f.store.read()).checkpoints).toHaveLength(3);
    expect((await f.store.latestUsableCheckpoint()).maxHlc).toBe(events.at(-1).hlc);
    const bad = checkpoint(f, events); bad.frontier[f.info.deviceId]++;
    await expect(f.store.writeCheckpoint(bad)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
  });
  test('a received checkpoint cannot claim history absent from local logs', async () => {
    const f = await setup(); const events = await f.store.commit([draft(f.info.deviceId, 1)]);
    const body = checkpoint(f, events); body.frontier[f.info.deviceId] = 2;
    const folder = path.join(f.directory, 'checkpoints', f.info.deviceId); await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, `${body.maxHlc}.json`), JSON.stringify(body));
    expect(await f.store.latestUsableCheckpoint()).toBeNull();
  });
  test('checkpoint scheduling exposes the 500-event threshold and resets after writing', async () => {
    const f = await setup(); expect(f.store.checkpointDue).toBe(false);
    f.store.setCheckpointProvider(async () => checkpoint(f, (await f.store.read()).events));
    await f.store.commit(Array.from({ length: 500 }, (_, index) => draft(f.info.deviceId, index + 1)));
    expect(f.store.checkpointDue).toBe(true);
    const deadline = Date.now() + 2000;
    while (f.store.checkpointDue && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    expect(f.store.checkpointDue).toBe(false); expect((await f.store.read()).checkpoints).toHaveLength(1);
  });
  test('checkpoint clocks must match their covered event history', async () => {
    const f = await setup(); const events = await f.store.commit([draft(f.info.deviceId, 1)]);
    const body = checkpoint(f, events); body.maxHlc = '9999999999999-0000';
    await expect(f.store.writeCheckpoint(body)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
  });
  test('late older events invalidate newer checkpoints', async () => {
    const f = await setup(); const events = await f.store.commit([draft(f.info.deviceId, 1)]); await f.store.writeCheckpoint(checkpoint(f, events));
    const deviceId = id('0d', 60); await fs.mkdir(path.join(f.directory, 'log', deviceId));
    const late = { ...draft(deviceId, 2), seq: 1, hlc: '0000000000001-0000' };
    await fs.writeFile(path.join(f.directory, 'log', deviceId, 'late.jsonl'), JSON.stringify(late) + '\n');
    expect(await f.store.latestUsableCheckpoint()).toBeNull();
  });
  test('watch reports an external log change', async () => {
    const f = await setup(); let resolve; const changed = new Promise(r => { resolve = r; });
    const stop = f.store.watch(() => resolve()); await new Promise(r => setTimeout(r, 100));
    await f.store.commit([draft(f.info.deviceId, 1)]);
    await Promise.race([changed, new Promise((_, reject) => setTimeout(() => reject(new Error('watch timeout')), 3000))]); stop();
  });
  test('a watcher callback failure cannot stop the store', async () => {
    const f = await setup(); let calls = 0;
    const stop = f.store.watch(() => { calls++; throw new Error('synthetic observer failure'); });
    await new Promise(r => setTimeout(r, 100)); await f.store.commit([draft(f.info.deviceId, 1)]);
    const deadline = Date.now() + 2000; while (!calls && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    stop(); expect(calls).toBeGreaterThan(0); expect((await f.store.read()).events).toHaveLength(1);
  });
  test('local indexes and identity cannot be placed inside the workspace', async () => {
    const f = await setup(); const invalid = new FileWorkspaceStore({ localDirectory: path.join(f.directory, 'local'), deviceLabel: 'Synthetic' });
    await expect(invalid.open(f.directory)).rejects.toMatchObject({ code: 'LOCAL_DIRECTORY_IN_WORKSPACE' });
    expect(await fs.readdir(f.directory)).not.toContain('local');
  });
  test('close refuses new commits immediately while an existing append drains', async () => {
    const f = await setup(); await f.store.commit([draft(f.info.deviceId, 1)]);
    let enter; let release; const entered = new Promise(r => { enter = r; }); const gate = new Promise(r => { release = r; });
    f.configuration.fault = async stage => { if (stage === 'append-half') { enter(); await gate; } };
    const pending = f.store.commit([draft(f.info.deviceId, 2)]); await entered;
    const closing = f.store.close(); const refused = f.store.commit([draft(f.info.deviceId, 3)]).then(() => 'accepted', error => error.code);
    let outcome;
    try { outcome = await Promise.race([refused, new Promise(r => setTimeout(() => r('queued'), 100))]); }
    finally { release(); await pending; await closing; await refused; }
    expect(outcome).toBe('STORE_CLOSED');
  });
  test('Domain.execute uses the actual durable commit port and undo survives reopen', async () => {
    let f = await setup(); const base = readJson('fixtures/states/portfolio.state.json'); base.workspaceId = f.manifest.workspaceId;
    const ports = { newId: () => id('09', ++clock + 5000), now: () => '2026-11-08T18:00:00Z', deviceId: f.info.deviceId, userEntityId: base.state.entities[1].id, commit: drafts => f.store.commit(drafts), validateState: doc => validators.workspaceState(doc) ? [] : validators.workspaceState.errors, validateEvent: event => validators.changeEvent(event) ? [] : validators.changeEvent.errors };
    let domain = new Domain(base, [], ports);
    const result = await domain.execute({ name: 'node.update', args: { id: id('02'), patch: { title: 'Durable synthetic edit' } }, actor: 'user' }); expect(result.ok).toBe(true);
    f.store.setCheckpointProvider(async () => domain.getSnapshot()); await f.store.close(); f = await reopen(f);
    domain = new Domain(base, (await f.store.read()).events, { ...ports, deviceId: f.info.deviceId });
    const undo = await domain.execute({ name: 'change.undo', args: { eventId: result.eventId }, actor: 'user' }); expect(undo.ok).toBe(true);
    expect(domain.getSnapshot().state.nodes[0].title).toBe(base.state.nodes[0].title); expect((await f.store.read()).events).toHaveLength(2);
  });
});

let compiled;
beforeAll(async () => {
  compiled = await fs.mkdtemp(path.join(os.tmpdir(), 'fulcrum-c4-compiled-'));
  const configuration = path.join(compiled, 'tsconfig.json');
  await fs.writeFile(configuration, JSON.stringify({ extends: path.join(root, 'tsconfig.json'), compilerOptions: { rootDir: root }, include: [path.join(root, 'packages/store/src/**/*.ts')] }));
  await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', configuration, '--noEmit', 'false', '--outDir', compiled], { cwd: root });
  await fs.writeFile(path.join(compiled, 'package.json'), '{"type":"module"}'); await fs.symlink(path.join(root, 'node_modules'), path.join(compiled, 'node_modules'), 'dir');
  await fs.symlink(path.join(root, 'packages/store/node_modules'), path.join(compiled, 'packages/store/node_modules'), 'dir');
  // Runtime schema assets are packaged beside the compiled driver.
  await fs.cp(path.join(root, 'schemas'), path.join(compiled, 'schemas'), { recursive: true });
});
afterAll(async () => { if (compiled) await fs.rm(compiled, { recursive: true, force: true }); });

describe('real process crashes', () => {
  for (const stage of ['append-half', 'checkpoint-before-rename', 'batch-before-publish']) test(`SIGKILL at ${stage} preserves acknowledged events`, async () => {
    const f = await setup(); const acknowledged = await f.store.commit([draft(f.info.deviceId, 1)]);
    const cp = checkpoint(f, acknowledged); await f.store.close();
    const cpFile = path.join(f.base, 'checkpoint.json'); await fs.writeFile(cpFile, JSON.stringify(cp));
    const worker = path.join(f.base, 'worker.mjs');
    await fs.writeFile(worker, `import fs from 'node:fs/promises';\nimport {FileWorkspaceStore} from ${JSON.stringify(pathToFileURL(path.join(compiled, 'packages/store/src/index.js')).href)};\nconst timer=setInterval(()=>{},1000);\nconst store=new FileWorkspaceStore({localDirectory:${JSON.stringify(f.localDirectory)},deviceLabel:'Synthetic',lockStaleMs:5000,fault:async stage=>{if(stage===${JSON.stringify(stage)}){console.log('READY');await new Promise(()=>{});}}});\nconst info=await store.open(${JSON.stringify(f.directory)});\nconst draft=${JSON.stringify(draft(f.info.deviceId, 2))};\nif(${JSON.stringify(stage)}==='checkpoint-before-rename')await store.writeCheckpoint(JSON.parse(await fs.readFile(${JSON.stringify(cpFile)},'utf8')));\nelse await store.commit(${stage === 'batch-before-publish' ? '[draft,{...draft,eventId:' + JSON.stringify(id('09', 3)) + '}]' : '[draft]'});\nclearInterval(timer);await store.close();\n`);
    const child = spawn(process.execPath, [worker], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ready = new Promise((resolve, reject) => { let stderr = ''; child.stderr.on('data', data => { stderr += data; }); child.stdout.on('data', data => { if (String(data).includes('READY')) resolve(); }); child.on('exit', code => reject(new Error(`worker exited ${code}: ${stderr}`))); });
    try { await ready; } finally { child.kill('SIGKILL'); }
    await new Promise(resolve => child.once('exit', resolve));
    let next;
    const deadline = Date.now() + 8000;
    while (!next) { try { next = await reopen(f); } catch (error) { if (error.code !== 'CORE_LOCKED' || Date.now() > deadline) throw error; await new Promise(r => setTimeout(r, 100)); } }
    expect((await next.store.read()).events).toEqual(acknowledged);
    if (stage === 'append-half') expect((await next.store.read()).diagnostics.some(d => d.code === 'TORN_TAIL_IGNORED')).toBe(true);
  }, 15000);
});
