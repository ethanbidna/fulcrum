import type { FlowObject } from '@fulcrum/schema';
import type { Candidate } from '@fulcrum/llm/interfaces';
import { identityQuestion } from './identity.js';
import { PlanBuilder, normalizeHint } from './reconciliation-plan.js';
const MAX_NODE_TITLE = 300;
const MAX_INITIATIVE_TITLE = 200;
const MAX_DESCRIPTION = 4000;
export function planCommitment(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'user_commitment' | 'external_commitment' }>) {
  if (!candidate.text?.trim() || candidate.text.length > MAX_NODE_TITLE) return;
  const speaker = commitmentSpeaker(builder, candidate);
  if (!speaker) { if (candidate.kind === 'external_commitment') planIdentityQuestion(builder, candidate); return; }
  const type = candidate.kind === 'user_commitment' ? 'task' : 'dependency';
  const sameTitle = builder.snapshot.state.nodes.filter(node => node.initiativeId === builder.input.initiativeId && normalizeHint(node.title) === normalizeHint(candidate.text));
  const matches = sameTitle.filter(node => node.type === type && (type === 'task' || node.responsibleEntityId === speaker));
  if (matches.length > 1 || (sameTitle.length && !matches.length)) return;
  const existing = matches[0]; const evidenceRefs = builder.evidence(candidate);
  const nodeId = existing?.id ?? builder.id(`node:${builder.input.initiativeId}:${type}:${normalizeHint(candidate.text)}:${speaker}`);
  const target = { kind: 'node' as const, id: nodeId };
  const assertion = builder.claim({ target, predicate: candidate.kind, value: { text: candidate.text, speakerEntityId: speaker, unambiguous: true }, evidenceRefs, status: 'applied' });
  if (existing) { builder.recordClaim(assertion); builder.attach(target, evidenceRefs); return; }
  const common = { id: nodeId, initiativeId: builder.input.initiativeId, title: candidate.text, evidenceRefs, protectedFields: [], createdAt: builder.input.observedAt, updatedAt: builder.input.observedAt };
  const record: FlowObject = type === 'task' ? { ...common, type, state: 'open' }
    : { ...common, type, state: 'waiting', kind: 'person', responsibleEntityId: speaker };
  const commandRecord = { id: record.id, initiativeId: record.initiativeId, title: record.title, type, state: record.state, ...(type === 'dependency' ? { kind: 'person', responsibleEntityId: speaker } : {}) };
  if (!builder.emit({ name: 'node.create', args: { record: commandRecord } }, evidenceRefs, 'commands', { match: { attempted: true, matchedId: null }, commitmentAssertion: assertion })) return;
  record.evidenceRefs = []; builder.snapshot.state.nodes.push(record); builder.snapshot.state.assertions.push(assertion); builder.attach(target, evidenceRefs);
}
function commitmentSpeaker(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'user_commitment' | 'external_commitment' }>): string | undefined {
  if (candidate.kind === 'user_commitment') return builder.source.senderEntityId === builder.input.userEntityId ? builder.input.userEntityId : undefined;
  const resolved = builder.input.resolutions.filter(resolution => normalizeHint(resolution.mention.text) === normalizeHint(candidate.who));
  if (resolved.length !== 1 || resolved[0]!.status !== 'resolved') return;
  const speaker = resolved[0]!.entityId;
  if (speaker === builder.input.userEntityId || speaker !== builder.source.senderEntityId) return;
  return builder.snapshot.state.entities.some(entity => entity.id === speaker && !entity.mergedInto) ? speaker : undefined;
}
export function planInitiative(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'new_initiative' }>) {
  if (!candidate.title?.trim() || candidate.title.length > MAX_INITIATIVE_TITLE || typeof candidate.rationale !== 'string' || candidate.rationale.length > MAX_DESCRIPTION) return;
  const existing = builder.snapshot.state.initiatives.filter(initiative => normalizeHint(initiative.title) === normalizeHint(candidate.title));
  if (existing.length) { if (existing.length === 1) builder.attach({ kind: 'initiative', id: existing[0]!.id }, builder.evidence(candidate)); return; }
  const id = builder.id(`initiative:${normalizeHint(candidate.title)}`); const evidenceRefs = builder.evidence(candidate);
  const record = { id, title: candidate.title, description: candidate.rationale };
  if (!builder.emit({ name: 'initiative.propose', args: { record } }, evidenceRefs, 'commands', { match: { attempted: true, matchedId: null } })) return;
  builder.snapshot.state.initiatives.push({ ...record, lifecycle: 'proposed', moscow: null, categoryIds: [], protectedFields: ['moscow'], createdAt: builder.input.observedAt, updatedAt: builder.input.observedAt });
  builder.attach({ kind: 'initiative', id }, evidenceRefs);
  const dedupeKey = `proposal:${id}`;
  builder.emit({ name: 'question.raise', args: { record: { id: builder.id(`question:${dedupeKey}`), initiativeId: id, target: { kind: 'initiative', id }, reason: 'proposed_initiative',
    prompt: 'Add this proposed initiative to your portfolio?', evidenceRefs, dedupeKey, materiality: 'medium', resolutions: [
      { id: 'approve', label: 'Approve initiative', commands: [{ name: 'initiative.approve', args: { id } }] },
      { id: 'reject', label: 'Reject initiative', commands: [{ name: 'initiative.reject', args: { id } }] },
    ] } } }, evidenceRefs, 'questions');
}

function planIdentityQuestion(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'external_commitment' }>) {
  const resolutions = builder.input.resolutions.filter(resolution => normalizeHint(resolution.mention.text) === normalizeHint(candidate.who));
  if (resolutions.length !== 1 || resolutions[0]!.status !== 'ambiguous') return;
  const dependencies = builder.snapshot.state.nodes.filter(node => node.type === 'dependency' && node.initiativeId === builder.input.initiativeId && normalizeHint(node.title) === normalizeHint(candidate.text) && ['waiting', 'unverified', 'blocked'].includes(String(node.state)));
  if (dependencies.length !== 1) return;
  const dependency = dependencies[0]!; const evidenceRefs = builder.evidence(candidate);
  const target = { kind: 'node' as const, id: dependency.id };
  const identity = builder.questionIdentity(`identity:node:${dependency.id}:responsibleEntityId`, target, 'identity_ambiguity', evidenceRefs);
  if (!identity) return;
  const question = identityQuestion({ id: identity.id, resolution: resolutions[0]!, dependency, evidenceRefs, materiality: 'medium' });
  if (!question) return;
  const record = question.args.record as Record<string, unknown>;
  builder.emit({ name: 'question.raise', args: { record: { ...record, ...identity } } }, evidenceRefs, 'questions');
}
