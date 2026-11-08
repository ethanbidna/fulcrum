import type { Actor, ChangeEvent, EvidenceRef, Op, Target } from '@fulcrum/schema';
import type { Replay } from './replay.js';
import { clone, DomainFault } from './commands.js';

export interface HistoryChange {
  kind: Op['kind']; id: string; operation: Op['op']; field?: string;
  before: unknown; after: unknown;
}
export interface HistoryEntry {
  eventId: string; actor: Actor; at: string; deviceId: string;
  command: ChangeEvent['command']; changes: HistoryChange[]; evidenceRefs: EvidenceRef[];
  runId?: string; undoOf?: string;
}
export interface HistoryFilter { target?: Target; actor?: Actor; since?: string }
export function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new DomainFault('VALIDATION_FAILED', 'Expected a timestamp');
  return time;
}
export function projectHistory(replay: Replay, filter: HistoryFilter = {}): HistoryEntry[] {
  const since = filter.since === undefined ? -Infinity : timestamp(filter.since);
  return [...replay.events].reverse().filter(event => (!filter.actor || event.actor === filter.actor) && timestamp(event.at) >= since)
    .map(event => historyEntry(replay, event)).filter(entry => !filter.target || entry.changes.some(change =>
      change.kind === filter.target!.kind && change.id === filter.target!.id && (!filter.target!.field || change.field === filter.target!.field)));
}
function historyEntry(replay: Replay, event: ChangeEvent): HistoryEntry {
  const changes = replay.before.get(event.eventId)!.ops.map(({ op, previous }): HistoryChange => ({
    kind: op.kind, id: op.id, operation: op.op, ...(op.field ? { field: op.field } : {}),
    before: clone(previous), after: clone(op.op === 'create' ? op.record : op.op === 'tombstone' ? null : op.value),
  }));
  return { eventId: event.eventId, actor: event.actor, at: event.at, deviceId: event.deviceId,
    command: clone(event.command), changes, evidenceRefs: clone(event.evidenceRefs ?? []),
    ...(event.runId ? { runId: event.runId } : {}), ...(event.undoOf ? { undoOf: event.undoOf } : {}) };
}
