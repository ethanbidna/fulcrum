// Reference projection: the single "meaningful state" shown on a portfolio card.
// Deterministic over typed state; no model call, no prose generation.
// See docs/DATA_MODEL.md#derived-state.

export const CardState = Object.freeze({
  NextAction: 'next_action',
  Waiting: 'waiting',
  Blocked: 'blocked',
  Unclear: 'unclear',
});

const SATISFIED_STATES = {
  task: new Set(['done', 'cancelled']),
  dependency: new Set(['satisfied', 'cancelled']),
  decision: new Set(['decided', 'cancelled']),
  milestone: new Set(['achieved', 'missed', 'cancelled']),
};
const OPEN_STATES = {
  task: new Set(['open']),
  decision: new Set(['open']),
};
const BLOCKING_DEPENDENCY_STATES = new Set(['blocked', 'expired']);
const WAITING_DEPENDENCY_STATES = new Set(['waiting', 'unverified']);

export function isSatisfied(node) {
  return node.supersededBy !== undefined || SATISFIED_STATES[node.type].has(node.state);
}

export function buildGraph(state, initiativeId) {
  const nodes = new Map(state.nodes.filter(n => n.initiativeId === initiativeId).map(n => [n.id, n]));
  const allNodes = new Map(state.nodes.map(n => [n.id, n]));
  const edges = state.edges.filter(e => nodes.has(e.fromId));
  return { nodes, allNodes, edges };
}

// AND across ungrouped prerequisites and across groups; within a group, mode decides.
export function prerequisitesMet(node, graph) {
  const incoming = graph.edges.filter(e => e.type === 'depends_on' && e.fromId === node.id);
  const ungrouped = incoming.filter(e => !e.prerequisiteGroupId);
  if (!ungrouped.every(e => isSatisfied(graph.allNodes.get(e.toId)))) return false;
  return (node.prerequisiteGroups ?? []).every(group => {
    const members = incoming.filter(e => e.prerequisiteGroupId === group.id).map(e => graph.allNodes.get(e.toId));
    if (members.length === 0) return true;
    return group.mode === 'all' ? members.every(isSatisfied) : members.some(isSatisfied);
  });
}

function routeIsTaken(edge, graph) {
  const source = graph.allNodes.get(edge.fromId);
  if (!isSatisfied(source)) return false;
  return !edge.condition || source.outcome === edge.condition.optionId;
}

function routeIsDead(edge, graph) {
  const source = graph.allNodes.get(edge.fromId);
  return Boolean(edge.condition) && source.state === 'decided' && source.outcome !== edge.condition.optionId;
}

// Incoming leads_to routes form an implicit ANY join: a node is reached once one
// live route's source is satisfied. Nodes with no incoming route are reached.
export function isReached(node, graph) {
  const routesIn = graph.edges.filter(e => e.type === 'leads_to' && e.toId === node.id);
  return routesIn.length === 0 || routesIn.some(e => routeIsTaken(e, graph));
}

// Skipped = every incoming route is a conditional route the decision did not take.
export function isSkipped(node, graph) {
  const routesIn = graph.edges.filter(e => e.type === 'leads_to' && e.toId === node.id);
  return routesIn.length > 0 && routesIn.every(e => routeIsDead(e, graph));
}

export function isOnLivePath(node, graph) {
  return !isSkipped(node, graph);
}

function hasOpenChildren(node, graph) {
  return graph.edges.some(e => e.type === 'contains' && e.fromId === node.id && !isSatisfied(graph.allNodes.get(e.toId)));
}

function isUserActionable(node, graph) {
  if (!OPEN_STATES[node.type]?.has(node.state)) return false;
  if (node.type === 'decision' && node.decider !== 'user') return false;
  if (node.supersededBy) return false;
  return prerequisitesMet(node, graph) && isReached(node, graph) && !hasOpenChildren(node, graph);
}

function byRankThenDate(a, b) {
  const rank = (a.manualRank ?? '~').localeCompare(b.manualRank ?? '~');
  if (rank !== 0) return rank;
  return (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.createdAt.localeCompare(b.createdAt);
}

// Dependencies that actually gate an unsatisfied node on the live path.
function gatingDependencies(graph, states) {
  const gating = new Set(graph.edges
    .filter(e => e.type === 'depends_on')
    .filter(e => { const from = graph.nodes.get(e.fromId); return from && !isSatisfied(from) && isOnLivePath(from, graph); })
    .map(e => e.toId));
  return [...gating].map(id => graph.allNodes.get(id)).filter(n => n.type === 'dependency' && states.has(n.state)).sort(byRankThenDate);
}

export function deriveCardState(state, initiativeId) {
  const graph = buildGraph(state, initiativeId);
  const actionable = [...graph.nodes.values()].filter(n => isUserActionable(n, graph)).sort(byRankThenDate);
  if (actionable.length > 0) return { kind: CardState.NextAction, nodeId: actionable[0].id, title: actionable[0].title };
  const blocked = gatingDependencies(graph, BLOCKING_DEPENDENCY_STATES);
  if (blocked.length > 0) return { kind: CardState.Blocked, nodeId: blocked[0].id, title: blocked[0].title };
  const waiting = gatingDependencies(graph, WAITING_DEPENDENCY_STATES);
  if (waiting.length > 0) return { kind: CardState.Waiting, nodeId: waiting[0].id, title: waiting[0].title };
  return { kind: CardState.Unclear };
}

// All of the user's currently actionable Tasks/Decisions across active initiatives (rail: "Your next available actions").
export function nextAvailableActions(state) {
  return state.initiatives
    .filter(i => i.lifecycle === 'active')
    .flatMap(i => {
      const graph = buildGraph(state, i.id);
      return [...graph.nodes.values()].filter(n => isUserActionable(n, graph)).map(n => ({ initiativeId: i.id, nodeId: n.id }));
    });
}
