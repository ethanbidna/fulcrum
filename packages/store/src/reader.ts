import { readdir, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeEvent, WorkspaceManifest, WorkspaceStateDoc } from '@fulcrum/schema';
import type { WorkspaceRead, StoreDiagnostic } from './interfaces.js';
import { SEGMENT_BYTES, StoreError, UUID } from './files.js';
import { validate } from './validation.js';
import type { StoreValidators } from './validation.js';

import { constants } from 'node:fs';
import { ENCRYPTED_VERSION, MAX_MANIFEST_BYTES, MAX_CHECKPOINT_BYTES } from './encryption.js';
import type { WorkspaceEncryption, EncryptedManifest } from './encryption.js';
import { strictJson } from './strict-json.js';

const READ_ATTEMPTS = 3;
interface Inventory { files: string[]; fingerprint: string }
export async function inspectManifest(directory: string, validators: StoreValidators): Promise<WorkspaceManifest | EncryptedManifest> {
  const manifest = strictJson(await nonempty(path.join(directory, 'workspace.json'), MAX_MANIFEST_BYTES)) as WorkspaceManifest;
  if (manifest?.schemaVersion === ENCRYPTED_VERSION) {
    if (!validators.encryptedManifest(manifest)) throw new StoreError('WORKSPACE_VERSION_UNSUPPORTED', 'Invalid version 2 manifest');
    return manifest as EncryptedManifest;
  }
  validate(validators.manifest, manifest);
  return manifest;
}

export async function readWorkspace(directory: string, validators: StoreValidators, encryption?: WorkspaceEncryption): Promise<WorkspaceRead & { eventBytes: string[] }> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    const before = await inventory(directory);
    const diagnostics: StoreDiagnostic[] = [];
    const manifest = await inspectManifest(directory, validators);
    if (manifest.schemaVersion === ENCRYPTED_VERSION) {
      if (!encryption) throw new StoreError('WORKSPACE_LOCKED', 'An authenticated encryption session is required');
      encryption.verify(manifest as EncryptedManifest, validators);
    } else if (encryption) throw new StoreError('WORKSPACE_VERSION_UNSUPPORTED', 'Encrypted storage cannot fall back to plaintext');
    const byId = new Map<string, { event: ChangeEvent; raw: string }>();
    const checkpoints: WorkspaceRead['checkpoints'] = [];
    for (const relative of before.files) {
      if (relative === 'workspace.json') continue;
      const segment = relative.startsWith(`log${path.sep}`);
      const content = await nonempty(path.join(directory, relative), encryption ? (segment ? SEGMENT_BYTES : MAX_CHECKPOINT_BYTES) : undefined);
      if (segment) readSegment(relative, content, byId, diagnostics, validators, encryption);
      else readCheckpoint(relative, content, manifest.workspaceId, checkpoints, diagnostics, validators, encryption);
    }
    const after = await inventory(directory);
    if (before.fingerprint !== after.fingerprint) continue;
    const events = [...byId.values()].map(row => row.event).sort(compareEvents);
    validateSequences(events);
    return { manifest, events, checkpoints, diagnostics, eventBytes: events.map(event => byId.get(event.eventId)!.raw) };
  }
  throw new StoreError('WORKSPACE_CHANGING', 'Workspace changed during reading; retry after synchronization');
}
export function compareEvents(a: ChangeEvent, b: ChangeEvent) { return a.hlc.localeCompare(b.hlc) || a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq; }
async function nonempty(file: string, limit?: number): Promise<string> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Expected a regular workspace file');
      if (limit !== undefined && stat.size > limit) throw new StoreError('WORKSPACE_FILE_TOO_LARGE', 'Workspace file exceeds its encoding limit');
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (!bytesRead || bytesRead !== stat.size) throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Workspace file is empty or incomplete');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Workspace file could not be read');
  }
}
export async function inventory(directory: string): Promise<Inventory> {
  const files = ['workspace.json'];
  const entries: string[] = [];
  for (const area of ['log', 'checkpoints']) {
    const root = path.join(directory, area);
    for (const device of await directoryEntries(root)) {
      if (!UUID.test(device)) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Invalid device directory');
      const folder = path.join(root, device);
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name.startsWith('.tmp-')) continue;
        const extension = area === 'log' ? '.jsonl' : '.json';
        if (!entry.name.endsWith(extension)) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Invalid workspace file');
        files.push(path.join(area, device, entry.name));
      }
    }
  }
  files.sort();
  for (const file of files) {
    const stat = await lstat(path.join(directory, file));
    entries.push(`${file}:${stat.size}:${stat.mtimeMs}:${stat.ino}`);
  }
  return { files, fingerprint: entries.join('\n') };
}
async function directoryEntries(directory: string): Promise<string[]> {
  let entries;
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Expected a real workspace directory');
    entries = await readdir(directory, { withFileTypes: true });
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Workspace children cannot be symbolic links');
    if (entry.isDirectory()) result.push(entry.name);
  }
  return result.sort();
}
function readSegment(file: string, content: string, byId: Map<string, { event: ChangeEvent; raw: string }>, diagnostics: StoreDiagnostic[], validators: StoreValidators, encryption?: WorkspaceEncryption) {
  const parts = content.split('\n'); const tail = parts.pop()!;
  if (encryption ? tail.length : tail.trim()) diagnostics.push({ code: 'TORN_TAIL_IGNORED', file });
  const deviceId = file.split(path.sep)[1];
  for (const line of encryption ? parts : parts.filter(line => line.trim())) {
    const raw = encryption ? encryption.decode('event', deviceId!, line, validators) : line;
    let event: ChangeEvent;
    try { event = (encryption ? strictJson(raw) : JSON.parse(raw)) as ChangeEvent; } catch { throw new StoreError('WORKSPACE_VALIDATION_FAILED', 'Malformed complete event line', { file }); }
    validate(validators.event, event);
    if (event.deviceId !== deviceId) throw new StoreError('EVENT_IN_WRONG_DEVICE_DIR', 'Event is in the wrong device directory');
    const previous = byId.get(event.eventId);
    if (previous && previous.raw !== raw) throw new StoreError('EVENT_ID_COLLISION', 'An event id has different bytes');
    if (previous) diagnostics.push({ code: 'DUPLICATE_EVENT_IGNORED', eventId: event.eventId, file });
    else byId.set(event.eventId, { event, raw });
  }
}
function readCheckpoint(file: string, content: string, workspaceId: string, checkpoints: WorkspaceRead['checkpoints'], diagnostics: StoreDiagnostic[], validators: StoreValidators, encryption?: WorkspaceEncryption) {
  try {
    const decoded = encryption ? encryption.decode('checkpoint', file.split(path.sep)[1]!, content, validators) : content;
    const body = (encryption ? strictJson(decoded) : JSON.parse(decoded)) as WorkspaceStateDoc;
    validate(validators.checkpoint, body);
    if (body.workspaceId !== workspaceId) throw new Error('wrong workspace');
    checkpoints.push({ deviceId: file.split(path.sep)[1]!, file, body });
  } catch { diagnostics.push({ code: 'CHECKPOINT_INVALID_IGNORED', file }); }
}
function validateSequences(events: ChangeEvent[]) {
  const seen = new Map<string, string>();
  const sequences = new Map<string, { count: number; maximum: number }>();
  for (const event of events) {
    const key = `${event.deviceId}:${event.seq}`;
    if (seen.has(key)) throw new StoreError('DEVICE_SEQUENCE_COLLISION', 'Different events use the same device sequence');
    seen.set(key, event.eventId);
    const device = sequences.get(event.deviceId) ?? { count: 0, maximum: 0 };
    device.count++; device.maximum = Math.max(device.maximum, event.seq); sequences.set(event.deviceId, device);
  }
  if ([...sequences.values()].some(device => device.count !== device.maximum)) throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Workspace is missing device event sequences');
}

