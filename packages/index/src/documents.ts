import type { WorkspaceStateDoc, Target } from '@fulcrum/schema';
import type { SearchKind } from './interfaces.js';
export interface SearchDocument { key: string; kind: SearchKind; id: string; title: string; body: string; initiativeIds: string[] }
export function projectDocuments(snapshot: WorkspaceStateDoc): SearchDocument[] {
  const state = snapshot.state; const result: SearchDocument[] = [];
  const sourceScopes = new Map<string, Set<string>>(); const entityScopes = new Map<string, Set<string>>();
  const owner = (target: Target) => target.kind === 'initiative' ? target.id : (target.kind === 'node' ? state.nodes : state.edges).find(record => record.id === target.id)?.initiativeId;
  const addScope = (map: Map<string, Set<string>>, id: string | undefined, initiativeId: string | undefined) => {
    if (!id || !initiativeId) return; const values = map.get(id) ?? new Set<string>(); values.add(initiativeId); map.set(id, values);
  };
  for (const record of [...state.initiatives, ...state.nodes, ...state.edges, ...state.questions, ...state.assertions]) {
    const initiativeId = 'initiativeId' in record ? record.initiativeId : 'target' in record ? owner(record.target) : record.id;
    for (const ref of record.evidenceRefs ?? []) addScope(sourceScopes, ref.sourceId, initiativeId);
    if ('teamEntityId' in record && typeof record.teamEntityId === 'string') addScope(entityScopes, record.teamEntityId, initiativeId);
    if ('responsibleEntityId' in record && typeof record.responsibleEntityId === 'string') addScope(entityScopes, record.responsibleEntityId, initiativeId);
    if ('decider' in record && typeof record.decider === 'string' && record.decider !== 'user') addScope(entityScopes, record.decider, initiativeId);
  }
  for (const initiative of state.initiatives) for (const link of initiative.objectiveLinks ?? []) {
    const objective = state.objectives.find(objective => objective.id === link.objectiveId);
    for (const ref of [...(objective?.evidenceRefs ?? []), ...(link.evidenceRefs ?? [])]) addScope(sourceScopes, ref.sourceId, initiative.id);
  }
  for (const source of state.sources) for (const initiativeId of sourceScopes.get(source.id) ?? []) addScope(entityScopes, source.senderEntityId, initiativeId);
  const add = (kind: SearchKind, id: string, title: string, body: string, initiativeIds: Iterable<string>) => {
    result.push({ key: `${kind}:${id}`, kind, id, title, body, initiativeIds: [...new Set(initiativeIds)].sort() });
  };
  for (const initiative of state.initiatives) add('initiative', initiative.id, initiative.title, initiative.description ?? '', [initiative.id]);
  for (const node of state.nodes) add('node', node.id, node.title, node.details ?? '', [node.initiativeId]);
  for (const entity of state.entities) add('entity', entity.id, entity.label, [...entity.aliases, ...(entity.externalIds ?? []).map(id => id.remoteId)].join(' '), entityScopes.get(entity.id) ?? []);
  for (const source of state.sources) add('source', source.id, source.title ?? 'Source', source.cachePolicy === 'excerpt' ? source.excerpt ?? '' : '', sourceScopes.get(source.id) ?? []);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
