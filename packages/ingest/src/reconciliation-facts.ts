import type { Assertion, EvidenceRef, Target } from '@fulcrum/schema';
import type { FactInput, Invocation } from './reconciliation-types.js';
import { PlanBuilder, sameValue, sameTarget } from './reconciliation-plan.js';
const MATERIAL_FIELDS = new Set(['state', 'outcome', 'moscow', 'title', 'lifecycle', 'condition', 'type', 'fromId', 'toId']);
export function planFact(builder: PlanBuilder, input: FactInput) {
  const record = builder.record(input.target);
  if (!record || builder.rejected(input.invocation)) return;
  const target = { ...input.target, field: input.field };
  const evidenceRefs = builder.evidence(input.candidate);
  const currentValue = record[input.field as keyof typeof record];
  const previous = builder.snapshot.state.assertions.filter(claim => sameTarget(claim.target, target) && claim.predicate === input.field && !['rejected', 'superseded', 'suggested'].includes(claim.status));
  const latestTime = Math.max(Number.NEGATIVE_INFINITY, ...previous.flatMap(claim => claim.evidenceRefs.map(ref => builder.eventTime(ref.sourceId))));
  const sourceTime = builder.eventTime(builder.source.id);
  const protectedField = builder.protected(target, input.protectFields ?? [input.field]);
  const claimId = builder.claim({ target, predicate: input.field, value: input.value, evidenceRefs, status: 'pending' }).id;
  const duplicate = builder.snapshot.state.assertions.some(claim => claim.id === claimId);
  if (duplicate) return;
  if (sourceTime < latestTime) return staleClaim(builder, input, target, evidenceRefs, previous);
  if (sameValue(currentValue, input.value)) {
    const claim = builder.claim({ target, predicate: input.field, value: input.value, evidenceRefs, status: input.suggestionOnly ? 'suggested' : 'applied' });
    builder.recordClaim(claim, input.suggestionOnly ? 'suggestions' : 'commands'); builder.attach(target, evidenceRefs); settleQuestions(builder, target, input.value, sourceTime, previous); return;
  }
  const conflict = previous.some(claim => !sameValue(claim.value, input.value));
  if (protectedField || input.suggestionOnly || (conflict && (MATERIAL_FIELDS.has(input.field) || sourceTime === latestTime))) {
    const suggested = protectedField || input.suggestionOnly;
    const claim = builder.claim({ target, predicate: input.field, value: input.value, evidenceRefs, status: suggested ? 'suggested' : 'conflicting' });
    builder.recordClaim(claim, suggested ? 'suggestions' : 'commands');
    if (!suggested) for (const previousClaim of previous) markClaim(builder, previousClaim, 'conflicting', null);
    const refs = uniqueEvidence([...previous.flatMap(claim => claim.evidenceRefs), ...evidenceRefs]);
    fieldQuestion(builder, target, input.invocation, refs, suggested ? 'protected_field_challenge' : 'conflicting_sources'); return;
  }
  const claim = builder.claim({ target, predicate: input.field, value: input.value, evidenceRefs, status: 'applied' });
  builder.recordClaim(claim);
  for (const previousClaim of previous) if (!sameValue(previousClaim.value, input.value)) markClaim(builder, previousClaim, 'superseded', claim.id);
  if (builder.emit(input.invocation, evidenceRefs)) {
    (record as unknown as Record<string, unknown>)[input.field] = input.value;
    if (input.invocation.name === 'decision.decide' && 'state' in record) record.state = 'decided';
  }
  builder.attach(target, evidenceRefs);
}
function staleClaim(builder: PlanBuilder, input: FactInput, target: Target, evidenceRefs: [EvidenceRef, ...EvidenceRef[]], previous: Assertion[]) {
  const newer = [...previous].sort((a, b) => Math.max(...b.evidenceRefs.map(ref => builder.eventTime(ref.sourceId))) - Math.max(...a.evidenceRefs.map(ref => builder.eventTime(ref.sourceId))))[0];
  if (!newer) return;
  builder.recordClaim(builder.claim({ target, predicate: input.field, value: input.value, evidenceRefs, status: 'superseded', supersededBy: newer.id }));
}
function markClaim(builder: PlanBuilder, claim: Assertion, status: 'conflicting' | 'superseded', supersededBy: string | null) {
  if (claim.status === status && (claim.supersededBy ?? null) === supersededBy) return;
  builder.emit({ name: 'assertion.setStatus', args: { id: claim.id, status, supersededBy } }, [{ sourceId: builder.source.id }]);
  claim.status = status; if (supersededBy) claim.supersededBy = supersededBy; else delete claim.supersededBy;
}
function fieldQuestion(builder: PlanBuilder, target: Target, invocation: Invocation, evidenceRefs: EvidenceRef[], reason: 'protected_field_challenge' | 'conflicting_sources') {
  const baseKey = `reconcile:${reason}:${target.kind}:${target.id}:${target.field}`;
  const identity = builder.questionIdentity(baseKey, target, reason, evidenceRefs);
  if (!identity) return;
  builder.emit({ name: 'question.raise', args: { record: { ...identity, initiativeId: builder.input.initiativeId, target,
    prompt: reason === 'conflicting_sources' ? 'Keep the current value or use the conflicting source claim?' : 'Keep your value or apply this source-backed suggestion?',
    reason, evidenceRefs, materiality: 'medium', resolutions: [
      { id: 'keep', label: 'Keep current value', commands: [{ name: 'field.protect', args: { target: { kind: target.kind, id: target.id }, field: target.field } }] }, { id: 'apply', label: 'Apply source claim', commands: [invocation] },
    ] } } }, evidenceRefs, 'questions');
}
function settleQuestions(builder: PlanBuilder, target: Target, value: unknown, sourceTime: number, previous: Assertion[]) {
  for (const question of builder.snapshot.state.questions) {
    if (!sameTarget(question.target, target) || !['open', 'deferred'].includes(question.state) || !['conflicting_sources', 'protected_field_challenge'].includes(question.reason ?? '')) continue;
    const evidenceTime = Math.max(Number.NEGATIVE_INFINITY, ...(question.evidenceRefs ?? []).map(ref => builder.eventTime(ref.sourceId)));
    if (sourceTime <= evidenceTime || previous.some(claim => !sameValue(claim.value, value) && claim.evidenceRefs.some(ref => builder.eventTime(ref.sourceId) >= sourceTime))) continue;
    builder.emit({ name: 'question.markObsolete', args: { id: question.id } }, [{ sourceId: builder.source.id }], 'questions'); question.state = 'obsolete';
  }
}
function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] { return [...new Map(refs.map(ref => [ref.sourceId, ref])).values()]; }
