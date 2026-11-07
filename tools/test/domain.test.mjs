import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../reference/schemas.mjs';
import { checkInvariants } from '../reference/invariants.mjs';
import { deriveCardState, buildGraph, isSkipped, isReached, nextAvailableActions } from '../reference/card-state.mjs';

const expectations = readJson('fixtures/scenarios/expectations.json');
const load = () => structuredClone(readJson(expectations.portfolio.fixture).state);
const codes = state => checkInvariants(state).map(v => v.code);
const ids = { vendor: '01000000-0000-7000-8000-000000000001', retention: '01000000-0000-7000-8000-000000000003' };
const node = (state, id) => state.nodes.find(n => n.id === id);
const edgeTemplate = (state, overrides) => ({ ...state.edges[0], id: '03000000-0000-7000-8000-000000000999', ...overrides });

test('portfolio fixture satisfies every invariant', () => {
  assert.deepEqual(checkInvariants(load()), expectations.portfolio.invariantViolations);
});

test('card states are derived deterministically', () => {
  const state = load();
  for (const [initiativeId, expected] of Object.entries(expectations.portfolio.cardStates)) {
    const actual = deriveCardState(state, initiativeId);
    assert.equal(actual.kind, expected.kind, initiativeId);
    if (expected.nodeId) assert.equal(actual.nodeId, expected.nodeId, initiativeId);
  }
});

test('proposed initiatives are not on the board', () => {
  const board = load().initiatives.filter(i => i.lifecycle === 'active').map(i => i.id);
  assert.deepEqual(board, expectations.portfolio.boardInitiativeIds);
});

test('scenario 7: a waiting approval blocks only dependent work; parallel user tasks stay actionable', () => {
  const actions = nextAvailableActions(load()).filter(a => a.initiativeId === ids.vendor).map(a => a.nodeId);
  assert.ok(actions.includes('02000000-0000-7000-8000-000000000003'), 'sample export is actionable');
  assert.ok(!actions.includes('02000000-0000-7000-8000-000000000006'), 'pilot waits on security approval');
});

test('contains is not depends_on: a parent Task with open children is not itself the next action', () => {
  const actions = nextAvailableActions(load()).map(a => a.nodeId);
  assert.ok(!actions.includes('02000000-0000-7000-8000-000000000002'));
});

test('scenario 5: a source suggestion does not change protected MoSCoW', () => {
  const state = load();
  const { initiativeId, moscow, pendingSuggestionAssertionId } = expectations.portfolio.protectedMoscowUnchanged;
  const initiative = state.initiatives.find(i => i.id === initiativeId);
  assert.equal(initiative.moscow, moscow);
  assert.ok(initiative.protectedFields.includes('moscow'));
  assert.equal(state.assertions.find(a => a.id === pendingSuggestionAssertionId).status, 'suggested');
});

test('decision outcome selects the conditional route', () => {
  const state = load();
  const { apply, skippedNodeIds, reachedNodeIds } = expectations.decisionOutcome;
  Object.assign(node(state, apply.nodeId), { state: apply.state, outcome: apply.outcome });
  const graph = buildGraph(state, ids.vendor);
  for (const id of skippedNodeIds) assert.ok(isSkipped(graph.nodes.get(id), graph), `${id} skipped`);
  for (const id of reachedNodeIds) assert.ok(isReached(graph.nodes.get(id), graph), `${id} reached`);
});

test('nodes downstream of an open decision are not yet reached', () => {
  const state = load();
  const graph = buildGraph(state, ids.vendor);
  assert.equal(isReached(graph.nodes.get('02000000-0000-7000-8000-000000000010'), graph), false);
});

test('invariant: contains across initiatives is rejected (one graph per initiative)', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'contains', fromId: '02000000-0000-7000-8000-000000000002', toId: '02000000-0000-7000-8000-000000000012' }));
  assert.ok(codes(state).includes('EDGE_CROSS_INITIATIVE_FORBIDDEN'));
});

test('invariant: depends_on across initiatives is allowed (shared dependency)', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'depends_on', fromId: '02000000-0000-7000-8000-000000000006', toId: '02000000-0000-7000-8000-000000000011' }));
  assert.deepEqual(codes(state), []);
});

test('invariant: a child Task has at most one container', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'contains', fromId: '02000000-0000-7000-8000-000000000006', toId: '02000000-0000-7000-8000-000000000003' }));
  assert.ok(codes(state).includes('CONTAINS_MULTIPLE_PARENTS'));
});

test('invariant: only Tasks contain Tasks', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'contains', fromId: '02000000-0000-7000-8000-000000000005', toId: '02000000-0000-7000-8000-000000000006' }));
  assert.ok(codes(state).includes('CONTAINS_REQUIRES_TASKS'));
});

test('invariant: depends_on cycles are rejected', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'depends_on', fromId: '02000000-0000-7000-8000-000000000001', toId: '02000000-0000-7000-8000-000000000002' }));
  assert.ok(codes(state).includes('DEPENDS_ON_CYCLE'));
});

test('invariant: conditions only on leads_to from a Decision, naming a real option', () => {
  const state = load();
  state.edges.push(edgeTemplate(state, { type: 'leads_to', fromId: '02000000-0000-7000-8000-000000000001', toId: '02000000-0000-7000-8000-000000000006', condition: { optionId: 'proceed' } }));
  state.edges.push(edgeTemplate(state, { id: '03000000-0000-7000-8000-000000000998', type: 'leads_to', fromId: '02000000-0000-7000-8000-000000000008', toId: '02000000-0000-7000-8000-000000000006', condition: { optionId: 'maybe' } }));
  const found = codes(state);
  assert.ok(found.includes('CONDITION_REQUIRES_DECISION_LEADS_TO'));
  assert.ok(found.includes('CONDITION_UNKNOWN_OPTION'));
});

test('invariant: a question must target something in its own initiative', () => {
  const state = load();
  state.questions[0].initiativeId = ids.retention;
  assert.ok(codes(state).includes('QUESTION_TARGET_INVALID'));
});
