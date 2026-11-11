import type { FlowEdge, Target } from '@fulcrum/schema';
import type { Candidate } from '@fulcrum/llm/interfaces';
import { checkInvariants, suggestionSignature } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import type { CanonicalRecord, ReconciliationInput, ReconciliationPlan } from './reconciliation-types.js';
import { PlanBuilder, normalizeHint } from './reconciliation-plan.js';
import { planCommitment, planInitiative } from './reconciliation-commitments.js';
import { planFact } from './reconciliation-facts.js';
const MAX_CANDIDATES = 32;
const STATES: Record<string, readonly string[]> = { task: ['open', 'done', 'cancelled'], dependency: ['waiting', 'satisfied', 'blocked', 'expired', 'unverified', 'cancelled'], decision: ['open', 'decided', 'cancelled'], milestone: ['pending', 'achieved', 'missed', 'cancelled'] };
const MOSCOW: Record<string, string> = { must_do: 'must_do', should_do: 'should_do', could_do: 'could_do', wont_do: 'wont_do', 'must do': 'must_do', 'should do': 'should_do', 'could do': 'could_do', "won't do": 'wont_do' };
export function reconcile(input: ReconciliationInput): ReconciliationPlan {
  const builder = new PlanBuilder(input);
  if (!builder.source || !input.runId || !Array.isArray(input.candidates) || input.candidates.length > MAX_CANDIDATES || !builder.snapshot.state.initiatives.some(initiative => initiative.id === input.initiativeId)) return builder.plan;
  for (const candidate of input.candidates) {
    if (!validSpan(candidate, input.sourceText)) continue;
    planCandidate(builder, candidate);
  }
  return structuredClone(builder.plan);
}
export function proofFor(plan: ReconciliationPlan, command: { name: string; args: Record<string, unknown> }) {
  const proof = plan.proofs[suggestionSignature({ name: command.name, args: command.args })]; return proof && structuredClone(proof);
}
function validSpan(candidate: Candidate, text: string): boolean {
  const span = candidate?.span;
  return !!span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.start < span.end && span.end <= text.length && !!text.slice(span.start, span.end).trim();
}
function planCandidate(builder: PlanBuilder, candidate: Candidate) {
  switch (candidate.kind) {
    case 'user_commitment': case 'external_commitment': return planCommitment(builder, candidate);
    case 'new_initiative': return planInitiative(builder, candidate);
    case 'state_change': return planState(builder, candidate);
    case 'date': return planDate(builder, candidate);
    case 'decision_made': return planDecision(builder, candidate);
    case 'priority_opinion': return planPriority(builder, candidate);
    case 'relationship': return planRelationship(builder, candidate);
  }
}
function targetFor(builder: PlanBuilder, hint: string): { target: Target; record: CanonicalRecord } | undefined {
  if (typeof hint !== 'string') return;
  const initiatives = builder.snapshot.state.initiatives.filter(record => record.id === builder.input.initiativeId && (record.id === hint || normalizeHint(record.title) === normalizeHint(hint)));
  const nodes = builder.snapshot.state.nodes.filter(record => record.initiativeId === builder.input.initiativeId && (record.id === hint || normalizeHint(record.title) === normalizeHint(hint)));
  if (initiatives.length + nodes.length !== 1) return;
  const record = initiatives[0] ?? nodes[0]!; return { target: { kind: initiatives.length ? 'initiative' : 'node', id: record.id }, record };
}
function planState(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'state_change' }>) {
  const match = targetFor(builder, candidate.targetHint);
  if (!match || match.target.kind !== 'node' || !('type' in match.record) || !STATES[String(match.record.type)]?.includes(candidate.newState) || (match.record.type === 'decision' && candidate.newState === 'decided')) return;
  planFact(builder, { ...match, field: 'state', value: candidate.newState, candidate, invocation: { name: 'node.setState', args: { id: match.target.id, state: candidate.newState } } });
}
function planDate(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'date' }>) {
  const match = targetFor(builder, candidate.targetHint);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date) || !Number.isFinite(Date.parse(candidate.date)) || new Date(candidate.date).toISOString().slice(0, 'YYYY-MM-DD'.length) !== candidate.date) return;
  planFact(builder, { ...match, field: 'targetDate', value: candidate.date, candidate, invocation: { name: match.target.kind === 'initiative' ? 'initiative.update' : 'node.update', args: { id: match.target.id, patch: { targetDate: candidate.date } } } });
}
function planDecision(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'decision_made' }>) {
  const match = targetFor(builder, candidate.targetHint);
  if (!match || !('type' in match.record) || match.record.type !== 'decision' || !Array.isArray(match.record.options) || typeof candidate.optionHint !== 'string') return;
  const options = (match.record.options as { id: string; label: string }[]).filter(option => option.id === candidate.optionHint || normalizeHint(option.label) === normalizeHint(candidate.optionHint));
  if (options.length !== 1) return;
  planFact(builder, { ...match, field: 'outcome', protectFields: ['state', 'outcome'], value: options[0]!.id, candidate, invocation: { name: 'decision.decide', args: { id: match.target.id, outcome: options[0]!.id } } });
}
function planPriority(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'priority_opinion' }>) {
  const match = targetFor(builder, candidate.targetHint); const value = typeof candidate.value === 'string' && MOSCOW[normalizeHint(candidate.value)];
  if (!match || match.target.kind !== 'initiative' || !value || !Object.hasOwn(MOSCOW, normalizeHint(candidate.value))) return;
  planFact(builder, { ...match, field: 'moscow', value, candidate, suggestionOnly: true, invocation: { name: 'initiative.setMoscow', args: { id: match.target.id, moscow: value } } });
}
function planRelationship(builder: PlanBuilder, candidate: Extract<Candidate, { kind: 'relationship' }>) {
  if (!['depends_on', 'leads_to'].includes(candidate.type)) return;
  const from = targetFor(builder, candidate.fromHint); const to = targetFor(builder, candidate.toHint);
  if (!from || !to || from.target.kind !== 'node' || to.target.kind !== 'node' || from.target.id === to.target.id) return;
  const existing = builder.snapshot.state.edges.find(edge => edge.fromId === from.target.id && edge.toId === to.target.id && edge.type === candidate.type);
  const evidenceRefs = builder.evidence(candidate);
  if (existing) return builder.attach({ kind: 'edge', id: existing.id }, evidenceRefs);
  const id = builder.id(`edge:${from.target.id}:${candidate.type}:${to.target.id}`);
  const record: FlowEdge = { id, initiativeId: builder.input.initiativeId, fromId: from.target.id, toId: to.target.id, type: candidate.type, evidenceRefs, certainty: 'explicit' as const, createdAt: builder.input.observedAt, updatedAt: builder.input.observedAt };
  const tentative = structuredClone(builder.snapshot.state); tentative.edges.push(record);
  if (checkInvariants(tentative as WorkspaceState).length) return;
  const commandRecord = { id, initiativeId: record.initiativeId, fromId: record.fromId, toId: record.toId, type: record.type, certainty: record.certainty };
  if (!builder.emit({ name: 'edge.create', args: { record: commandRecord } }, evidenceRefs, 'commands', { match: { attempted: true, matchedId: null } })) return;
  record.evidenceRefs = []; builder.snapshot.state.edges.push(record); builder.attach({ kind: 'edge', id }, evidenceRefs);
}
export type { ReconciliationInput, ReconciliationPlan, ReconciliationProof } from './reconciliation-types.js';
