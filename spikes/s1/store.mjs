import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { readWorkspace } from '../../tools/reference/workspace-reader.mjs';
import { fold, toStateDocument, compareEvents, checkpointIsUsable } from '../../tools/reference/fold.mjs';
import { loadValidators } from '../../tools/reference/schemas.mjs';

export const SEGMENT_BYTES = 1024 * 1024;
const CHECKPOINT_LIMIT = 3;
const COUNTER_LIMIT = 9999;
const validators = loadValidators();
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function uuid() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function validate(kind, value) {
  if (!validators[kind](value)) throw new Error(JSON.stringify(validators[kind].errors));
}
export function durableWrite(file, content, mode = 'wx') {
  const descriptor = fs.openSync(file, mode, 0o600);
  try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
export function atomicJson(file, value, fault = () => {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.tmp-${uuid()}`);
  durableWrite(temporary, JSON.stringify(value));
  fault('checkpoint');
  fs.renameSync(temporary, file);
}
export function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'workspace.json');
  if (!fs.existsSync(file)) durableWrite(file, JSON.stringify({ format: 'fulcrum-workspace', schemaVersion: 1, workspaceId: uuid(), createdAt: new Date().toISOString() }));
  const manifest = readJson(file);
  validate('workspace', manifest);
  return manifest;
}
function preflight(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.tmp-')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { preflight(file); continue; }
    if (!/\.(json|jsonl)$/.test(entry.name)) continue;
    if (!fs.readFileSync(file).length) throw new Error('WORKSPACE_NOT_FULLY_DOWNLOADED: zero-byte placeholder');
  }
}
export function inspect(dir) {
  try { preflight(dir); }
  catch (error) { return { complete: false, diagnostics: [{ code: 'WORKSPACE_NOT_FULLY_DOWNLOADED', detail: error.message }] }; }
  let workspace;
  try { workspace = readWorkspace(dir); }
  catch (error) { return { complete: false, diagnostics: [{ code: 'WORKSPACE_READ_FAILED', detail: error.message }] }; }
  const { manifest, events, diagnostics, checkpoints } = workspace;
  validate('workspace', manifest);
  for (const event of events) validate('changeEvent', event);
  for (const item of checkpoints) validate('workspaceState', item.body);
  if (diagnostics.some(item => ['EVENT_ID_COLLISION', 'EVENT_IN_WRONG_DEVICE_DIR'].includes(item.code))) return { complete: false, diagnostics };
  const result = fold(events);
  const state = toStateDocument(result.state);
  const eligible = checkpoints.filter(item => checkpointIsUsable(item.body, events)).sort((a, b) => (b.body.maxHlc ?? '').localeCompare(a.body.maxHlc ?? ''));
  return { complete: true, diagnostics, frontier: result.frontier, conflicts: result.conflicts,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex'), state,
    checkpoint: eligible[0]?.file ?? null, replay: 'full', events, manifest };
}
export function requireComplete(dir) {
  const result = inspect(dir);
  if (!result.complete) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
export function nextHlc(events, now = Date.now()) {
  const latest = events.reduce((maximum, event) => event.hlc > maximum ? event.hlc : maximum, '0000000000000-0000');
  const [milliseconds, counter] = latest.split('-').map(Number);
  if (now > milliseconds) return `${String(now).padStart(13, '0')}-0000`;
  if (counter === COUNTER_LIMIT) return `${String(milliseconds + 1).padStart(13, '0')}-0000`;
  return `${String(milliseconds).padStart(13, '0')}-${String(counter + 1).padStart(4, '0')}`;
}
export function append(dir, event, fault = () => {}) {
  validate('changeEvent', event);
  const directory = path.join(dir, 'log', event.deviceId);
  fs.mkdirSync(directory, { recursive: true });
  const day = event.at.slice(0, 10);
  const files = fs.readdirSync(directory).filter(name => /^\d{4}-\d{2}-\d{2}-\d+\.jsonl$/.test(name)).sort();
  const latest = files.at(-1);
  const line = Buffer.from(JSON.stringify(event) + '\n');
  let file = latest && path.join(directory, latest);
  const previous = file && fs.readFileSync(file);
  if (!latest?.startsWith(day) || !previous?.length || previous.at(-1) !== 10 || previous.length + Buffer.byteLength(line) > SEGMENT_BYTES) {
    file = path.join(directory, `${day}-${String(event.seq).padStart(6, '0')}.jsonl`);
    if (fs.existsSync(file)) file = path.join(directory, `${day}-${String(event.seq).padStart(6, '0')}-recovery-${uuid()}.jsonl`);
  }
  const descriptor = fs.openSync(file, 'a');
  try {
    const split = Math.floor(line.length / 2);
    fs.writeFileSync(descriptor, line.subarray(0, split));
    fault('append');
    fs.writeFileSync(descriptor, line.subarray(split));
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
export function checkpoint(dir, deviceId, fault) {
  const result = requireComplete(dir);
  const events = [...result.events].sort(compareEvents);
  const fieldWriters = {};
  // Only the harness's create/set commands are emitted; refuse other histories.
  for (const event of events) for (const op of event.ops) {
    if (!['create', 'set'].includes(op.op)) throw new Error('Checkpoint writer supports harness create/set histories only');
    const fields = op.op === 'create' ? Object.keys(op.record) : [op.field];
    for (const field of fields) {
      const key = `${op.kind}:${op.id}:${field}`;
      if (op.op === 'set' || !fieldWriters[key]) fieldWriters[key] = event.eventId;
    }
  }
  const maxHlc = events.at(-1)?.hlc;
  if (!maxHlc) throw new Error('Register a device first');
  const body = { v: 1, workspaceId: result.manifest.workspaceId, frontier: result.frontier, maxHlc, fieldWriters, state: result.state };
  validate('workspaceState', body);
  const directory = path.join(dir, 'checkpoints', deviceId);
  atomicJson(path.join(directory, `${maxHlc}.json`), body, fault);
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse();
  for (const file of files.slice(CHECKPOINT_LIMIT)) fs.unlinkSync(path.join(directory, file));
  return body;
}
