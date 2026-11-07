import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Domain } from '../../spikes/s1/domain.mjs';
import { init, inspect, checkpoint, nextHlc, append, SEGMENT_BYTES } from '../../spikes/s1/store.mjs';
import { readWorkspace } from '../reference/workspace-reader.mjs';
import { loadValidators } from '../reference/schemas.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-s1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'workspace');
  init(directory);
  const a = new Domain(directory, path.join(root, 'a'));
  const b = new Domain(directory, path.join(root, 'b'));
  a.register('Synthetic A'); b.register('Synthetic B');
  return { root, directory, a, b };
}
function segment(directory, deviceId) {
  const folder = path.join(directory, 'log', deviceId);
  return path.join(folder, fs.readdirSync(folder).filter(file => file.endsWith('.jsonl'))[0]);
}

test('S1 two local devices emit valid events, contiguous sequences and checkpoints', t => {
  const { directory, a, b } = setup(t);
  for (let index = 0; index < 4; index += 1) {
    a.execute('initiative.create'); b.execute('initiative.create');
    checkpoint(directory, a.identity().deviceId);
  }
  const result = inspect(directory);
  assert.equal(result.complete, true);
  assert.equal(result.state.initiatives.length, 8);
  assert.deepEqual(Object.values(result.frontier), [5, 5]);
  const validators = loadValidators();
  for (const event of result.events) assert.ok(validators.changeEvent(event));
  for (const item of readWorkspace(directory).checkpoints) assert.ok(validators.workspaceState(item.body), JSON.stringify(validators.workspaceState.errors));
  assert.equal(readWorkspace(directory).checkpoints.length, 3);
  assert.equal(inspect(directory).stateHash, result.stateHash);
});

test('S1 offline MoSCoW edits converge with material conflict', t => {
  const { root, directory, a, b } = setup(t);
  const id = a.execute('initiative.create').ops[0].id;
  const offline = path.join(root, 'offline');
  fs.cpSync(directory, offline, { recursive: true });
  const remote = new Domain(offline, path.join(root, 'b'));
  const first = a.execute('initiative.setMoscow', { id });
  const second = remote.execute('initiative.setMoscow', { id });
  remote.execute('initiative.setMoscow', { id });
  assert.equal(first.ops[0].baseEventId, second.ops[0].baseEventId);
  fs.cpSync(path.join(offline, 'log', b.identity().deviceId), path.join(directory, 'log', b.identity().deviceId), { recursive: true });
  fs.cpSync(path.join(directory, 'log', a.identity().deviceId), path.join(offline, 'log', a.identity().deviceId), { recursive: true });
  const result = inspect(directory);
  assert.equal(result.stateHash, inspect(offline).stateHash);
  assert.ok(result.conflicts.some(conflict => conflict.field === 'moscow' && conflict.material));
});

test('S1 torn tails and conflicted copies retain acknowledged events', t => {
  const { directory, a } = setup(t);
  a.execute('initiative.create');
  const before = inspect(directory);
  const file = segment(directory, a.identity().deviceId);
  fs.copyFileSync(file, file.replace('.jsonl', ' (Synthetic conflicted copy).jsonl'));
  fs.appendFileSync(file, '{"unfinished":');
  const result = inspect(directory);
  assert.equal(result.stateHash, before.stateHash);
  assert.ok(result.diagnostics.some(item => item.code === 'DUPLICATE_EVENT_IGNORED'));
  assert.ok(result.diagnostics.some(item => item.code === 'TORN_TAIL_IGNORED'));
  a.execute('initiative.create');
  assert.equal(inspect(directory).state.initiatives.length, 2);
});

test('S1 placeholder blocks partial fold and writes', t => {
  const { directory, a } = setup(t);
  fs.writeFileSync(path.join(directory, 'log', a.identity().deviceId, 'placeholder.jsonl'), '');
  const result = inspect(directory);
  assert.equal(result.complete, false);
  assert.equal(result.stateHash, undefined);
  assert.equal(result.diagnostics[0].code, 'WORKSPACE_NOT_FULLY_DOWNLOADED');
  assert.throws(() => a.execute('initiative.create'), /NOT_FULLY_DOWNLOADED/);
});

test('S1 collisions never produce an authoritative hash', t => {
  const { directory, a } = setup(t);
  const file = segment(directory, a.identity().deviceId);
  fs.writeFileSync(file.replace('.jsonl', '-copy.jsonl'), fs.readFileSync(file, 'utf8').replace('Synthetic A', 'Synthetic C'));
  assert.equal(inspect(directory).complete, false);
  assert.ok(inspect(directory).diagnostics.some(item => item.code === 'EVENT_ID_COLLISION'));
});

for (const phase of ['append', 'checkpoint']) test(`S1 process exits mid-${phase} without losing acknowledged events`, t => {
  const { root, directory, a } = setup(t);
  a.execute('initiative.create');
  checkpoint(directory, a.identity().deviceId);
  const before = inspect(directory);
  const script = `import { Domain } from './spikes/s1/domain.mjs';
    import { checkpoint } from './spikes/s1/store.mjs';
    const domain = new Domain(process.argv[1], process.argv[2], () => process.exit(71));
    if (process.argv[3] === 'append') domain.execute('initiative.create');
    else checkpoint(process.argv[1], domain.identity().deviceId, () => process.exit(71));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, directory, path.join(root, 'a'), phase]);
  assert.equal(child.status, 71, child.stderr.toString());
  assert.equal(inspect(directory).stateHash, before.stateHash);
  assert.deepEqual(inspect(directory).frontier, before.frontier);
  a.execute('initiative.create');
  assert.equal(inspect(directory).state.initiatives.length, 2);
});

test('S1 copied device state causes clone rotation before append', t => {
  const { root, directory, a } = setup(t);
  const cloneHome = path.join(root, 'clone');
  fs.cpSync(path.join(root, 'a'), cloneHome, { recursive: true });
  const originalId = a.identity().deviceId;
  a.execute('initiative.create');
  const original = fs.readFileSync(segment(directory, originalId), 'utf8');
  const clone = new Domain(directory, cloneHome);
  assert.throws(() => clone.execute('initiative.create'), /Clone detected/);
  assert.equal(clone.register('Synthetic clone').cloned, true);
  assert.notEqual(clone.identity().deviceId, originalId);
  clone.execute('initiative.create');
  assert.equal(fs.readFileSync(segment(directory, originalId), 'utf8'), original);
});

test('S1 HLC advances across future clocks and counter overflow', () => {
  assert.equal(nextHlc([{ hlc: '9999999999998-9999' }], 1), '9999999999999-0000');
  assert.equal(nextHlc([{ hlc: '0000000000005-0002' }], 1), '0000000000005-0003');
});

test('S1 segments rotate by UTC day and byte limit', t => {
  const { directory, a } = setup(t);
  const original = a.execute('initiative.create');
  const event = { ...original, eventId: '99000000-0000-7000-8000-000000000001', seq: original.seq + 1, at: '2099-01-01T00:00:00.000Z' };
  append(directory, event);
  const folder = path.join(directory, 'log', a.identity().deviceId);
  const file = path.join(folder, '2099-01-01-000003.jsonl');
  fs.appendFileSync(file, ' '.repeat(SEGMENT_BYTES) + '\n');
  append(directory, { ...event, eventId: '99000000-0000-7000-8000-000000000002', seq: event.seq + 1 });
  assert.ok(fs.existsSync(path.join(folder, '2099-01-01-000004.jsonl')));
});

test('S1 reference reader should reject zero-byte placeholders (known gap)', { todo: 'S1-findings.md: reader returns partial event set; harness preflight blocks it' }, t => {
  const { directory, a } = setup(t);
  fs.writeFileSync(path.join(directory, 'log', a.identity().deviceId, 'placeholder.jsonl'), '');
  assert.throws(() => readWorkspace(directory), /download/i);
});

test('S1 CLI end to end with two simulated local homes', t => {
  const { root, directory } = setup(t);
  const run = (home, ...args) => {
    const child = spawnSync(process.execPath, ['spikes/s1/cli.mjs', ...args], { env: { ...process.env, FULCRUM_SPIKE_HOME: path.join(root, home) }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim().split('\n').map(line => JSON.parse(line));
  };
  run('c', 'init', directory);
  for (const home of ['c', 'd']) {
    run(home, 'device', directory, '--label', `Synthetic ${home}`);
    run(home, 'write', directory, '--count', '2', '--interval-ms', '0');
    run(home, 'checkpoint', directory);
  }
  assert.equal(run('c', 'fold', directory, '--json')[0].state.initiatives.length, 4);
});

test('S1 checkpoint refuses a cloned writer identity', t => {
  const { root, directory, a } = setup(t);
  fs.cpSync(path.join(root, 'a'), path.join(root, 'clone'), { recursive: true });
  a.execute('initiative.create');
  const child = spawnSync(process.execPath, ['spikes/s1/cli.mjs', 'checkpoint', directory], { env: { ...process.env, FULCRUM_SPIKE_HOME: path.join(root, 'clone') }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Clone detected/);
});

test('S1 future workspace versions refuse writes', t => {
  const { directory, a } = setup(t);
  const file = path.join(directory, 'workspace.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...manifest, schemaVersion: 2 }));
  assert.throws(() => a.execute('initiative.create'), /Unsupported workspace version/);
});

test('S1 watch reports another device append with a timestamp', { timeout: 10000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { root, directory, b } = setup(t);
  // Read before spawning: setup's cleanup deletes b's device file, and the
  // watcher can still emit while that cleanup runs.
  const bDeviceId = b.identity().deviceId;
  const child = spawn(process.execPath, ['spikes/s1/cli.mjs', 'watch', directory], { env: { ...process.env, FULCRUM_SPIKE_HOME: path.join(root, 'a') } });
  t.after(() => child.kill());
  let buffer = '';
  let ready = false;
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stderr.on('data', chunk => reject(new Error(chunk.toString())));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const report = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (!ready) {
          ready = true;
          // Let the watch subscription finish after its initial summary.
          const timer = setTimeout(() => b.execute('initiative.create'), 100);
          t.after(() => clearTimeout(timer));
          continue;
        }
        if (report.frontier?.[bDeviceId] === 2) {
          assert.ok(Number.isFinite(Date.parse(report.observedAt)));
          resolve();
        }
      }
    });
  });
  // Stop the watcher before cleanup deletes the workspace it is watching.
  child.stdout.removeAllListeners('data');
  child.stderr.removeAllListeners('data');
  child.kill();
  await once(child, 'exit');
});
