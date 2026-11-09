import type { Actor, EvidenceRef, Materiality, Target } from '@fulcrum/schema';
import type { WorkspaceState } from './types.js';

export const PolicyRule = {
  Activation: 'P1_NO_AI_ACTIVATION',
  TaskCommitment: 'P2_AI_TASK_ONLY_FOR_EXPLICIT_COMMITMENT',
  ExternalWork: 'P3_EXTERNAL_WORK_IS_DEPENDENCY',
  ProtectedFields: 'P4_PROTECTED_FIELDS',
  Evidence: 'P5_EVIDENCE_REQUIRED',
  ManualPrecedence: 'P6_MANUAL_PRECEDENCE',
  Reintroduction: 'P7_NO_REINTRODUCTION',
  PreferUpdate: 'P8_PREFER_UPDATE',
  MaterialQuestions: 'P9_MATERIAL_QUESTIONS_ONLY',
  ConnectorScope: 'P10_CONNECTOR_SCOPE',
  IngestionDevice: 'P11_INGESTION_DEVICE',
  McpScope: 'P12_MCP_SCOPE',
} as const;
export type PolicyRuleId = typeof PolicyRule[keyof typeof PolicyRule];

export interface FieldWrite { target: Target; field: string }

// The command handler derives this intent from validated args, never source text.
export interface PolicyIntent {
  name: string;
  actor: Actor;
  writes: FieldWrite[];
  initiativeIds: string[];
  evidenceRefs?: EvidenceRef[];
  lifecycle?: string;
  creation?: { kind: 'initiative' | 'node' | 'entity' | 'edge'; id: string; nodeType?: string };
  commitmentAssertionId?: string;
  suggestionSignature?: string;
  question?: { materiality: Materiality; dedupeKey: string };
}

export interface PolicyContext {
  state: WorkspaceState;
  deviceId: string;
  userEntityId: string;
  match?: { attempted: true; matchedId: string | null };
  mcp?: { enabled: boolean; readOnly: boolean; initiativeIds?: string[]; categoryIds?: string[] };
}

export type PolicyResult =
  | { ok: false; rule: PolicyRuleId; disposition: 'deny' | 'suggest' | 'drop' }
  | { ok: true; protect: FieldWrite[]; tagMcpWrite: boolean; updateQuestionId?: string };

function deny(rule: PolicyRuleId, disposition: 'deny' | 'suggest' | 'drop' = 'deny'): PolicyResult {
  return { ok: false, rule, disposition };
}

export function checkPolicy(intent: PolicyIntent, context: PolicyContext): PolicyResult {
  if (intent.actor === 'connector' && intent.name !== 'source.record') return deny(PolicyRule.ConnectorScope);
  if ((intent.actor === 'ai' || intent.actor === 'connector') && context.deviceId !== context.state.settings.ingestionDeviceId) {
    return deny(PolicyRule.IngestionDevice);
  }
  const activation = intent.name === 'initiative.create' || intent.name === 'initiative.approve'
    || (intent.name === 'initiative.setLifecycle' && intent.lifecycle === 'active');
  if (activation && intent.actor !== 'user' && intent.actor !== 'mcp') return deny(PolicyRule.Activation);
  if (intent.name === 'field.unprotect' && intent.actor !== 'user') return deny(PolicyRule.ManualPrecedence);
  if (intent.actor === 'mcp' && !mcpScopeAllows(intent, context)) return deny(PolicyRule.McpScope);
  if (intent.actor === 'ai') {
    const result = checkAiPolicy(intent, context);
    if (result) return result;
  }
  const question = intent.question;
  if (intent.name === 'question.raise' && (!question || !['medium', 'high'].includes(question.materiality) || !question.dedupeKey.trim())) {
    return deny(PolicyRule.MaterialQuestions);
  }
  const existing = question && context.state.questions.find(q => q.dedupeKey === question.dedupeKey && ['open', 'deferred'].includes(q.state));
  const protect = ['user', 'mcp'].includes(intent.actor) && intent.name !== 'field.unprotect' ? intent.writes : [];
  return { ok: true, protect, tagMcpWrite: intent.actor === 'mcp', ...(existing ? { updateQuestionId: existing.id } : {}) };
}

function checkAiPolicy(intent: PolicyIntent, context: PolicyContext): PolicyResult | undefined {
  if (!validEvidence(intent, context)) return deny(PolicyRule.Evidence, 'suggest');
  if (intent.writes.some(write => protectedField(write, context.state))) return deny(PolicyRule.ProtectedFields, 'suggest');
  if (rejectedSuggestion(intent, context)) return deny(PolicyRule.Reintroduction, 'drop');
  if (intent.creation && (!context.match?.attempted || context.match.matchedId !== null)) return deny(PolicyRule.PreferUpdate);
  if (intent.creation?.kind !== 'node') return;
  if (intent.creation.nodeType === 'task' && !hasCommitment(intent, context, 'user_commitment')) return deny(PolicyRule.TaskCommitment);
  if (intent.creation.nodeType === 'dependency' && !hasCommitment(intent, context, 'external_commitment')) return deny(PolicyRule.ExternalWork);
}

function validEvidence(intent: PolicyIntent, context: PolicyContext): boolean {
  return Boolean(intent.evidenceRefs?.length) && intent.evidenceRefs!.every(ref => context.state.sources.some(source => source.id === ref.sourceId));
}

function protectedField(write: FieldWrite, state: WorkspaceState): boolean {
  const record = targetRecord(write.target, state);
  return Boolean(record && 'protectedFields' in record && (record.protectedFields as string[]).includes(write.field));
}

function hasCommitment(intent: PolicyIntent, context: PolicyContext, predicate: string): boolean {
  const assertion = context.state.assertions.find(assertion => assertion.id === intent.commitmentAssertionId);
  if (!assertion || assertion.predicate !== predicate || assertion.certainty !== 'explicit'
    || !['pending', 'applied'].includes(assertion.status) || assertion.target.kind !== 'node' || assertion.target.id !== intent.creation?.id) return false;
  if (!assertion.evidenceRefs.length || !assertion.evidenceRefs.every(ref => intent.evidenceRefs?.some(evidence => evidence.sourceId === ref.sourceId))) return false;
  const value = assertion.value as { speakerEntityId?: unknown; unambiguous?: unknown } | null;
  if (!value || typeof value.speakerEntityId !== 'string' || value.unambiguous !== true) return false;
  return predicate === 'user_commitment' ? value.speakerEntityId === context.userEntityId
    : value.speakerEntityId !== context.userEntityId && context.state.entities.some(entity => entity.id === value.speakerEntityId);
}

function rejectedSuggestion(intent: PolicyIntent, context: PolicyContext): boolean {
  return context.state.rejections.some(rejection => {
    if (rejection.signature !== intent.suggestionSignature) return false;
    if (!rejection.untilNewEvidence) return true;
    const rejectedAt = Date.parse(rejection.rejectedAt);
    return !intent.evidenceRefs?.some(ref => {
      const source = context.state.sources.find(source => source.id === ref.sourceId);
      return source?.happenedAt && Date.parse(source.happenedAt) > rejectedAt;
    });
  });
}

function mcpScopeAllows(intent: PolicyIntent, context: PolicyContext): boolean {
  const scope = context.mcp;
  if (!scope?.enabled || scope.readOnly) return false;
  const initiativeIds = new Set(intent.initiativeIds);
  for (const write of intent.writes) {
    const record = targetRecord(write.target, context.state);
    if (!record) return false;
    const initiativeId = write.target.kind === 'initiative' ? record.id : ('initiativeId' in record ? record.initiativeId : undefined);
    if (typeof initiativeId !== 'string') return false;
    initiativeIds.add(initiativeId);
  }
  // Portfolio-wide commands must not bypass an initiative/category restriction.
  if (initiativeIds.size === 0 && (scope.initiativeIds || scope.categoryIds)) return false;
  return [...initiativeIds].every(id => {
    if (scope.initiativeIds && !scope.initiativeIds.includes(id)) return false;
    if (!scope.categoryIds) return true;
    const initiative = context.state.initiatives.find(initiative => initiative.id === id);
    return Boolean(initiative?.categoryIds.some(category => scope.categoryIds!.includes(category)));
  });
}

function targetRecord(target: Target, state: WorkspaceState) {
  const records = { initiative: state.initiatives, node: state.nodes, edge: state.edges }[target.kind];
  return records.find(record => record.id === target.id);
}
