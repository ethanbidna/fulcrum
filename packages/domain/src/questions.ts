import type { EvidenceRef, Question, Target, WorkspaceStateDoc } from '@fulcrum/schema';
import { clone, suggestionSignature, validateInvocation } from './commands.js';
import type { CommandEnvelope } from './commands.js';

export type QuestionCandidate = Omit<Question, 'id' | 'createdAt' | 'state'>;
export type QuestionIdentity = (dedupeKey: string) => string;
const MIN_CHOICES = 2;
const MAX_CHOICES = 3;
const MAX_CHOICE_COMMANDS = 63;
export const liveQuestion = (question: Question): boolean => ['open', 'deferred'].includes(question.state);
export const sameQuestionTarget = (a: Target, b: Target): boolean => a.kind === b.kind && a.id === b.id && a.field === b.field;
export function executableChoices(choices: Question['resolutions']): boolean {
  if (!Array.isArray(choices)) return false;
  if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) return false;
  try {
    if (new Set(choices.map(choice => choice.id)).size !== choices.length) return false;
    for (const choice of choices) {
      if (!choice.id.trim() || !choice.label.trim() || choice.commands.length > MAX_CHOICE_COMMANDS) return false;
      for (const command of choice.commands) {
        validateInvocation(command);
        if (['question.raise', 'question.resolve', 'command.apply', 'run.undo'].includes(command.name)) return false;
        if (command.name === 'change.undo' && choice.commands.length !== 1) return false;
      }
    }
    return true;
  } catch { return false; }
}
export function mergeQuestionEvidence(...groups: (EvidenceRef[] | undefined)[]): EvidenceRef[] {
  const refs = groups.flatMap(group => group ?? []);
  return [...new Map(refs.map(ref => [JSON.stringify(ref), clone(ref)])).values()];
}
function choiceSignature(question: Pick<Question, 'resolutions'>): string {
  return JSON.stringify(question.resolutions.map(choice => choice.commands.map(suggestionSignature)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function evidenceTime(snapshot: WorkspaceStateDoc, refs: EvidenceRef[] = []): number {
  return Math.max(Number.NEGATIVE_INFINITY, ...refs.map(ref => {
    const source = snapshot.state.sources.find(source => source.id === ref.sourceId);
    return source?.happenedAt ? Date.parse(source.happenedAt) : Number.NEGATIVE_INFINITY;
  }));
}
export function planQuestion(snapshot: WorkspaceStateDoc, candidate: QuestionCandidate, identify: QuestionIdentity, now: string): Question | undefined {
  if (!['medium', 'high'].includes(candidate.materiality) || !candidate.dedupeKey.trim() || !executableChoices(candidate.resolutions)) return;
  const related = snapshot.state.questions.filter(question => question.initiativeId === candidate.initiativeId && sameQuestionTarget(question.target, candidate.target)
    && (question.dedupeKey === candidate.dedupeKey || (question.reason === candidate.reason && choiceSignature(question) === choiceSignature(candidate))));
  const existing = related.find(liveQuestion);
  const closed = related.filter(question => !liveQuestion(question)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!existing && closed && evidenceTime(snapshot, candidate.evidenceRefs) <= evidenceTime(snapshot, closed.evidenceRefs)) return;
  const dedupeKey = existing?.dedupeKey ?? (closed ? `${candidate.dedupeKey}:after:${closed.id}:${evidenceTime(snapshot, candidate.evidenceRefs)}` : candidate.dedupeKey);
  return { ...clone(candidate), id: existing?.id ?? identify(dedupeKey), dedupeKey, createdAt: existing?.createdAt ?? now,
    state: existing?.state ?? 'open', ...(existing?.deferredUntil ? { deferredUntil: existing.deferredUntil } : {}),
    evidenceRefs: mergeQuestionEvidence(existing?.evidenceRefs, candidate.evidenceRefs) };
}
export function obsoleteQuestions(snapshot: WorkspaceStateDoc): CommandEnvelope[] {
  return snapshot.state.questions.flatMap(question => {
    if (!liveQuestion(question) || !['conflicting_sources', 'protected_field_challenge', 'ambiguous_evidence'].includes(question.reason ?? '') || !question.target.field) return [];
    const target = question.target;
    const records = target.kind === 'initiative' ? snapshot.state.initiatives : target.kind === 'node' ? snapshot.state.nodes : snapshot.state.edges;
    const record = records.find(record => record.id === target.id);
    if (!record) return [];
    const claim = snapshot.state.assertions.find(claim => sameQuestionTarget(claim.target, target) && claim.predicate === target.field && claim.status === 'applied'
      && JSON.stringify(claim.value) === JSON.stringify((record as unknown as Record<string, unknown>)[target.field!])
      && evidenceTime(snapshot, claim.evidenceRefs) > evidenceTime(snapshot, question.evidenceRefs));
    if (!claim) return [];
    const unresolved = snapshot.state.assertions.some(other => sameQuestionTarget(other.target, target) && other.predicate === target.field
      && ['conflicting', 'pending', 'suggested'].includes(other.status) && JSON.stringify(other.value) !== JSON.stringify(claim.value)
      && evidenceTime(snapshot, other.evidenceRefs) >= evidenceTime(snapshot, claim.evidenceRefs));
    if (unresolved) return [];
    return [{ name: 'question.markObsolete', args: { id: question.id }, actor: 'system', evidenceRefs: clone(claim.evidenceRefs) }];
  });
}
