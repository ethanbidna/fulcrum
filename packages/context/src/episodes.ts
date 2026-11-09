import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { ContextRecord, Episode } from './interfaces.js';
export async function* snapshotEpisodes(snapshot: WorkspaceStateDoc): AsyncIterable<Episode> {
  for (const record of snapshot.state.entities) yield { kind: 'entity', record };
  for (const record of snapshot.state.sources) yield { kind: 'source', record };
  for (const record of snapshot.state.assertions) yield { kind: 'assertion', record };
  for (const kind of ['initiative', 'node', 'edge'] as const) {
    const records = kind === 'initiative' ? snapshot.state.initiatives : kind === 'node' ? snapshot.state.nodes : snapshot.state.edges;
    for (const record of records) {
      const entityIds: string[] = [];
      if ('teamEntityId' in record && typeof record.teamEntityId === 'string') entityIds.push(record.teamEntityId);
      if ('responsibleEntityId' in record && typeof record.responsibleEntityId === 'string') entityIds.push(record.responsibleEntityId);
      if ('decider' in record && typeof record.decider === 'string' && record.decider !== 'user') entityIds.push(record.decider);
      const context: ContextRecord = { target: { kind, id: record.id }, title: 'title' in record ? record.title : record.label ?? '',
        initiativeId: 'initiativeId' in record ? record.initiativeId : record.id, entityIds, evidenceRefs: record.evidenceRefs ?? [] };
      yield { kind: 'target', record: context };
    }
  }
}
