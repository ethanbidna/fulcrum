import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeEvent, WorkspaceManifest, WorkspaceStateDoc } from '@fulcrum/schema';
import type { WorkspaceRead, StoreDiagnostic } from './interfaces.js';
import { StoreError, UUID } from './files.js';
import { validate } from './validation.js';
import type { StoreValidators } from './validation.js';

const READ_ATTEMPTS = 3;
interface Inventory { files: string[]; fingerprint: string }
export async function readWorkspace(directory: string, validators: StoreValidators): Promise<WorkspaceRead> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    const before = await inventory(directory);
    const diagnostics: StoreDiagnostic[] = [];
    const manifest = JSON.parse(await nonempty(path.join(directory, 'workspace.json'))) as WorkspaceManifest;
    validate(validators.manifest, manifest);
    const byId = new Map<string, { event: ChangeEvent; raw: string }>();
    const checkpoints: WorkspaceRead['checkpoints'] = [];
    for (const relative of before.files) {
      if (relative === 'workspace.json') continue;
      const content = await nonempty(path.join(directory, relative));
      if (relative.startsWith(`log${path.sep}`)) readSegment(relative, content, byId, diagnostics, validators);
      else readCheckpoint(relative, content, manifest.workspaceId, checkpoints, diagnostics, validators);
    }
    const after = await inventory(directory);
    if (before.fingerprint !== after.fingerprint) continue;
    const events = [...byId.values()].map(row => row.event).sort(compareEvents);
    validateSequences(events);
    return { manifest, events, checkpoints, diagnostics };
  }
  throw new StoreError('WORKSPACE_CHANGING', 'Workspace changed during reading; retry after synchronization');
}
export function compareEvents(a: ChangeEvent, b: ChangeEvent) { return a.hlc.localeCompare(b.hlc) || a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq; }
async function nonempty(file: string): Promise<string> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Expected a regular workspace file');
    const content = await readFile(file, 'utf8');
    if (!content.length) throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Workspace contains an empty placeholder');
    return content;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Workspace file could not be read');
  }
}
async function inventory(directory: string): Promise<Inventory> {
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
function readSegment(file: string, content: string, byId: Map<string, { event: ChangeEvent; raw: string }>, diagnostics: StoreDiagnostic[], validators: StoreValidators) {
  const parts = content.split('\n'); const tail = parts.pop()!;
  if (tail.trim()) diagnostics.push({ code: 'TORN_TAIL_IGNORED', file });
  const deviceId = file.split(path.sep)[1];
  for (const raw of parts.filter(line => line.trim())) {
    let event: ChangeEvent;
    try { event = JSON.parse(raw) as ChangeEvent; } catch { throw new StoreError('WORKSPACE_VALIDATION_FAILED', 'Malformed complete event line', { file }); }
    validate(validators.event, event);
    if (event.deviceId !== deviceId) throw new StoreError('EVENT_IN_WRONG_DEVICE_DIR', 'Event is in the wrong device directory');
    const previous = byId.get(event.eventId);
    if (previous && previous.raw !== raw) throw new StoreError('EVENT_ID_COLLISION', 'An event id has different bytes');
    if (previous) diagnostics.push({ code: 'DUPLICATE_EVENT_IGNORED', eventId: event.eventId, file });
    else byId.set(event.eventId, { event, raw });
  }
}
function readCheckpoint(file: string, content: string, workspaceId: string, checkpoints: WorkspaceRead['checkpoints'], diagnostics: StoreDiagnostic[], validators: StoreValidators) {
  try {
    const body = JSON.parse(content) as WorkspaceStateDoc;
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

