#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Domain, withLocalLock } from './domain.mjs';
import { init, inspect } from './store.mjs';

const DEFAULT_INTERVAL_MS = 100;
function summary(result) {
  const { events, manifest, state, ...report } = result;
  return report;
}
function integer(value, fallback, minimum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error('Invalid count or interval');
  return number;
}
function emit(value) { console.log(JSON.stringify({ observedAt: new Date().toISOString(), ...value })); }
const WATCH_POLL_MS = 500;
function remoteSignature(directory, deviceId) {
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => path.join(entry.parentPath, entry.name))
    .filter(file => path.relative(directory, file).split(path.sep)[0] !== deviceId)
    .sort().map(file => {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    }).join('\n');
}
function watch(directory, domain) {
  const deviceId = domain.identity().deviceId;
  const logDirectory = path.join(directory, 'log');
  fs.mkdirSync(logDirectory, { recursive: true });
  let signature = remoteSignature(logDirectory, deviceId);
  const refresh = () => {
    try {
      const next = remoteSignature(logDirectory, deviceId);
      if (next === signature) return;
      signature = next;
      emit(summary(inspect(directory)));
    } catch (error) { emit({ complete: false, diagnostics: [{ code: 'WATCH_READ_FAILED', detail: error.message }] }); }
  };
  const fallback = error => emit({ diagnostics: [{ code: 'WATCH_POLLING_FALLBACK', detail: error.code }], pollIntervalMs: WATCH_POLL_MS });
  // Polling also catches notifications coalesced or omitted by the filesystem.
  setInterval(refresh, WATCH_POLL_MS);
  try {
    const watcher = fs.watch(logDirectory, { recursive: true }, refresh);
    watcher.on('error', error => { watcher.close(); fallback(error); });
  } catch (error) { fallback(error); }
  emit(summary(inspect(directory)));
}
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    label: { type: 'string' }, count: { type: 'string' }, 'interval-ms': { type: 'string' },
    'field-conflict': { type: 'string' }, json: { type: 'boolean' },
  } });
  const [command, suppliedDirectory] = positionals;
  if (!suppliedDirectory || positionals.length !== 2) throw new Error('Usage: node spikes/s1/cli.mjs init|device|write|checkpoint|fold|watch <dir> [options]');
  const directory = path.resolve(suppliedDirectory);
  const requestedHome = path.resolve(process.env.FULCRUM_SPIKE_HOME ?? path.join(os.homedir(), '.fulcrum-spike'));
  fs.mkdirSync(requestedHome, { recursive: true });
  const localDirectory = fs.realpathSync(requestedHome);
  const workspacePath = fs.existsSync(directory) ? fs.realpathSync(directory) : directory;
  if (localDirectory === workspacePath || localDirectory.startsWith(workspacePath + path.sep)) throw new Error('Device state must be outside the workspace');
  const domain = new Domain(directory, localDirectory);
  const locked = action => withLocalLock(localDirectory, action);
  if (command === 'init') return emit(init(directory));
  if (command === 'device') return emit(locked(() => domain.register(values.label)));
  if (command === 'fold') {
    const result = inspect(directory);
    emit(values.json ? result : summary(result));
    if (!result.complete) process.exitCode = 1;
    return;
  }
  if (command === 'checkpoint') return emit(locked(() => ({ checkpoint: domain.checkpoint().maxHlc })));
  if (command === 'watch') return watch(directory, domain);
  if (command !== 'write') throw new Error('Unknown command');
  const count = integer(values.count, 1, 1);
  const interval = integer(values['interval-ms'], DEFAULT_INTERVAL_MS, 0);
  for (let index = 0; index < count; index += 1) {
    const event = locked(() => domain.execute(values['field-conflict'] ? 'initiative.setMoscow' : 'initiative.create', { ...(values['field-conflict'] ? { id: values['field-conflict'] } : {}) }));
    emit({ acknowledgedAt: new Date().toISOString(), eventId: event.eventId, deviceId: event.deviceId, seq: event.seq, hlc: event.hlc, initiativeId: event.ops[0].id });
    if (index + 1 < count) await delay(interval);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
