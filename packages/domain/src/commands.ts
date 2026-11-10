import type { Actor, ChangeEvent, CommandInvocation, EvidenceRef, Op, RecordKind, WorkspaceStateDoc } from '@fulcrum/schema';
import type { ReadIndex } from '@fulcrum/index/interfaces';
import type { PolicyContext } from './policy.js';

export const COMMAND_ARGUMENTS = {
  'command.apply': ['commands'],
  'initiative.create': ['record'], 'initiative.propose': ['record'], 'initiative.approve': ['id'], 'initiative.reject': ['id'],
  'initiative.update': ['id', 'patch'], 'initiative.setMoscow': ['id', 'moscow'], 'initiative.setLifecycle': ['id', 'lifecycle'],
  'initiative.setCategories': ['id', 'categoryIds'], 'initiative.rank': ['id', 'manualRank'], 'initiative.rerank': ['ranks'],
  'category.create': ['record'], 'category.rename': ['id', 'label'], 'category.rank': ['id', 'manualRank'], 'category.delete': ['id'],
  'node.create': ['record'], 'node.update': ['id', 'patch'], 'node.setState': ['id', 'state'], 'node.setGroup': ['id', 'groupId'],
  'node.setPrerequisiteGroups': ['id', 'prerequisiteGroups'], 'node.supersede': ['id', 'supersededBy'], 'node.delete': ['id'],
  'decision.decide': ['id', 'outcome'], 'edge.create': ['record'], 'edge.update': ['id', 'patch'], 'edge.delete': ['id'],
  'group.create': ['record'], 'group.rename': ['id', 'label'], 'group.delete': ['id'], 'source.record': ['record'],
  'assertion.record': ['record'], 'assertion.reject': ['id'], 'assertion.setStatus': ['id', 'status', 'supersededBy'], 'evidence.attach': ['target', 'evidenceRef'], 'evidence.detach': ['target', 'sourceId'],
  'entity.create': ['record'], 'entity.update': ['id', 'patch'], 'entity.addAlias': ['id', 'alias'],
  'entity.merge': ['id', 'intoId'], 'entity.split': ['id', 'record', 'aliases'],
  'objective.create': ['record'], 'objective.update': ['id', 'patch'], 'objective.rerank': ['ranks'], 'objective.delete': ['id'],
  'alignment.set': ['initiativeId', 'objectiveId', 'alignment'], 'question.raise': ['record'],
  'sync.chooseValue': ['target', 'field', 'value', 'baseEventId'],
  'question.resolve': ['id', 'resolutionId'], 'question.defer': ['id', 'deferredUntil'], 'question.markObsolete': ['id'],
  'field.protect': ['target', 'field'], 'field.unprotect': ['target', 'field'], 'suggestion.reject': ['signature', 'untilNewEvidence'],
  'change.undo': ['eventId'], 'run.undo': ['runId'], 'device.register': ['record'],
  'settings.setIngestionDevice': ['ingestionDeviceId'], 'settings.setDefaultCachePolicy': ['defaultCachePolicy'],
} as const;
export type CommandName = keyof typeof COMMAND_ARGUMENTS;
export interface CommandEnvelope {
  name: CommandName;
  args: Record<string, unknown>;
  actor: Actor;
  idempotencyKey?: string;
  evidenceRefs?: EvidenceRef[];
  runId?: string;
  reason?: string;
  baseEventIds?: Record<string, string | null>;
}
export type ErrorCode = 'VALIDATION_FAILED' | 'INVARIANT_VIOLATION' | 'POLICY_DENIED' | 'PROTECTED_FIELD' | 'NOT_FOUND' | 'STALE_BASE' | 'WORKSPACE_READ_ONLY' | 'INDEX_UNAVAILABLE';
export interface DomainError { code: ErrorCode; message: string; details?: unknown }
export type CommandResult = { ok: true; eventId: string; ops: Op[]; raisedQuestionIds: string[]; suggestedAssertionIds: string[] } | { ok: false; error: DomainError };
export type EventDraft = Omit<ChangeEvent, 'seq' | 'hlc'>;
export interface AppliedChange { eventId: string; actor: Actor; ops: Op[]; raisedQuestionIds: string[] }

export interface DomainPorts {
  newId(): string;
  questionId?(dedupeKey: string): string;
  now(): string;
  // The driver assigns causal HLC/sequence and acknowledges only durable, atomic appends.
  commit(drafts: EventDraft[]): Promise<ChangeEvent[]>;
  validateState(document: WorkspaceStateDoc): unknown[];
  validateEvent(event: ChangeEvent): unknown[];
  deviceId: string;
  userEntityId: string;
  readOnly?: boolean;
  readIndex?: Pick<ReadIndex, 'search' | 'status'>;
  mcp?: PolicyContext['mcp'];
  reconciliationProof?(command: CommandInvocation): {
    match?: PolicyContext['match'];
    commitmentAssertion?: WorkspaceStateDoc['state']['assertions'][number];
  };
}
export const COLLECTIONS = {
  initiative: 'initiatives', category: 'categories', node: 'nodes', edge: 'edges', group: 'groups', objective: 'objectives',
  entity: 'entities', source: 'sources', assertion: 'assertions', question: 'questions', rejection: 'rejections', device: 'devices',
} as const;
export type DataRecord = Record<string, unknown>;
export function recordKey(kind: RecordKind, id: string) { return `${kind}:${id}`; }
export function writerKey(kind: RecordKind, id: string, field: string) { return `${recordKey(kind, id)}:${field}`; }
export class DomainFault extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) { super(message); }
}
export function object(value: unknown): DataRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainFault('VALIDATION_FAILED', 'Expected an object');
  return value as DataRecord;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new DomainFault('VALIDATION_FAILED', 'Expected a nonempty string');
  return value;
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function validateInvocation(value: unknown): CommandInvocation & { name: CommandName } {
  const command = object(value);
  const name = text(command.name);
  if (!Object.hasOwn(COMMAND_ARGUMENTS, name)) throw new DomainFault('VALIDATION_FAILED', 'Unknown command');
  const args = object(command.args);
  const keys: readonly string[] = COMMAND_ARGUMENTS[name as CommandName];
  if (Object.keys(args).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(args, key))) {
    throw new DomainFault('VALIDATION_FAILED', 'Command arguments do not match the catalog', { command: name, fields: keys });
  }
  return { name: name as CommandName, args };
}
export function suggestionSignature(command: CommandInvocation): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return `command:v1:${JSON.stringify(canonical(command))}`;
}
