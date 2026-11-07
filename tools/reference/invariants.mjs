// Reference graph/domain invariant checker over a state document.
// Codes are the contract (docs/DOMAIN_COMMANDS.md#invariants); the core package must emit the same codes.

const CROSS_INITIATIVE_EDGE_TYPES = new Set(['depends_on', 'related_to']);

export function checkInvariants(state) {
  const violations = [];
  const fail = (code, id, detail) => violations.push({ code, id, ...(detail ? { detail } : {}) });
  const initiatives = indexById(state.initiatives);
  const nodes = indexById(state.nodes);
  const edges = indexById(state.edges);
  const groups = indexById(state.groups);
  const sources = indexById(state.sources);

  checkUniqueIds(state, fail);
  for (const node of state.nodes) checkNode(node, initiatives, groups, fail);
  for (const edge of state.edges) checkEdge(edge, nodes, fail);
  checkContainsForest(state.edges, fail);
  checkAcyclic(state.edges.filter(e => e.type === 'depends_on'), 'DEPENDS_ON_CYCLE', fail);
  for (const q of state.questions) checkTarget(q.target, q.initiativeId, initiatives, nodes, edges, 'QUESTION_TARGET_INVALID', q.id, fail);
  for (const a of state.assertions) checkTarget(a.target, null, initiatives, nodes, edges, 'ASSERTION_TARGET_INVALID', a.id, fail);
  checkEvidenceRefs(state, sources, fail);
  return violations;
}

function indexById(records = []) {
  return new Map(records.map(r => [r.id, r]));
}

function checkUniqueIds(state, fail) {
  const seen = new Set();
  const collections = ['initiatives', 'categories', 'nodes', 'edges', 'groups', 'objectives', 'entities', 'sources', 'assertions', 'questions'];
  for (const c of collections) {
    for (const r of state[c] ?? []) {
      if (seen.has(r.id)) fail('DUPLICATE_ID', r.id);
      seen.add(r.id);
    }
  }
}

function checkNode(node, initiatives, groups, fail) {
  if (!initiatives.has(node.initiativeId)) fail('NODE_INITIATIVE_MISSING', node.id);
  if (node.groupId && groups.get(node.groupId)?.initiativeId !== node.initiativeId) fail('GROUP_OUTSIDE_INITIATIVE', node.id);
  if (node.type === 'decision' && node.outcome && !node.options.some(o => o.id === node.outcome)) fail('DECISION_OUTCOME_UNKNOWN', node.id);
  if (node.type === 'decision' && node.state === 'decided' && !node.outcome) fail('DECISION_OUTCOME_MISSING', node.id);
}

function checkEdge(edge, nodes, fail) {
  const from = nodes.get(edge.fromId);
  const to = nodes.get(edge.toId);
  if (!from || !to) return fail('EDGE_ENDPOINT_MISSING', edge.id);
  if (edge.fromId === edge.toId) fail('EDGE_SELF_LOOP', edge.id);
  if (edge.initiativeId !== from.initiativeId) fail('EDGE_HOME_INITIATIVE_MISMATCH', edge.id);
  if (from.initiativeId !== to.initiativeId && !CROSS_INITIATIVE_EDGE_TYPES.has(edge.type)) fail('EDGE_CROSS_INITIATIVE_FORBIDDEN', edge.id);
  if (edge.type === 'contains' && (from.type !== 'task' || to.type !== 'task')) fail('CONTAINS_REQUIRES_TASKS', edge.id);
  if (edge.condition) checkCondition(edge, from, fail);
  if (edge.prerequisiteGroupId) checkPrerequisiteGroup(edge, from, fail);
}

function checkCondition(edge, from, fail) {
  if (edge.type !== 'leads_to' || from.type !== 'decision') return fail('CONDITION_REQUIRES_DECISION_LEADS_TO', edge.id);
  if (!from.options.some(o => o.id === edge.condition.optionId)) fail('CONDITION_UNKNOWN_OPTION', edge.id);
}

function checkPrerequisiteGroup(edge, from, fail) {
  if (edge.type !== 'depends_on') return fail('PREREQUISITE_GROUP_REQUIRES_DEPENDS_ON', edge.id);
  if (!(from.prerequisiteGroups ?? []).some(g => g.id === edge.prerequisiteGroupId)) fail('PREREQUISITE_GROUP_UNKNOWN', edge.id);
}

// contains must form a forest: one parent per child, no cycles. This is what keeps
// "focused view" a filter over one graph rather than a nested graph.
function checkContainsForest(edges, fail) {
  const containsEdges = edges.filter(e => e.type === 'contains');
  const parents = new Map();
  for (const e of containsEdges) {
    if (parents.has(e.toId)) fail('CONTAINS_MULTIPLE_PARENTS', e.toId);
    parents.set(e.toId, e.fromId);
  }
  checkAcyclic(containsEdges, 'CONTAINS_CYCLE', fail);
}

function checkAcyclic(edges, code, fail) {
  const adjacency = new Map();
  for (const e of edges) {
    if (!adjacency.has(e.fromId)) adjacency.set(e.fromId, []);
    adjacency.get(e.fromId).push(e.toId);
  }
  const VISITING = 1, DONE = 2;
  const mark = new Map();
  const visit = id => {
    if (mark.get(id) === DONE) return false;
    if (mark.get(id) === VISITING) return true;
    mark.set(id, VISITING);
    const cyclic = (adjacency.get(id) ?? []).some(visit);
    mark.set(id, DONE);
    return cyclic;
  };
  for (const id of adjacency.keys()) {
    if (visit(id)) { fail(code, id); return; }
  }
}

function checkTarget(target, initiativeId, initiatives, nodes, edges, code, id, fail) {
  const lookup = { initiative: initiatives, node: nodes, edge: edges }[target.kind];
  const record = lookup.get(target.id);
  if (!record) return fail(code, id, 'target missing');
  if (!initiativeId) return;
  const owner = target.kind === 'initiative' ? record.id : record.initiativeId;
  if (owner !== initiativeId) fail(code, id, 'target belongs to another initiative');
}

function checkEvidenceRefs(state, sources, fail) {
  const holders = [...state.initiatives, ...state.nodes, ...state.edges, ...state.assertions, ...state.questions];
  for (const h of holders) {
    for (const ref of h.evidenceRefs ?? []) {
      if (!sources.has(ref.sourceId)) fail('EVIDENCE_SOURCE_MISSING', h.id, ref.sourceId);
    }
  }
}
