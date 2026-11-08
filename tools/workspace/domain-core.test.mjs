import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { checkInvariants, checkAffectedInvariants, checkPolicy, PolicyRule, deriveCardState, buildGraph, isReached, isSkipped, nextAvailableActions } from '../../packages/domain/src/index.ts';
import { checkInvariants as referenceInvariants } from '../reference/invariants.mjs';
import * as referenceCards from '../reference/card-state.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const expectations = read('fixtures/scenarios/expectations.json');
const load = () => read(expectations.portfolio.fixture).state;
const missingId = '02000000-0000-7000-8000-000000000999';
const newEdgeId = '03000000-0000-7000-8000-000000000999';
const node = (state, suffix) => state.nodes.find(record => record.id.endsWith(suffix.padStart(12, '0')));
function addEdge(state, changes) { state.edges.push({ ...state.edges[0], id: newEdgeId, ...changes }); }

const mutations = {
  DUPLICATE_ID: s => s.categories.push({ ...s.categories[0], id: s.nodes[0].id }),
  NODE_INITIATIVE_MISSING: s => { s.nodes[0].initiativeId = missingId; },
  EDGE_ENDPOINT_MISSING: s => { s.edges[0].toId = missingId; },
  EDGE_SELF_LOOP: s => { s.edges[0].toId = s.edges[0].fromId; },
  EDGE_HOME_INITIATIVE_MISMATCH: s => { s.edges[0].initiativeId = missingId; },
  EDGE_CROSS_INITIATIVE_FORBIDDEN: s => addEdge(s, { type: 'contains', fromId: node(s, '2').id, toId: node(s, '12').id }),
  CONTAINS_REQUIRES_TASKS: s => addEdge(s, { type: 'contains', fromId: node(s, '5').id, toId: node(s, '6').id }),
  CONTAINS_MULTIPLE_PARENTS: s => addEdge(s, { type: 'contains', fromId: node(s, '6').id, toId: node(s, '3').id }),
  CONTAINS_CYCLE: s => addEdge(s, { type: 'contains', fromId: node(s, '3').id, toId: node(s, '2').id }),
  DEPENDS_ON_CYCLE: s => addEdge(s, { type: 'depends_on', fromId: node(s, '1').id, toId: node(s, '2').id }),
  CONDITION_REQUIRES_DECISION_LEADS_TO: s => { s.edges[0].condition = { optionId: 'stop' }; },
  CONDITION_UNKNOWN_OPTION: s => addEdge(s, { type: 'leads_to', fromId: node(s, '8').id, toId: node(s, '6').id, condition: { optionId: 'missing' } }),
  PREREQUISITE_GROUP_REQUIRES_DEPENDS_ON: s => addEdge(s, { type: 'contains', fromId: node(s, '2').id, toId: node(s, '6').id, prerequisiteGroupId: 'unknown' }),
  PREREQUISITE_GROUP_UNKNOWN: s => { s.edges.find(e => e.type === 'depends_on').prerequisiteGroupId = 'missing'; },
  DECISION_OUTCOME_UNKNOWN: s => { node(s, '8').outcome = 'missing'; },
  DECISION_OUTCOME_MISSING: s => { node(s, '8').state = 'decided'; delete node(s, '8').outcome; },
  GROUP_OUTSIDE_INITIATIVE: s => { s.nodes[0].groupId = missingId; },
  QUESTION_TARGET_INVALID: s => { s.questions[0].target.id = missingId; },
  ASSERTION_TARGET_INVALID: s => { s.assertions[0].target.id = missingId; },
  EVIDENCE_SOURCE_MISSING: s => { s.nodes[0].evidenceRefs = [{ sourceId: missingId }]; },
};

describe('domain invariants and reference parity', () => {
  test('golden portfolio and card states', () => {
    const state = load();
    expect(checkInvariants(state)).toEqual(expectations.portfolio.invariantViolations);
    expect(state.initiatives.filter(i => i.lifecycle === 'active').map(i => i.id)).toEqual(expectations.portfolio.boardInitiativeIds);
    for (const [id, expected] of Object.entries(expectations.portfolio.cardStates)) {
      expect(deriveCardState(state, id)).toMatchObject(expected);
      expect(deriveCardState(state, id)).toEqual(referenceCards.deriveCardState(state, id));
    }
    expect(nextAvailableActions(state)).toEqual(referenceCards.nextAvailableActions(state));
  });
  for (const [code, mutate] of Object.entries(mutations)) test(code, () => {
    const state = load(); mutate(state);
    expect(checkInvariants(state)).toEqual(referenceInvariants(state));
    expect(checkInvariants(state).map(v => v.code)).toContain(code);
  });
  test('decisionOutcome expectations', () => {
    const state = load(); const { apply, skippedNodeIds, reachedNodeIds } = expectations.decisionOutcome;
    Object.assign(state.nodes.find(n => n.id === apply.nodeId), { state: apply.state, outcome: apply.outcome });
    const graph = buildGraph(state, node(state, '8').initiativeId);
    for (const id of skippedNodeIds) expect(isSkipped(graph.nodes.get(id), graph)).toBe(true);
    for (const id of reachedNodeIds) expect(isReached(graph.nodes.get(id), graph)).toBe(true);
  });
  test('affected validation catches deleted endpoints and new cycles without unrelated failures', () => {
    const before = load(); const after = structuredClone(before);
    const deleted = node(after, '3').id;
    after.nodes = after.nodes.filter(n => n.id !== deleted);
    expect(checkAffectedInvariants(before, after, [deleted]).map(v => v.code)).toContain('EDGE_ENDPOINT_MISSING');
    const independent = { ...node(after, '12'), id: missingId, initiativeId: newEdgeId, evidenceRefs: [] };
    after.nodes.push(independent);
    expect(checkAffectedInvariants(before, after, [deleted]).map(v => v.id)).not.toContain(independent.id);
    const cyclic = load(); mutations.DEPENDS_ON_CYCLE(cyclic);
    expect(checkAffectedInvariants(before, cyclic, [newEdgeId]).map(v => v.code)).toContain('DEPENDS_ON_CYCLE');
  });
  test('shared dependencies retain their cross-initiative dependants', () => {
    const before = load(); const after = structuredClone(before);
    const shared = node(after, '11');
    addEdge(after, { type: 'depends_on', fromId: node(after, '6').id, toId: shared.id });
    after.nodes = after.nodes.filter(n => n.id !== shared.id);
    expect(checkAffectedInvariants(before, after, [shared.id]).filter(v => v.code === 'EDGE_ENDPOINT_MISSING').map(v => v.id)).toContain(newEdgeId);
  });
  test('global ids include device records and objective evidence is checked', () => {
    const state = load(); state.devices[0].id = state.nodes[0].id;
    state.objectives[0].evidenceRefs = [{ sourceId: missingId }];
    expect(checkInvariants(state).map(v => v.code)).toEqual(['DUPLICATE_ID', 'EVIDENCE_SOURCE_MISSING']);
  });
});

function setup(actor = 'ai') {
  const state = load();
  const initiative = state.initiatives[0];
  const userEntityId = state.entities.find(e => e.type === 'person').id;
  const context = { state, deviceId: state.settings.ingestionDeviceId, userEntityId, match: { attempted: true, matchedId: null }, mcp: { enabled: true, readOnly: false } };
  const intent = { name: 'node.update', actor, writes: [], initiativeIds: [initiative.id], evidenceRefs: [{ sourceId: state.sources[0].id }] };
  return { state, context, intent, initiative };
}
function commitment(f, predicate, nodeType) {
  f.intent.name = 'node.create';
  f.intent.creation = { kind: 'node', id: missingId, nodeType };
  const assertion = { ...f.state.assertions[0], id: '05000000-0000-7000-8000-000000000999', target: { kind: 'node', id: missingId }, predicate, certainty: 'explicit', status: 'pending', evidenceRefs: f.intent.evidenceRefs, value: { speakerEntityId: predicate === 'user_commitment' ? f.context.userEntityId : f.state.entities[0].id, unambiguous: true } };
  f.state.assertions.push(assertion); f.intent.commitmentAssertionId = assertion.id;
  return assertion;
}
const policies = [
  [PolicyRule.Activation, f => { f.intent.name = 'initiative.approve'; f.intent.actor = 'user'; }, f => { f.intent.actor = 'ai'; }],
  [PolicyRule.TaskCommitment, f => { commitment(f, 'user_commitment', 'task'); }, f => { f.state.assertions.at(-1).certainty = 'inferred'; }],
  [PolicyRule.ExternalWork, f => { commitment(f, 'external_commitment', 'dependency'); }, f => { f.state.assertions.at(-1).value.unambiguous = false; }],
  [PolicyRule.ProtectedFields, f => { f.intent.writes = [{ target: { kind: 'initiative', id: f.initiative.id }, field: 'title' }]; }, f => { f.initiative.protectedFields.push('title'); }],
  [PolicyRule.Evidence, () => {}, f => { f.intent.evidenceRefs = []; }],
  [PolicyRule.ManualPrecedence, f => { f.intent.name = 'field.unprotect'; f.intent.actor = 'user'; }, f => { f.intent.actor = 'ai'; }],
  [PolicyRule.Reintroduction, f => { f.intent.suggestionSignature = 'synthetic:repeat'; }, f => { f.state.rejections.push({ signature: 'synthetic:repeat', rejectedAt: '2099-01-01T00:00:00Z' }); }],
  [PolicyRule.PreferUpdate, f => { f.intent.name = 'entity.create'; f.intent.creation = { kind: 'entity', id: missingId }; }, f => { delete f.context.match; }],
  [PolicyRule.MaterialQuestions, f => { f.intent.name = 'question.raise'; f.intent.question = { materiality: 'medium', dedupeKey: 'synthetic:question' }; }, f => { f.intent.question.materiality = 'low'; }],
  [PolicyRule.ConnectorScope, f => { f.intent.actor = 'connector'; f.intent.name = 'source.record'; }, f => { f.intent.name = 'node.create'; }],
  [PolicyRule.IngestionDevice, () => {}, f => { f.context.deviceId = 'other-device'; }],
  [PolicyRule.McpScope, f => { f.intent.actor = 'mcp'; }, f => { f.context.mcp.readOnly = true; }],
];

describe('autonomy policy', () => {
  for (const [rule, allow, reject] of policies) test(`${rule}: allow and deny`, () => {
    const f = setup(); allow(f);
    const before = structuredClone(f);
    expect(checkPolicy(f.intent, f.context).ok).toBe(true);
    expect(f).toEqual(before);
    reject(f);
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ ok: false, rule });
  });
  test('manual edits protect fields; AI suggests; MCP writes are tagged', () => {
    const f = setup('user');
    f.intent.writes = [{ target: { kind: 'initiative', id: f.initiative.id }, field: 'title' }];
    expect(checkPolicy(f.intent, f.context).protect).toEqual(f.intent.writes);
    f.initiative.protectedFields.push('title'); f.intent.actor = 'ai';
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ disposition: 'suggest', rule: PolicyRule.ProtectedFields });
    f.intent.actor = 'mcp';
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ ok: true, tagMcpWrite: true, protect: [] });
  });
  test('commitment must match user, target, source and live assertion', () => {
    for (const mutate of [a => { a.value.speakerEntityId = missingId; }, a => { a.target.id = newEdgeId; }, a => { a.evidenceRefs = [{ sourceId: missingId }]; }, a => { a.status = 'rejected'; }]) {
      const f = setup(); const assertion = commitment(f, 'user_commitment', 'task'); mutate(assertion);
      expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.TaskCommitment });
    }
  });
  test('newer event time permits a rejected suggestion only when allowed', () => {
    const f = setup(); f.intent.suggestionSignature = 'repeat';
    const rejection = { signature: 'repeat', rejectedAt: '2026-01-01T00:00:00Z', untilNewEvidence: true };
    f.state.rejections.push(rejection); f.state.sources[0].happenedAt = '2026-02-01T00:00:00Z';
    expect(checkPolicy(f.intent, f.context).ok).toBe(true);
    rejection.untilNewEvidence = false;
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ disposition: 'drop' });
    rejection.untilNewEvidence = true; f.state.sources[0].happenedAt = '2025-01-01T00:00:00Z';
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ disposition: 'drop' });
  });
  test('existing match prevents duplicate creation and question dedupe returns existing id', () => {
    const f = setup(); commitment(f, 'user_commitment', 'task'); f.context.match.matchedId = node(f.state, '1').id;
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.PreferUpdate });
    delete f.intent.creation; f.intent.name = 'question.raise';
    f.intent.question = { materiality: 'high', dedupeKey: f.state.questions[0].dedupeKey };
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ ok: true, updateQuestionId: f.state.questions[0].id });
  });
  test('MCP scope includes write targets even when omitted from declared scope', () => {
    const f = setup('mcp');
    f.context.mcp.initiativeIds = [f.initiative.id];
    f.intent.writes = [{ target: { kind: 'initiative', id: f.state.initiatives[1].id }, field: 'title' }];
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.McpScope });
  });
  test('MCP scopes every affected initiative and portfolio-wide operations', () => {
    const f = setup('mcp'); f.context.mcp.initiativeIds = [f.initiative.id];
    expect(checkPolicy(f.intent, f.context).ok).toBe(true);
    f.intent.initiativeIds.push(f.state.initiatives[1].id);
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.McpScope });
    f.intent.initiativeIds = [];
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.McpScope });
    delete f.context.mcp.initiativeIds; f.intent.initiativeIds = [f.initiative.id];
    f.context.mcp.categoryIds = f.initiative.categoryIds;
    expect(checkPolicy(f.intent, f.context).ok).toBe(true);
    f.context.mcp.categoryIds = [];
    expect(checkPolicy(f.intent, f.context)).toMatchObject({ rule: PolicyRule.McpScope });
  });
});
