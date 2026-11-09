import type { Assertion, Source } from '@fulcrum/schema';
import type { ContextTarget, RelatedContext } from './interfaces.js';
import { liveEntity } from './identity.js';
const targetKey = (target: { kind: string; id: string }) => `${target.kind}:${target.id}`;
export function selectRelated(all: RelatedContext, target: ContextTarget, matchedKeys: Set<string>, limit: number): RelatedContext {
  const entities = new Map(all.entities.map(entity => [entity.id, entity]));
  const entityId = target.kind === 'entity' ? liveEntity(target.id, entities)?.id : undefined;
  const relatedEntityIds = new Set<string>(entityId ? [entityId] : []);
  if (target.kind === 'text') for (const entity of all.entities) if (matchedKeys.has(`entity:${entity.id}`)) {
    const live = liveEntity(entity.id, entities); if (live) relatedEntityIds.add(live.id);
  }
  const isEntity = (id: string | undefined) => !!id && relatedEntityIds.has(liveEntity(id, entities)?.id ?? '');
  const targets = all.targets.filter(record => target.kind === 'text' ? (matchedKeys.has(`target:${targetKey(record.target)}`) || record.entityIds.some(isEntity))
    : target.kind === 'entity' ? record.entityIds.some(isEntity) : targetKey(record.target) === targetKey(target));
  const targetKeys = new Set(targets.map(record => targetKey(record.target)));
  // Initiative context includes its graph without inventing a second graph.
  if (target.kind === 'initiative') for (const record of all.targets) if (record.initiativeId === target.id) { targetKeys.add(targetKey(record.target)); if (!targets.includes(record)) targets.push(record); }
  const directSources = all.sources.filter(source => target.kind === 'text' ? (matchedKeys.has(`source:${source.id}`) || isEntity(source.senderEntityId)) : isEntity(source.senderEntityId));
  const sourceIds = new Set(directSources.map(source => source.id));
  for (const record of targets) for (const ref of record.evidenceRefs) sourceIds.add(ref.sourceId);
  const assertions = all.assertions.filter(assertion => targetKeys.has(targetKey(assertion.target)) || ((target.kind === 'text' || target.kind === 'entity') && assertion.evidenceRefs.some(ref => sourceIds.has(ref.sourceId))));
  assertions.sort((a, b) => assertionTime(b, all.sources) - assertionTime(a, all.sources) || Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id));
  const selectedAssertions = assertions.slice(0, limit);
  for (const assertion of selectedAssertions) for (const ref of assertion.evidenceRefs) sourceIds.add(ref.sourceId);
  const sources = all.sources.filter(source => sourceIds.has(source.id)).sort((a, b) => Date.parse(b.happenedAt ?? b.ingestedAt) - Date.parse(a.happenedAt ?? a.ingestedAt) || a.id.localeCompare(b.id)).slice(0, limit);
  const entityIds = new Set(relatedEntityIds);
  for (const record of targets) for (const id of record.entityIds) { const entity = liveEntity(id, entities); if (entity) entityIds.add(entity.id); }
  for (const source of sources) { const entity = source.senderEntityId && liveEntity(source.senderEntityId, entities); if (entity) entityIds.add(entity.id); }
  return { targets: targets.slice(0, limit), assertions: selectedAssertions, sources, entities: [...entityIds].sort().slice(0, limit).map(id => entities.get(id)!) };
}
function assertionTime(assertion: Assertion, sources: Source[]): number {
  const times = assertion.evidenceRefs.flatMap(ref => {
    const happenedAt = sources.find(source => source.id === ref.sourceId)?.happenedAt;
    return happenedAt ? [Date.parse(happenedAt)] : [];
  });
  return times.length ? Math.max(...times) : Date.parse(assertion.observedAt);
}
export function emptyContext(): RelatedContext { return { entities: [], targets: [], sources: [], assertions: [] }; }
