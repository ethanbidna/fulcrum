import type { Entity } from '@fulcrum/schema';
import type { EntityResolution, Mention } from './interfaces.js';
export const normalizeIdentity = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
export function liveEntity(id: string, entities: Map<string, Entity>): Entity | undefined {
  const visited = new Set<string>();
  let entity = entities.get(id);
  while (entity?.mergedInto) {
    if (visited.has(entity.id)) return;
    visited.add(entity.id); entity = entities.get(entity.mergedInto);
  }
  return entity;
}
export function resolution(mention: Mention, matches: string[], entities: Map<string, Entity>): EntityResolution {
  const candidates = new Map<string, Entity>();
  for (const id of matches) {
    const entity = liveEntity(id, entities);
    if (entity && (!mention.type || mention.type === entity.type)) candidates.set(entity.id, entity);
  }
  const sorted = [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!sorted.length) return { mention, status: 'unresolved' };
  if (sorted.length === 1) return { mention, status: 'resolved', entityId: sorted[0]!.id };
  return { mention, status: 'ambiguous', candidateIds: sorted.map(entity => entity.id), candidates: sorted };
}
