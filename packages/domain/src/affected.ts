import type { WorkspaceState } from './types.js';
import { checkInvariants, checkUniqueIds } from './invariants.js';

// Include both snapshots so deletions and moved references retain their dependants.
export function checkAffectedInvariants(before: WorkspaceState, after: WorkspaceState, changedIds: string[]) {
  const affected = new Set(changedIds);
  const records = [...relationalRecords(before), ...relationalRecords(after)];
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const record of records) {
      if (!record.ids.some(id => affected.has(id))) continue;
      for (const id of record.ids) {
        if (affected.has(id)) continue;
        affected.add(id);
        expanded = true;
      }
    }
  }
  const scoped = { ...after };
  for (const collection of ['initiatives', 'nodes', 'edges', 'groups', 'assertions', 'questions', 'objectives'] as const) {
    // Filtering preserves each collection's generated record type.
    Object.assign(scoped, { [collection]: after[collection].filter(record => affected.has(record.id)) });
  }
  const local = checkInvariants(scoped).filter(violation => violation.code !== 'DUPLICATE_ID');
  // IDs remain workspace-wide even when graph validation is scoped.
  const duplicates: ReturnType<typeof checkInvariants> = [];
  checkUniqueIds(after, (code, id) => {
    if (affected.has(id)) duplicates.push({ code, id });
  });
  return [...duplicates, ...local];
}

function relationalRecords(state: WorkspaceState): { ids: string[] }[] {
  return [
    ...state.nodes.map(node => ({ ids: [node.id, node.initiativeId, ...(node.groupId ? [node.groupId] : [])] })),
    ...state.edges.map(edge => ({ ids: [edge.id, edge.initiativeId, edge.fromId, edge.toId] })),
    ...state.groups.map(group => ({ ids: [group.id, group.initiativeId] })),
    ...state.questions.map(question => ({ ids: [question.id, question.initiativeId, question.target.id] })),
    ...state.assertions.map(assertion => ({ ids: [assertion.id, assertion.target.id] })),
    ...[...state.initiatives, ...state.nodes, ...state.edges, ...state.assertions, ...state.questions, ...state.objectives]
      .map(record => ({ ids: [record.id, ...(record.evidenceRefs ?? []).map(ref => ref.sourceId)] })),
  ];
}
