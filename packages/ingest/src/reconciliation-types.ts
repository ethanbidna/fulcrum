import type { Assertion, CommandInvocation, EvidenceRef, Rejection, Target, WorkspaceStateDoc } from '@fulcrum/schema';
import type { CommandEnvelope, DomainPorts } from '@fulcrum/domain';
import type { EntityResolution } from '@fulcrum/context/interfaces';
import type { Candidate } from '@fulcrum/llm/interfaces';
export type ReconciliationProof = NonNullable<ReturnType<NonNullable<DomainPorts['reconciliationProof']>>>;
export interface ReconciliationInput {
  candidates: Candidate[]; resolutions: EntityResolution[];
  snapshot: WorkspaceStateDoc; rejections: Rejection[];
  sourceId: string; sourceText: string; initiativeId: string; userEntityId: string;
  observedAt: string; runId: string;
  idForKey(key: string): string;
  protections?: { target: Target; field: string }[];
}
export interface ReconciliationPlan {
  commands: CommandEnvelope[]; questions: CommandEnvelope[]; suggestions: CommandEnvelope[];
  proofs: Record<string, ReconciliationProof>;
  baseFrontier: WorkspaceStateDoc['frontier']; runId: string;
}
export interface ClaimInput { target: Target; predicate: string; value: unknown; evidenceRefs: [EvidenceRef, ...EvidenceRef[]]; status: Assertion['status']; supersededBy?: string }
export type Invocation = CommandInvocation & { name: CommandEnvelope['name'] };
export interface FactInput { target: Target; field: string; value: unknown; invocation: Invocation; candidate: Candidate; suggestionOnly?: true; protectFields?: string[] }
export type CanonicalRecord = WorkspaceStateDoc['state']['initiatives'][number] | WorkspaceStateDoc['state']['nodes'][number] | WorkspaceStateDoc['state']['edges'][number];
