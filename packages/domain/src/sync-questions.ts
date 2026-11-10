import type { Question, Target } from '@fulcrum/schema';
import { clone, COLLECTIONS } from './commands.js';
import type { CommandEnvelope } from './commands.js';
import type { Replay, ReplayConflict } from './replay.js';
import type { QuestionIdentity } from './questions.js';

export const SYNC_FIELDS = {
  initiative: ['moscow', 'lifecycle', 'title'], node: ['state', 'outcome', 'title', 'type'], edge: ['type', 'fromId', 'toId', 'condition'],
} as const;
export function syncQuestions(replay: Replay, identify: QuestionIdentity): CommandEnvelope[] {
  const latest = new Map<string, ReplayConflict>();
  for (const conflict of replay.conflicts) if (conflict.material && ['initiative', 'node', 'edge'].includes(conflict.kind)) latest.set(`sync:${conflict.kind}:${conflict.id}:${conflict.type === 'write_after_delete' ? 'deleted' : conflict.field}`, conflict);
  return [...latest].flatMap(([key, conflict]) => {
    const occurrence = `question:${key}:${conflict.winner ?? conflict.eventId}`;
    if (replay.events.some(event => event.idempotencyKey === occurrence)) return [];
    const kind = conflict.kind as Target['kind'];
    const records = replay.document.state[COLLECTIONS[kind]];
    const record = records.find(record => record.id === conflict.id);
    if (conflict.type === 'concurrent_write' && record) {
      // A causally later edit has already settled this historical collision.
      if (replay.writers.get(`${kind}:${conflict.id}:${conflict.field}`) !== conflict.winner) return [];
      const choose = (value: unknown) => [{ name: 'sync.chooseValue', args: { target: { kind, id: conflict.id }, field: conflict.field, value: clone(value ?? null), baseEventId: conflict.winner } }];
      const target: Target = { kind, id: conflict.id, field: conflict.field! };
      return [envelope(replay, identify, key, occurrence, target, kind === 'initiative' ? record.id : (record as { initiativeId: string }).initiativeId,
        [{ id: 'keep', label: 'Keep the current value', commands: [] }, { id: 'other', label: 'Use the other value', commands: choose(conflict.values![0]) }])];
    }
    if (conflict.type !== 'write_after_delete' || record) return [];
    const deletion = [...replay.events].reverse().find(event => event.ops.some(op => op.op === 'tombstone' && op.kind === kind && op.id === conflict.id));
    const saved = deletion && replay.before.get(deletion.eventId)?.ops.find(before => before.op.op === 'tombstone' && before.op.kind === kind && before.op.id === conflict.id)?.previous;
    const initiativeId = kind === 'initiative' ? conflict.id : (saved as { initiativeId?: string } | undefined)?.initiativeId;
    if (!deletion || !initiativeId || !replay.document.state.initiatives.some(initiative => initiative.id === initiativeId)) return [];
    return [envelope(replay, identify, key, occurrence, { kind: 'initiative', id: initiativeId }, initiativeId,
      [{ id: 'keep', label: 'Keep the record deleted', commands: [] }, { id: 'restore', label: 'Restore the deleted record and its links', commands: [{ name: 'change.undo', args: { eventId: deletion.eventId } }] }])];
  });
}
function envelope(replay: Replay, identify: QuestionIdentity, baseKey: string, occurrence: string, target: Target, initiativeId: string, resolutions: Question['resolutions']): CommandEnvelope {
  const related = replay.document.state.questions.filter(question => question.dedupeKey === baseKey || question.dedupeKey.startsWith(`${baseKey}:question:`));
  const active = related.find(question => ['open', 'deferred'].includes(question.state));
  const dedupeKey = active?.dedupeKey ?? (related.length ? `${baseKey}:${occurrence}` : baseKey);
  return { name: 'question.raise', actor: 'system', idempotencyKey: occurrence, args: { record: {
    id: identify(dedupeKey), initiativeId, target, prompt: 'Concurrent edits need your choice.', reason: 'sync_conflict', materiality: 'high', dedupeKey, resolutions,
  } } };
}
