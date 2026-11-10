import type { Assertion, EvidenceRef, Question, Target } from '@fulcrum/schema';
import { suggestionSignature, planQuestion } from '@fulcrum/domain';
import type { CommandEnvelope } from '@fulcrum/domain';
import type { Candidate } from '@fulcrum/llm/interfaces';
import type { CanonicalRecord, ClaimInput, Invocation, ReconciliationInput, ReconciliationPlan, ReconciliationProof } from './reconciliation-types.js';
export const normalizeHint = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const sameTarget = (a: Target, b: Target): boolean => a.kind === b.kind && a.id === b.id && a.field === b.field;
export class PlanBuilder {
  readonly snapshot;
  readonly source;
  readonly plan: ReconciliationPlan;
  constructor(readonly input: ReconciliationInput) {
    this.snapshot = structuredClone(input.snapshot);
    this.source = this.snapshot.state.sources.find(source => source.id === input.sourceId)!;
    this.plan = { commands: [], questions: [], suggestions: [], proofs: {}, baseFrontier: structuredClone(input.snapshot.frontier), runId: input.runId };
  }
  id(key: string): string { return this.input.idForKey(`reconcile:v1:${this.snapshot.workspaceId}:${key}`); }
  eventTime(sourceId: string): number {
    const source = this.snapshot.state.sources.find(source => source.id === sourceId);
    return source?.happenedAt ? Date.parse(source.happenedAt) : Number.NEGATIVE_INFINITY;
  }
  rejected(invocation: Invocation): boolean {
    const signature = suggestionSignature(invocation);
    return this.input.rejections.some(rejection => rejection.signature === signature && (!rejection.untilNewEvidence || this.eventTime(this.source.id) <= Date.parse(rejection.rejectedAt)));
  }
  envelope(invocation: Invocation, evidenceRefs: EvidenceRef[]): CommandEnvelope {
    return { ...structuredClone(invocation), actor: 'ai', evidenceRefs: structuredClone(evidenceRefs), runId: this.input.runId,
      idempotencyKey: `reconcile:${this.id(`command:${this.source.id}:${this.source.contentHash}:${suggestionSignature(invocation)}`)}` };
  }
  emit(invocation: Invocation, evidenceRefs: EvidenceRef[], lane: 'commands' | 'questions' | 'suggestions' = 'commands', proof?: ReconciliationProof): boolean {
    if (invocation.name === 'question.raise') {
      const record = planQuestion(this.snapshot, invocation.args.record as Question, this.input.idForKey, this.input.observedAt);
      if (!record) return false;
      const stableRecord = Object.fromEntries(Object.entries(record).filter(([field]) => !['createdAt', 'state'].includes(field)));
      invocation = { name: 'question.raise', args: { record: stableRecord } };
    }
    if (this.rejected(invocation)) return false;
    const command = this.envelope(invocation, evidenceRefs);
    if (this.plan[lane].some(existing => existing.idempotencyKey === command.idempotencyKey)) return false;
    this.plan[lane].push(command);
    if (proof) this.plan.proofs[suggestionSignature(invocation)] = structuredClone(proof);
    return true;
  }
  evidence(candidate: Candidate): [EvidenceRef, ...EvidenceRef[]] {
    const range = this.source.cachePolicy === 'excerpt' && this.source.excerpt === this.input.sourceText ? { range: structuredClone(candidate.span) } : {};
    return [{ sourceId: this.source.id, ...range }];
  }
  claim(input: ClaimInput): Assertion {
    return { ...structuredClone(input), id: this.id(`assertion:${this.source.id}:${this.source.contentHash}:${JSON.stringify(input.target)}:${input.predicate}:${JSON.stringify(input.value)}`), observedAt: this.input.observedAt, certainty: 'explicit', ...(this.source.happenedAt ? { validFrom: this.source.happenedAt } : {}) };
  }
  recordClaim(claim: Assertion, lane: 'commands' | 'suggestions' = 'commands'): boolean {
    if (this.snapshot.state.assertions.some(existing => existing.id === claim.id)) return false;
    const record = Object.fromEntries(Object.entries(claim).filter(([field]) => field !== 'observedAt'));
    if (!this.emit({ name: 'assertion.record', args: { record } }, claim.evidenceRefs, lane)) return false;
    this.snapshot.state.assertions.push(claim); return true;
  }
  questionIdentity(baseKey: string, target: Target, reason: Question['reason'], evidenceRefs: EvidenceRef[]): { id: string; dedupeKey: string } | undefined {
    const related = this.snapshot.state.questions.filter(question => sameTarget(question.target, target) && question.reason === reason);
    const open = related.find(question => ['open', 'deferred'].includes(question.state));
    if (open) return { id: open.id, dedupeKey: open.dedupeKey };
    const previous = related.at(-1);
    const previousTime = Math.max(Number.NEGATIVE_INFINITY, ...(previous?.evidenceRefs ?? []).map(ref => this.eventTime(ref.sourceId)));
    if (previous && !evidenceRefs.some(ref => this.eventTime(ref.sourceId) > previousTime)) return;
    const dedupeKey = previous ? `${baseKey}:after:${previous.id}:${this.source.id}:${this.source.contentHash}` : baseKey;
    return { id: this.id(`question:${dedupeKey}`), dedupeKey };
  }
  record(target: Target): CanonicalRecord | undefined {
    return (target.kind === 'initiative' ? this.snapshot.state.initiatives : target.kind === 'node' ? this.snapshot.state.nodes : this.snapshot.state.edges).find(record => record.id === target.id);
  }
  protected(target: Target, fields: string[]): boolean {
    const record = this.record(target);
    const protectedFields = record && 'protectedFields' in record && Array.isArray(record.protectedFields) ? record.protectedFields : [];
    return fields.some(field => protectedFields.includes(field) || this.input.protections?.some(protection => protection.target.kind === target.kind && protection.target.id === target.id && protection.field === field));
  }
  attach(target: Target, evidenceRefs: EvidenceRef[]) {
    const record = this.record(target);
    if (!record) return;
    for (const evidenceRef of evidenceRefs) {
      if (record.evidenceRefs?.some(ref => ref.sourceId === evidenceRef.sourceId)) continue;
      this.emit({ name: 'evidence.attach', args: { target: { kind: target.kind, id: target.id }, evidenceRef } }, evidenceRefs);
      record.evidenceRefs = [...(record.evidenceRefs ?? []), evidenceRef];
    }
  }
}
