import type { Actor, CommandInvocation, RecordKind, Target } from '@fulcrum/schema';
import type { CommandName, DataRecord } from './commands.js';
import { DomainFault, object, text, validateInvocation } from './commands.js';
import { Transaction } from './transaction.js';

const PATCH_FIELDS: Partial<Record<CommandName, readonly string[]>> = {
  'initiative.update': ['title', 'description', 'targetDate', 'teamEntityId'],
  'node.update': ['title', 'details', 'targetDate', 'kind', 'responsibleEntityId', 'decider', 'options'],
  'edge.update': ['label', 'condition', 'prerequisiteGroupId'],
  'entity.update': ['label', 'aliases', 'externalIds', 'type'],
  'objective.update': ['label', 'weight', 'kpi'],
};
const SET_FIELDS: Partial<Record<CommandName, string>> = {
  'initiative.setMoscow': 'moscow', 'initiative.setLifecycle': 'lifecycle', 'initiative.setCategories': 'categoryIds',
  'initiative.rank': 'manualRank', 'category.rename': 'label', 'category.rank': 'manualRank', 'group.rename': 'label',
  'node.setState': 'state', 'node.setGroup': 'groupId', 'node.setPrerequisiteGroups': 'prerequisiteGroups',
  'node.supersede': 'supersededBy', 'question.defer': 'deferredUntil',
};
export interface HandlerContext {
  actor: Actor;
  now: string;
  apply(command: CommandInvocation): void;
}
export function handleCommand(tx: Transaction, command: CommandInvocation, context: HandlerContext) {
  const { name, args } = validateInvocation(command);
  const area = name.split('.')[0] as RecordKind;
  if (name.endsWith('.create') || name === 'initiative.propose' || name === 'device.register') {
    return createRecord(tx, area, args.record, context, name);
  }
  if (PATCH_FIELDS[name]) return patchRecord(tx, area, text(args.id), object(args.patch), PATCH_FIELDS[name]!);
  const field = SET_FIELDS[name];
  if (field) {
    tx.set(area, text(args.id), field, args[field]);
    if (name === 'question.defer') tx.set('question', text(args.id), 'state', 'deferred');
    return;
  }
  switch (name) {
    case 'initiative.approve': return tx.set('initiative', text(args.id), 'lifecycle', 'active');
    case 'initiative.reject': return tx.set('initiative', text(args.id), 'lifecycle', 'rejected');
    case 'decision.decide': return decide(tx, args);
    case 'node.delete': return deleteNode(tx, text(args.id));
    case 'edge.delete': return deleteEdgeReferences(tx, text(args.id));
    case 'group.delete': return deleteGroup(tx, text(args.id));
    case 'category.delete': return deleteCategory(tx, text(args.id));
    case 'source.record': return recordSource(tx, args.record, context);
    case 'assertion.record': return tx.create('assertion', { observedAt: context.now, ...object(args.record) });
    case 'assertion.setStatus': return setAssertionStatus(tx, args, context.actor);
    case 'assertion.reject': return tx.set('assertion', text(args.id), 'status', 'rejected');
    case 'evidence.attach': return evidence(tx, args, 'attach');
    case 'evidence.detach': return evidence(tx, args, 'detach');
    case 'entity.addAlias': return addAlias(tx, text(args.id), text(args.alias));
    case 'entity.merge': return mergeEntities(tx, text(args.id), text(args.intoId));
    case 'entity.split': return splitEntity(tx, args, context);
    case 'initiative.rerank': return rerankInitiatives(tx, args.ranks);
    case 'objective.rerank': return rerank(tx, args.ranks);
    case 'objective.delete': return deleteObjective(tx, text(args.id));
    case 'alignment.set': return setAlignment(tx, args, context.actor);
    case 'question.raise': return raiseQuestion(tx, args.record, context);
    case 'question.resolve': return resolveQuestion(tx, args, context);
    case 'question.markObsolete': return tx.set('question', text(args.id), 'state', 'obsolete');
    case 'field.protect': case 'field.unprotect': return protectField(tx, args, name === 'field.protect' ? 'protect' : 'unprotect');
    case 'suggestion.reject': return recordRejection(tx, args, context.now);
    case 'settings.setIngestionDevice': return tx.set('settings', 'singleton', 'ingestionDeviceId', args.ingestionDeviceId);
    case 'settings.setDefaultCachePolicy': return tx.set('settings', 'singleton', 'defaultCachePolicy', args.defaultCachePolicy);
    default: throw new DomainFault('VALIDATION_FAILED', 'Command requires the undo handler');
  }
}
function createRecord(tx: Transaction, kind: RecordKind, value: unknown, context: HandlerContext, name: string) {
  if (kind === 'settings') throw new DomainFault('VALIDATION_FAILED', 'Settings is a singleton');
  const record = { ...object(value) };
  if (['initiative', 'node', 'edge'].includes(kind)) {
    record.createdAt ??= context.now; record.updatedAt ??= context.now;
  }
  if (kind === 'initiative') {
    record.lifecycle = name === 'initiative.propose' ? 'proposed' : 'active';
    record.moscow ??= null; record.categoryIds ??= []; record.protectedFields ??= ['moscow'];
  }
  if (kind === 'node') record.protectedFields ??= [];
  tx.create(kind, record);
}
function patchRecord(tx: Transaction, kind: RecordKind, id: string, patch: DataRecord, allowed: readonly string[]) {
  if (!Object.keys(patch).length || Object.keys(patch).some(field => !allowed.includes(field))) throw new DomainFault('VALIDATION_FAILED', 'Unsupported patch field');
  for (const [field, value] of Object.entries(patch)) tx.set(kind, id, field, value);
}
function decide(tx: Transaction, args: DataRecord) {
  const id = text(args.id);
  if (tx.get('node', id).type !== 'decision') throw new DomainFault('VALIDATION_FAILED', 'Only a Decision has an outcome');
  tx.set('node', id, 'outcome', text(args.outcome)); tx.set('node', id, 'state', 'decided');
}
function deleteNode(tx: Transaction, id: string) {
  // References are removed in the same transaction; no dangling evidence targets.
  for (const edge of [...tx.list('edge')]) if (edge.fromId === id || edge.toId === id) deleteEdgeReferences(tx, text(edge.id));
  deleteAttachments(tx, id);
  tx.remove('node', id);
}
function deleteEdgeReferences(tx: Transaction, id: string) { deleteAttachments(tx, id); tx.remove('edge', id); }
function deleteAttachments(tx: Transaction, id: string) {
  for (const kind of ['assertion', 'question'] as const) for (const record of [...tx.list(kind)]) {
    if (object(record.target).id === id) tx.remove(kind, text(record.id));
  }
}
function deleteGroup(tx: Transaction, id: string) {
  for (const node of tx.list('node')) if (node.groupId === id) tx.set('node', text(node.id), 'groupId', null);
  tx.remove('group', id);
}
function deleteCategory(tx: Transaction, id: string) {
  for (const initiative of tx.list('initiative')) {
    const categories = initiative.categoryIds as string[];
    if (categories.includes(id)) tx.set('initiative', text(initiative.id), 'categoryIds', categories.filter(category => category !== id));
  }
  tx.remove('category', id);
}
function recordSource(tx: Transaction, value: unknown, context: HandlerContext) {
  const record = { ...object(value) }; record.ingestedAt ??= context.now;
  const existing = tx.list('source').find(source => source.connector === record.connector && source.remoteId === record.remoteId);
  if (!existing) return tx.create('source', record);
  for (const [field, value] of Object.entries(record)) if (field !== 'id') tx.set('source', text(existing.id), field, value);
}
function evidence(tx: Transaction, args: DataRecord, mode: 'attach' | 'detach') {
  const attach = mode === 'attach';
  const target = parseTarget(args.target); const record = tx.get(target.kind, target.id);
  const refs = (record.evidenceRefs ?? []) as { sourceId: string }[];
  const ref = attach ? object(args.evidenceRef) : null;
  if (ref) tx.get('source', text(ref.sourceId));
  const sourceId = attach ? text(ref!.sourceId) : text(args.sourceId);
  const next = refs.filter(ref => ref.sourceId !== sourceId);
  tx.set(target.kind, target.id, 'evidenceRefs', attach ? [...next, ref] : next);
}
function addAlias(tx: Transaction, id: string, alias: string) {
  const record = tx.get('entity', id);
  tx.set('entity', id, 'aliases', [...new Set([...(record.aliases as string[]), alias])]);
}
function mergeEntities(tx: Transaction, id: string, intoId: string) {
  if (id === intoId) throw new DomainFault('VALIDATION_FAILED', 'Cannot merge an entity into itself');
  const source = tx.get('entity', id); const target = tx.get('entity', intoId);
  if (source.mergedInto || target.mergedInto) throw new DomainFault('VALIDATION_FAILED', 'Resolve existing entity merges first');
  tx.set('entity', intoId, 'aliases', [...new Set([...(target.aliases as string[]), text(source.label), ...(source.aliases as string[])])]);
  const externalIds = [...(target.externalIds as unknown[] ?? []), ...(source.externalIds as unknown[] ?? [])];
  tx.set('entity', intoId, 'externalIds', [...new Map(externalIds.map(value => [JSON.stringify(value), value])).values()]);
  tx.set('entity', id, 'mergedInto', intoId);
  for (const kind of ['node', 'initiative', 'source'] as const) for (const record of tx.list(kind)) {
    for (const field of ['responsibleEntityId', 'decider', 'teamEntityId', 'senderEntityId']) if (record[field] === id) tx.set(kind, text(record.id), field, intoId);
  }
}
function splitEntity(tx: Transaction, args: DataRecord, context: HandlerContext) {
  const id = text(args.id); const entity = tx.get('entity', id);
  if (!Array.isArray(args.aliases) || !args.aliases.every(alias => typeof alias === 'string' && (entity.aliases as string[]).includes(alias))) {
    throw new DomainFault('VALIDATION_FAILED', 'Split aliases must belong to the original entity');
  }
  createRecord(tx, 'entity', { ...object(args.record), aliases: args.aliases }, context, 'entity.create');
  tx.set('entity', id, 'aliases', (entity.aliases as string[]).filter(alias => !(args.aliases as string[]).includes(alias)));
}
function rerank(tx: Transaction, value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new DomainFault('VALIDATION_FAILED', 'Expected objective ranks');
  const seen = new Set<string>();
  for (const item of value) {
    const entry = object(item); const id = text(entry.id);
    if (seen.has(id) || Object.keys(entry).some(key => !['id', 'rank'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Duplicate objective or unsupported rank field');
    seen.add(id); tx.set('objective', id, 'rank', entry.rank);
  }
}
function deleteObjective(tx: Transaction, id: string) {
  for (const initiative of tx.list('initiative')) {
    const links = (initiative.objectiveLinks ?? []) as { objectiveId: string }[];
    if (links.some(link => link.objectiveId === id)) tx.set('initiative', text(initiative.id), 'objectiveLinks', links.filter(link => link.objectiveId !== id));
  }
  tx.remove('objective', id);
}
function setAlignment(tx: Transaction, args: DataRecord, actor: Actor) {
  const id = text(args.initiativeId); const objectiveId = text(args.objectiveId); tx.get('objective', objectiveId);
  const links = (tx.get('initiative', id).objectiveLinks ?? []) as { objectiveId: string }[];
  tx.set('initiative', id, 'objectiveLinks', [...links.filter(link => link.objectiveId !== objectiveId), { objectiveId, alignment: args.alignment, setBy: actor }]);
}
function raiseQuestion(tx: Transaction, value: unknown, context: HandlerContext) {
  const question: DataRecord = { createdAt: context.now, state: 'open', ...object(value) };
  const existing = tx.list('question').find(q => q.dedupeKey === question.dedupeKey && ['open', 'deferred'].includes(text(q.state)));
  if (!existing) return tx.create('question', question);
  for (const [field, value] of Object.entries(question)) if (!['id', 'createdAt'].includes(field)) tx.set('question', text(existing.id), field, value);
}
function resolveQuestion(tx: Transaction, args: DataRecord, context: HandlerContext) {
  const id = text(args.id); const question = tx.get('question', id);
  if (!['open', 'deferred'].includes(text(question.state))) throw new DomainFault('VALIDATION_FAILED', 'Question is already closed');
  const resolution = (question.resolutions as DataRecord[]).find(resolution => resolution.id === args.resolutionId);
  if (!resolution) throw new DomainFault('NOT_FOUND', 'Question resolution not found');
  for (const command of resolution.commands as CommandInvocation[]) context.apply(command);
  tx.set('question', id, 'state', 'resolved'); tx.set('question', id, 'resolvedWith', args.resolutionId);
}
export function parseTarget(value: unknown): Target {
  const target = object(value);
  if (!['initiative', 'node', 'edge'].includes(text(target.kind)) || Object.keys(target).some(key => !['id', 'kind', 'field'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Unsupported target');
  return { kind: target.kind as Target['kind'], id: text(target.id) };
}
function protectField(tx: Transaction, args: DataRecord, mode: 'protect' | 'unprotect') {
  const protect = mode === 'protect';
  const target = parseTarget(args.target); const field = text(args.field); const record = tx.get(target.kind, target.id);
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field) || ['id', 'protectedFields', 'createdAt', 'updatedAt'].includes(field)) throw new DomainFault('VALIDATION_FAILED', 'Unsupported protected field');
  if ('protectedFields' in record) {
    const fields = (record.protectedFields as string[]).filter(item => item !== field);
    tx.set(target.kind, target.id, 'protectedFields', protect ? [...fields, field] : fields);
  }
}
export function recordRejection(tx: Transaction, args: DataRecord, now: string) {
  const signature = text(args.signature);
  if (typeof args.untilNewEvidence !== 'boolean') throw new DomainFault('VALIDATION_FAILED', 'Expected rejection lifetime');
  const existing = tx.list('rejection').find(record => record.signature === signature);
  if (existing) { tx.set('rejection', signature, 'rejectedAt', now); tx.set('rejection', signature, 'untilNewEvidence', args.untilNewEvidence); }
  else tx.create('rejection', { signature, rejectedAt: now, untilNewEvidence: args.untilNewEvidence });
}

function rerankInitiatives(tx: Transaction, value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new DomainFault('VALIDATION_FAILED', 'Expected initiative ranks');
  const seenIds = new Set<string>(); const seenRanks = new Set<string>();
  for (const item of value) {
    const entry = object(item); const id = text(entry.id); const rank = text(entry.manualRank);
    if (seenIds.has(id) || seenRanks.has(rank) || Object.keys(entry).some(key => !['id', 'manualRank'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Duplicate initiative, rank or unsupported field');
    if (tx.get('initiative', id).lifecycle !== 'active') throw new DomainFault('VALIDATION_FAILED', 'Only active initiatives can be reordered');
    seenIds.add(id); seenRanks.add(rank); tx.set('initiative', id, 'manualRank', rank);
  }
}

function setAssertionStatus(tx: Transaction, args: DataRecord, actor: Actor) {
  const id = text(args.id); const assertion = tx.get('assertion', id);
  if (actor === 'ai' && assertion.status === 'rejected') throw new DomainFault('POLICY_DENIED', 'Rejected evidence cannot be revived');
  if (!['conflicting', 'superseded'].includes(text(args.status))) throw new DomainFault('VALIDATION_FAILED', 'Unsupported assertion transition');
  if (args.status === 'superseded') validateSupersession(tx, assertion, text(args.supersededBy));
  else if (args.supersededBy !== null) throw new DomainFault('VALIDATION_FAILED', 'Conflicting claims cannot have a replacement');
  tx.set('assertion', id, 'status', args.status);
  tx.set('assertion', id, 'supersededBy', args.supersededBy);
}

function validateSupersession(tx: Transaction, assertion: DataRecord, replacementId: string) {
  const replacement = tx.get('assertion', replacementId);
  const originalTarget = object(assertion.target); const replacementTarget = object(replacement.target);
  const sameTarget = ['kind', 'id', 'field'].every(field => originalTarget[field] === replacementTarget[field]);
  if (!sameTarget || replacement.predicate !== assertion.predicate || replacement.status === 'rejected') throw new DomainFault('VALIDATION_FAILED', 'Supersession requires another claim about the same field');
  const visited = new Set<string>([text(assertion.id)]);
  let currentId: string | undefined = replacementId;
  while (currentId) {
    if (visited.has(currentId)) throw new DomainFault('VALIDATION_FAILED', 'Assertion supersession cannot cycle');
    visited.add(currentId);
    const next: unknown = tx.get('assertion', currentId).supersededBy;
    currentId = next ? text(next) : undefined;
  }
}
