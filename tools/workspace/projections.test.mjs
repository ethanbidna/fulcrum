import { expect, test } from 'vitest';
import { Domain, projectGraph, projectFocus, projectPortfolio, projectRail } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
import * as reference from '../reference/card-state.mjs';
const fixture = () => readJson('fixtures/states/portfolio.state.json');
const id = (prefix, number) => `${prefix}000000-0000-7000-8000-${String(number).padStart(12, '0')}`;
const nodeId = number => id('02', number);
const initiativeId = number => id('01', number);
const NOW = '2026-11-08T20:00:00Z';
function setup(options = {}) {
  const snapshot = fixture(); const validators = loadValidators(); let counter = 1000; let seq = 0;
  const domain = new Domain(snapshot, [], {
    newId: () => id('09', counter++), now: () => NOW, deviceId: snapshot.state.settings.ingestionDeviceId,
    userEntityId: id('08', 2), validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors,
    validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors,
    commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794168000000-${String(seq).padStart(4, '0')}` })),
    ...options,
  });
  const execute = (name, args, extra = {}) => domain.execute({ name, args, actor: 'user', ...extra });
  return { domain, execute };
}
test('portfolio and rail match frozen reference expectations', () => {
  const state = fixture().state; const expected = readJson('fixtures/scenarios/expectations.json').portfolio;
  const cards = projectPortfolio(state);
  expect(cards.map(card => card.initiative.id)).toEqual(expected.boardInitiativeIds);
  for (const card of cards) expect(card.cardState).toMatchObject(expected.cardStates[card.initiative.id]);
  const rail = projectRail(state, [], { now: NOW });
  expect(rail.nextAvailableActions.map(item => ({ initiativeId: item.initiativeId, nodeId: item.node.id }))).toEqual(reference.nextAvailableActions(state));
  expect(rail.questionCount).toBe(expected.openQuestionCount);
});
test('graph retains shared prerequisites as canonical references', () => {
  const state = fixture().state;
  const dependent = state.nodes.find(node => node.id === nodeId(3));
  state.edges.push({ ...state.edges.find(edge => edge.type === 'depends_on'), id: id('03', 999), initiativeId: dependent.initiativeId, fromId: dependent.id, toId: nodeId(11) });
  const graph = projectGraph(state, dependent.initiativeId);
  expect(graph.references).toContain(state.nodes.find(node => node.id === nodeId(11)));
  expect(graph.nodes).not.toContain(state.nodes.find(node => node.id === nodeId(11)));
});
test('focus includes contains descendants, internal edges and immediate prerequisites only', () => {
  const state = fixture().state; const focused = projectFocus(state, nodeId(2));
  const root = state.nodes.find(node => node.id === nodeId(2));
  const children = state.edges.filter(edge => edge.type === 'contains' && edge.fromId === root.id).map(edge => edge.toId);
  expect(focused.nodes.map(node => node.id)).toEqual(expect.arrayContaining([root.id, ...children]));
  for (const node of focused.nodes) expect(node).toBe(state.nodes.find(record => record.id === node.id));
  expect(focused.edges.every(edge => focused.nodes.some(node => node.id === edge.fromId) && [...focused.nodes, ...focused.references].some(node => node.id === edge.toId))).toBe(true);
  for (const node of focused.references) expect(focused.nodes).not.toContain(node);
});
test('focus does not recursively expand prerequisite references', () => {
  const state = fixture().state; const task = state.nodes.find(node => node.id === nodeId(3));
  const template = state.edges.find(edge => edge.type === 'depends_on');
  state.edges = [
    { ...template, id: id('03', 990), fromId: task.id, toId: nodeId(11), initiativeId: task.initiativeId },
    { ...template, id: id('03', 991), fromId: nodeId(11), toId: nodeId(13), initiativeId: initiativeId(3) },
  ];
  const graph = projectFocus(state, task.id);
  expect(graph.references.map(node => node.id)).toEqual([nodeId(11)]);
  expect(graph.edges.map(edge => edge.id)).toEqual([id('03', 990)]);
});
test('all query results are isolated; focused command edits appear in full graph and rail', async () => {
  const { domain, execute } = setup(); const focused = await domain.query('graph.focus', { nodeId: nodeId(3) });
  focused.nodes[0].title = 'Mutated query';
  expect((await domain.query('node.get', { id: nodeId(3) })).title).not.toBe('Mutated query');
  expect(await execute('node.update', { id: nodeId(3), patch: { title: 'Review synthetic alternatives' } })).toMatchObject({ ok: true });
  const full = await domain.query('graph.get', { initiativeId: initiativeId(1) });
  expect(full.nodes.find(node => node.id === nodeId(3)).title).toBe('Review synthetic alternatives');
  expect((await domain.query('portfolio.rail', {})).nextAvailableActions.find(item => item.node.id === nodeId(3)).node.title).toBe('Review synthetic alternatives');
});
test('waiting rail deduplicates shared dependencies and excludes inactive, satisfied and skipped work', () => {
  const state = fixture().state; const template = state.edges.find(edge => edge.type === 'depends_on');
  state.edges.push({ ...template, id: id('03', 999), initiativeId: initiativeId(1), fromId: nodeId(3), toId: nodeId(11) });
  const rail = projectRail(state, [], { now: NOW });
  expect(rail.waitingOn.filter(item => item.node.id === nodeId(11))).toHaveLength(1);
  expect(rail.waitingOn.find(item => item.node.id === nodeId(11)).initiativeIds).toContain(initiativeId(1));
  state.nodes.find(node => node.id === nodeId(11)).state = 'satisfied';
  expect(projectRail(state, [], { now: NOW }).waitingOn.some(item => item.node.id === nodeId(11))).toBe(false);
});
test('history exposes replayed before/after, filters and compensating undo', async () => {
  const { domain, execute } = setup(); const before = (await domain.query('node.get', { id: nodeId(3) })).title;
  const changed = await execute('node.update', { id: nodeId(3), patch: { title: 'Revised title' } }, { runId: 'synthetic:run' });
  const history = await domain.query('history.list', { target: { kind: 'node', id: nodeId(3), field: 'title' } });
  expect(history).toHaveLength(1);
  expect(history[0].changes).toContainEqual(expect.objectContaining({ before, after: 'Revised title', field: 'title' }));
  expect(history[0].runId).toBe('synthetic:run');
  expect(await domain.query('history.list', { actor: 'ai' })).toEqual([]);
  expect(await domain.query('history.list', { since: '2027-01-01T00:00:00Z' })).toEqual([]);
  expect(await execute('change.undo', { eventId: changed.eventId })).toMatchObject({ ok: true });
  expect((await domain.query('history.list', {}))[0].undoOf).toBe(changed.eventId);
});
test('rail meaningful changes omit cosmetic writes while history retains them', async () => {
  const { domain, execute } = setup();
  await execute('node.update', { id: nodeId(3), patch: { title: 'Cosmetic rename' } });
  const meaningful = await execute('node.setState', { id: nodeId(3), state: 'done' });
  expect((await domain.query('portfolio.rail', {})).meaningfulChanges.map(event => event.eventId)).toEqual([meaningful.eventId]);
  expect(await domain.query('history.list', {})).toHaveLength(2);
});
test('query failures are explicit and queries emit no writes or notifications', async () => {
  const { domain } = setup(); let notified = 0; domain.subscribe(() => notified++);
  await expect(domain.query('graph.focus', { nodeId: nodeId(999) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(domain.query('history.list', { since: 'not a date' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(domain.query('unknown', {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(await domain.query('portfolio.list', {})).toHaveLength(4);
  expect(domain.history()).toEqual([]); expect(notified).toBe(0);
});
test('projections contain no completion percentage or generated prose field', () => {
  const state = fixture().state;
  const output = [projectPortfolio(state), projectFocus(state, nodeId(2)), projectRail(state, [], { now: NOW })];
  const keys = value => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]) : [];
  expect(keys(output).filter(key => /percent|completion|summary/i.test(key))).toEqual([]);
});
test('a satisfied OR alternative is not reported as waiting', () => {
  const state = fixture().state; const task = state.nodes.find(node => node.id === nodeId(3));
  const satisfied = state.nodes.find(node => node.id === nodeId(5)); satisfied.state = 'satisfied';
  task.prerequisiteGroups = [{ id: 'either-review', mode: 'any' }];
  const template = state.edges.find(edge => edge.type === 'depends_on');
  state.edges = [
    { ...template, id: id('03', 990), fromId: task.id, toId: nodeId(11), initiativeId: task.initiativeId, prerequisiteGroupId: 'either-review' },
    { ...template, id: id('03', 991), fromId: task.id, toId: satisfied.id, initiativeId: task.initiativeId, prerequisiteGroupId: 'either-review' },
  ];
  expect(projectRail(state, [], { now: NOW }).waitingOn).toEqual([]);
});
test('waiting rail excludes inactive initiatives and routes skipped by a decision', () => {
  const state = fixture().state;
  state.initiatives.forEach(initiative => { initiative.lifecycle = 'paused'; });
  expect(projectRail(state, [], { now: NOW }).nextAvailableActions).toEqual([]);
  expect(projectRail(state, [], { now: NOW }).waitingOn).toEqual([]);
  state.initiatives[0].lifecycle = 'active';
  const decision = state.nodes.find(node => node.id === nodeId(8)); decision.state = 'decided'; decision.outcome = 'stop';
  const template = state.edges.find(edge => edge.type === 'depends_on');
  state.edges.push({ ...template, id: id('03', 995), fromId: nodeId(9), toId: nodeId(11), initiativeId: initiativeId(1) });
  expect(projectRail(state, [], { now: NOW }).waitingOn.some(item => item.node.id === nodeId(11))).toBe(false);
});
test('recent changes obey injected time, since and the bounded default window', async () => {
  const { domain, execute } = setup();
  await execute('node.setState', { id: nodeId(3), state: 'done' });
  expect((await domain.query('portfolio.rail', { since: '2027-01-01T00:00:00Z' })).meaningfulChanges).toEqual([]);
  const history = await domain.query('history.list', {});
  expect(projectRail(fixture().state, history, { now: '2027-01-01T00:00:00Z' }).meaningfulChanges).toEqual([]);
  expect(projectRail(fixture().state, history, { now: '2026-01-01T00:00:00Z' }).meaningfulChanges).toEqual([]);
});
test('history preserves evidence links and deleted records without changing the event log', async () => {
  const { domain, execute } = setup(); const sourceId = id('04', 1);
  const changed = await execute('node.update', { id: nodeId(3), patch: { details: 'Source-backed detail' } }, { actor: 'ai', evidenceRefs: [{ sourceId }] });
  expect(changed).toMatchObject({ ok: true });
  const eventBytes = JSON.stringify(domain.history());
  const history = await domain.query('history.list', { actor: 'ai' });
  expect(history[0].evidenceRefs).toEqual([{ sourceId }]);
  expect(history[0].changes).toContainEqual(expect.objectContaining({ field: 'details', after: 'Source-backed detail' }));
  history[0].evidenceRefs[0].sourceId = 'mutated';
  expect(JSON.stringify(domain.history())).toBe(eventBytes);
  expect(await execute('node.delete', { id: nodeId(3) })).toMatchObject({ ok: true });
  expect((await domain.query('history.list', { target: { kind: 'node', id: nodeId(3) } }))[0].changes).toContainEqual(expect.objectContaining({ operation: 'tombstone', before: expect.objectContaining({ id: nodeId(3) }), after: null }));
});
test('queries during a commit show only acknowledged state', async () => {
  let release; let committing;
  const started = new Promise(resolve => { committing = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { domain, execute } = setup({ commit: async drafts => {
    committing(); await gate;
    return drafts.map(draft => ({ ...draft, seq: 1, hlc: '1794168000000-0001' }));
  } });
  const pending = execute('node.setState', { id: nodeId(3), state: 'done' });
  await started;
  expect((await domain.query('node.get', { id: nodeId(3) })).state).toBe('open');
  expect(await domain.query('history.list', {})).toEqual([]);
  release(); expect(await pending).toMatchObject({ ok: true });
  expect((await domain.query('node.get', { id: nodeId(3) })).state).toBe('done');
});
test('deferred questions stay contextual but do not increase the open count', async () => {
  const { domain, execute } = setup(); const initial = (await domain.query('portfolio.rail', {})).questionCount;
  const question = domain.getSnapshot().state.questions.find(question => question.state === 'open');
  expect(await execute('question.defer', { id: question.id, deferredUntil: '2026-12-01T00:00:00Z' })).toMatchObject({ ok: true });
  expect((await domain.query('portfolio.rail', {})).questionCount).toBe(initial - 1);
});
test('waiting rail retains unmet AND prerequisites and unresolved OR groups', () => {
  const state = fixture().state; const task = state.nodes.find(node => node.id === nodeId(3));
  const template = state.edges.find(edge => edge.type === 'depends_on');
  state.edges = [{ ...template, id: id('03', 990), fromId: task.id, toId: nodeId(11), initiativeId: task.initiativeId, prerequisiteGroupId: 'review' }];
  for (const mode of ['all', 'any']) {
    task.prerequisiteGroups = [{ id: 'review', mode }];
    expect(projectRail(state, [], { now: NOW }).waitingOn.map(item => item.node.id)).toEqual([nodeId(11)]);
  }
});
