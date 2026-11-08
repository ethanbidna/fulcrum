import type { ChangeEvent, Op, RecordKind, WorkspaceStateDoc } from '@fulcrum/schema';
import { clone, COLLECTIONS, DomainFault, object, recordKey, writerKey } from './commands.js';
import type { DataRecord } from './commands.js';
import type { BeforeOp } from './transaction.js';
import type { WorkspaceState } from './types.js';

export interface EventBefore { ops: BeforeOp[]; writers: Map<string, string>; protections: Set<string>; protectionKeys: string[] }
export interface Replay {
  document: WorkspaceStateDoc;
  writers: Map<string, string>;
  before: Map<string, EventBefore>;
  protections: Set<string>;
  events: ChangeEvent[];
}
export function replayEvents(snapshot: WorkspaceStateDoc, input: ChangeEvent[]): Replay {
  const document = clone(snapshot);
  const writers = new Map(Object.entries(snapshot.fieldWriters ?? {}));
  const seen = new Map<string, ChangeEvent>();
  for (const event of input) {
    const previous = seen.get(event.eventId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new DomainFault('VALIDATION_FAILED', 'Event id collision');
    seen.set(event.eventId, event);
  }
  const events = [...seen.values()].sort((a, b) => a.hlc.localeCompare(b.hlc) || a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq);
  const replay: Replay = { document, writers, before: new Map(), protections: new Set(), events };
  const deleted = new Set<string>();
  for (const event of events) {
    const stateBefore = clone(document.state);
    const undoOps: BeforeOp[] = [];
    const original = event.undoOf ? replay.before.get(event.undoOf) : undefined;
    const protectionKeys = original?.protectionKeys ?? protectionCommands(event.command, stateBefore as WorkspaceState).map(command => {
      const target = object(command.args.target);
      return `${String(target.kind)}:${String(target.id)}:${String(command.args.field)}`;
    });
    replay.before.set(event.eventId, { ops: undoOps, writers: new Map(writers), protections: new Set(replay.protections), protectionKeys });
    for (const op of event.ops) applyReplayOp(replay, deleted, event, op, undoOps);
    updateProtections(replay.protections, stateBefore as WorkspaceState, event);
    if (original) for (const key of original.protectionKeys) {
      if (original.protections.has(key)) replay.protections.add(key); else replay.protections.delete(key);
    }
    for (const key of protectionKeys) writers.set(`protection:${key}`, event.eventId);
    document.frontier[event.deviceId] = Math.max(document.frontier[event.deviceId] ?? 0, event.seq);
    document.maxHlc = event.hlc;
  }
  document.fieldWriters = Object.fromEntries(writers);
  return replay;
}
function list(state: WorkspaceStateDoc['state'], kind: Exclude<RecordKind, 'settings'>): DataRecord[] {
  if (kind === 'device' && !state.devices) state.devices = [];
  return state[COLLECTIONS[kind]] as unknown as DataRecord[];
}
function applyReplayOp(replay: Replay, deleted: Set<string>, event: ChangeEvent, op: Op, before: BeforeOp[]) {
  const state = replay.document.state;
  const key = recordKey(op.kind, op.id);
  const records = op.kind === 'settings' ? [] : list(state, op.kind);
  const record = op.kind === 'settings' ? state.settings as DataRecord : records.find(record => (op.kind === 'rejection' ? record.signature : record.id) === op.id);
  if (op.op === 'create') {
    if (record || (deleted.has(key) && !event.undoOf)) return;
    const created = clone(object(op.record)); records.push(created); deleted.delete(key);
    before.push({ op, previous: null, existed: false });
    for (const field of Object.keys(created)) replay.writers.set(writerKey(op.kind, op.id, field), event.eventId);
  } else if (op.op === 'tombstone') {
    before.push({ op, previous: clone(record ?? null), existed: Boolean(record) });
    if (record) records.splice(records.indexOf(record), 1);
    deleted.add(key);
  } else {
    if (!record) return;
    const field = op.field!;
    before.push({ op, previous: clone(record[field] ?? null), existed: Object.hasOwn(record, field) });
    if (op.value === null && !(op.kind === 'initiative' && field === 'moscow')) delete record[field];
    else record[field] = clone(op.value);
    replay.writers.set(writerKey(op.kind, op.id, field), event.eventId);
  }
  replay.writers.set(key, event.eventId);
}
function updateProtections(protections: Set<string>, before: WorkspaceState, event: ChangeEvent) {
  if (!['user', 'mcp'].includes(event.actor)) return;
  for (const op of event.actor === 'user' ? event.ops : []) if (op.op === 'set' && !['protectedFields', 'updatedAt'].includes(op.field!)) protections.add(writerKey(op.kind, op.id, op.field!));
  for (const invocation of protectionCommands(event.command, before)) {
    const args = invocation.args; const target = object(args.target);
    const key = `${String(target.kind)}:${String(target.id)}:${String(args.field)}`;
    if (invocation.name === 'field.protect') protections.add(key); else protections.delete(key);
  }
}
function protectionCommands(command: ChangeEvent['command'], before: WorkspaceState, visited = new Set<string>()): ChangeEvent['command'][] {
  if (['field.protect', 'field.unprotect'].includes(command.name)) return [command];
  if (command.name !== 'question.resolve') return [];
  const id = String(command.args.id);
  if (visited.has(id)) return [];
  visited.add(id);
  const question = before.questions.find(question => question.id === id);
  const resolution = question?.resolutions.find(resolution => resolution.id === command.args.resolutionId);
  return resolution?.commands.flatMap(command => protectionCommands(command, before, visited)) ?? [];
}
