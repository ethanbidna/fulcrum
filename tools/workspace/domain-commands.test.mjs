import { describe, expect, test } from 'vitest';
import { Domain, COMMAND_ARGUMENTS, suggestionSignature, checkInvariants, replayEvents } from '../../packages/domain/src/index.ts';
import { loadValidators, readJson } from '../reference/schemas.mjs';
import { fold, fromStateDocument, toStateDocument } from '../reference/fold.mjs';
const validators = loadValidators();
const initial = () => readJson('fixtures/states/portfolio.state.json');
const NEW = '02000000-0000-7000-8000-000000000999';
const nextRecordId = prefix => `${prefix}000000-0000-7000-8000-000000000999`;
const id = (prefix, n = 1) => `${prefix}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const nodeId = n => id('02', n);
const errors = validator => value => validator(value) ? [] : structuredClone(validator.errors);
function setup(options = {}) {
  let counter = 1000; let sequence = 0;
  const writes = []; let fail = false;
  const snapshot = initial();
  const ports = {
    newId: () => id('09', counter++), now: () => '2026-11-08T18:10:00.000Z',
    deviceId: snapshot.state.settings.ingestionDeviceId, userEntityId: snapshot.state.entities.find(e => e.type === 'person').id,
    validateState: errors(validators.workspaceState), validateEvent: errors(validators.changeEvent),
    mcp: { enabled: true, readOnly: false },
    commit: async drafts => {
      if (fail) throw new Error('synthetic append failure');
      const events = drafts.map(draft => ({ ...structuredClone(draft), seq: ++sequence, hlc: `1794161400000-${String(sequence).padStart(4, '0')}` }));
      writes.push(...events); return events;
    }, ...options,
  };
  const domain = new Domain(snapshot, [], ports);
  const execute = (name, args, extra = {}) => domain.execute({ name, args, actor: 'user', ...extra });
  return { domain, execute, snapshot, ports, writes, failAppend: () => { fail = true; } };
}
const state = f => f.domain.getSnapshot().state;
const getNode = (f, n) => state(f).nodes.find(node => node.id === nodeId(n));
const passed = result => { expect(result, JSON.stringify(result)).toMatchObject({ ok: true }); return result; };
const denied = (result, code) => expect(result).toMatchObject({ ok: false, error: { code } });

const catalogCases = {
  'initiative.create': () => ({ record: { id: nextRecordId('01'), title: 'Synthetic initiative' } }),
  'initiative.propose': () => ({ record: { id: nextRecordId('01'), title: 'Synthetic proposal' } }),
  'initiative.approve': () => ({ id: id('01', 2) }), 'initiative.reject': () => ({ id: id('01', 2) }),
  'initiative.update': () => ({ id: id('01'), patch: { description: 'Updated synthetic description' } }),
  'initiative.setMoscow': () => ({ id: id('01'), moscow: 'could_do' }),
  'initiative.setLifecycle': () => ({ id: id('01'), lifecycle: 'paused' }),
  'initiative.setCategories': () => ({ id: id('01'), categoryIds: [] }), 'initiative.rank': () => ({ id: id('01'), manualRank: 'b0' }),
  'category.create': () => ({ record: { id: nextRecordId('0c'), label: 'Synthetic category' } }),
  'category.rename': () => ({ id: id('0c'), label: 'Renamed category' }), 'category.rank': () => ({ id: id('0c'), manualRank: 'b0' }), 'category.delete': () => ({ id: id('0c') }),
  'node.create': () => ({ record: { id: NEW, initiativeId: id('01'), type: 'task', title: 'Test locally', state: 'open' } }),
  'node.update': () => ({ id: nodeId(1), patch: { details: 'Updated details' } }), 'node.setState': () => ({ id: nodeId(1), state: 'done' }),
  'node.setGroup': () => ({ id: nodeId(1), groupId: null }), 'node.setPrerequisiteGroups': () => ({ id: nodeId(1), prerequisiteGroups: [{ id: 'synthetic', mode: 'any' }] }),
  'node.supersede': () => ({ id: nodeId(1), supersededBy: nodeId(2) }), 'node.delete': () => ({ id: nodeId(3) }),
  'decision.decide': () => ({ id: nodeId(8), outcome: 'stop' }),
  'edge.create': f => ({ record: { ...state(f).edges[0], id: nextRecordId('03'), type: 'related_to' } }),
  'edge.update': f => ({ id: state(f).edges[0].id, patch: { label: 'Related synthetic context' } }), 'edge.delete': f => ({ id: state(f).edges[0].id }),
  'group.create': () => ({ record: { id: nextRecordId('0b'), initiativeId: id('01'), label: 'Synthetic group' } }),
  'group.rename': f => ({ id: state(f).groups[0].id, label: 'Renamed group' }), 'group.delete': f => ({ id: state(f).groups[0].id }),
  'source.record': f => ({ record: { ...state(f).sources[0], id: nextRecordId('04'), remoteId: 'synthetic:new-source' } }),
  'assertion.record': f => ({ record: { ...state(f).assertions[0], id: nextRecordId('05') } }), 'assertion.reject': f => ({ id: state(f).assertions[0].id }),
  'evidence.attach': f => ({ target: { kind: 'node', id: nodeId(1) }, evidenceRef: { sourceId: state(f).sources[0].id } }),
  'evidence.detach': f => ({ target: { kind: 'node', id: nodeId(1) }, sourceId: state(f).sources[0].id }),
  'entity.create': () => ({ record: { id: nextRecordId('08'), type: 'person', label: 'Synthetic reviewer', aliases: [] } }),
  'entity.update': f => ({ id: state(f).entities[0].id, patch: { label: 'Synthetic team' } }), 'entity.addAlias': f => ({ id: state(f).entities[0].id, alias: 'Review team' }),
  'entity.merge': f => ({ id: state(f).entities[0].id, intoId: state(f).entities[1].id }),
  'entity.split': f => ({ id: state(f).entities[0].id, aliases: [state(f).entities[0].aliases[0]], record: { id: nextRecordId('08'), type: 'team', label: 'Synthetic split' } }),
  'objective.create': () => ({ record: { id: nextRecordId('07'), label: 'Synthetic objective', rank: 1 } }),
  'objective.update': f => ({ id: state(f).objectives[0].id, patch: { weight: 2 } }), 'objective.rerank': f => ({ ranks: state(f).objectives.map(o => ({ id: o.id, rank: 1 })) }),
  'objective.delete': f => ({ id: state(f).objectives[0].id }), 'alignment.set': f => ({ initiativeId: id('01'), objectiveId: state(f).objectives[0].id, alignment: 3 }),
  'question.raise': f => ({ record: { ...state(f).questions[0], id: nextRecordId('06'), dedupeKey: 'synthetic:new-question' } }),
  'question.resolve': f => ({ id: state(f).questions[0].id, resolutionId: state(f).questions[0].resolutions[0].id }),
  'question.defer': f => ({ id: state(f).questions[0].id, deferredUntil: '2026-12-01T00:00:00Z' }), 'question.markObsolete': f => ({ id: state(f).questions[0].id }),
  'field.protect': () => ({ target: { kind: 'node', id: nodeId(1) }, field: 'title' }), 'field.unprotect': () => ({ target: { kind: 'initiative', id: id('01') }, field: 'moscow' }),
  'suggestion.reject': () => ({ signature: 'synthetic:rejected', untilNewEvidence: false }),
  'device.register': () => ({ record: { id: nextRecordId('0d'), label: 'Synthetic device' } }),
  'settings.setIngestionDevice': () => ({ ingestionDeviceId: id('0d', 2) }), 'settings.setDefaultCachePolicy': () => ({ defaultCachePolicy: 'none' }),
};
describe('v1 command catalog', () => {
  test('every command has an integration case', () => expect(Object.keys(catalogCases).sort()).toEqual(Object.keys(COMMAND_ARGUMENTS).filter(name => !name.endsWith('.undo')).sort()));
  for (const [name, args] of Object.entries(catalogCases)) test(name, async () => {
    const f = setup(); const commandArgs = args(f);
    passed(await f.execute(name, commandArgs));
    expect(checkInvariants(state(f))).toEqual([]);
    expect(validators.workspaceState(f.domain.getSnapshot()), JSON.stringify(validators.workspaceState.errors)).toBe(true);
    for (const event of f.writes) expect(validators.changeEvent(event)).toBe(true);
    // Replay the real emitted events through the independent executable spec.
    const replayed = toStateDocument(fold(f.writes, { base: fromStateDocument(f.snapshot.state) }).state);
    expect(replayed).toEqual(state(f));
  });
});

describe('atomic events, retry safety and undo', () => {
  test('replay frontier never advances past a missing device sequence', () => {
    const snapshot = initial(); const deviceId = snapshot.state.settings.ingestionDeviceId;
    const event = { v: 1, eventId: id('09', 2000), deviceId, seq: 2, hlc: '1794161400000-0002', at: '2026-11-08T18:10:00Z', actor: 'user', command: { name: 'node.update', args: {} }, ops: [] };
    expect(replayEvents(snapshot, [event]).document.frontier[deviceId]).toBe(0);
    const first = { ...event, eventId: id('09', 2001), seq: 1, hlc: '1794161400000-0001' };
    expect(replayEvents(snapshot, [event, first]).document.frontier[deviceId]).toBe(2);
    snapshot.frontier[deviceId] = 4;
    expect(replayEvents(snapshot, [{ ...event, seq: 6 }]).document.frontier[deviceId]).toBe(4);
  });
  test('base writers, stale bases, idempotency and restart', async () => {
    const f = setup(); const args = { id: nodeId(1), patch: { title: 'First edit' } };
    const first = passed(await f.execute('node.update', args, { idempotencyKey: 'synthetic:once' }));
    expect(first.ops.find(op => op.field === 'title').baseEventId).toBe(null);
    expect(await f.execute('node.update', args, { idempotencyKey: 'synthetic:once' })).toEqual(first);
    const second = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'Second edit' } }));
    expect(second.ops.find(op => op.field === 'title').baseEventId).toBe(first.eventId);
    denied(await f.execute('node.setState', { id: nodeId(1), state: 'done' }, { baseEventIds: { [`node:${nodeId(1)}:title`]: first.eventId } }), 'STALE_BASE');
    const restarted = new Domain(f.snapshot, f.writes, f.ports);
    expect(await restarted.execute({ name: 'node.update', args, actor: 'user', idempotencyKey: 'synthetic:once' })).toEqual(first);
    expect(f.writes).toHaveLength(2);
  });
  test('question resolution commits two commands in one event and rolls back invalid choices', async () => {
    const snapshot = initial(); const question = snapshot.state.questions[0];
    question.resolutions[0].commands = [{ name: 'node.update', args: { id: nodeId(1), patch: { title: 'Resolved title' } } }, { name: 'node.setState', args: { id: nodeId(1), state: 'done' } }];
    const f = setup(); const domain = new Domain(snapshot, [], f.ports);
    const command = { name: 'question.resolve', args: { id: question.id, resolutionId: question.resolutions[0].id }, actor: 'user' };
    passed(await domain.execute(command)); expect(f.writes).toHaveLength(1);
    expect(domain.getSnapshot().state.nodes.find(n => n.id === nodeId(1))).toMatchObject({ title: 'Resolved title', state: 'done' });
    const badSnapshot = structuredClone(snapshot); badSnapshot.state.questions[0].resolutions[0].commands[1].args.state = 'invented';
    const bad = new Domain(badSnapshot, [], f.ports); const before = f.writes.length; const unchanged = bad.getSnapshot();
    denied(await bad.execute(command), 'VALIDATION_FAILED'); expect(f.writes).toHaveLength(before);
    expect(bad.getSnapshot()).toEqual(unchanged);
  });
  test('undo restores a field and refuses to overwrite a later edit', async () => {
    const f = setup(); const original = getNode(f, 1).title;
    const change = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'Changed' } }));
    const undo = passed(await f.execute('change.undo', { eventId: change.eventId }));
    expect(getNode(f, 1).title).toBe(original); expect(f.writes.at(-1).undoOf).toBe(change.eventId);
    expect(undo.ops.find(op => op.field === 'title').baseEventId).toBe(change.eventId);
    const edit = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'New edit' } }));
    await f.execute('node.update', { id: nodeId(1), patch: { title: 'Later edit' } });
    denied(await f.execute('change.undo', { eventId: edit.eventId }), 'STALE_BASE');
    expect(getNode(f, 1).title).toBe('Later edit');
  });
  test('undo of one field survives a newer edit to another field', async () => {
    const f = setup(); const before = getNode(f, 1).title;
    const edit = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'Edited' } }));
    await f.execute('node.update', { id: nodeId(1), patch: { details: 'Later details' } });
    passed(await f.execute('change.undo', { eventId: edit.eventId }));
    expect(getNode(f, 1)).toMatchObject({ title: before, details: 'Later details' });
  });
  test('create/delete undo and reference replay restore deleted records', async () => {
    const f = setup(); const before = structuredClone(getNode(f, 3));
    const deletion = passed(await f.execute('node.delete', { id: before.id }));
    expect(getNode(f, 3)).toBeUndefined();
    passed(await f.execute('change.undo', { eventId: deletion.eventId })); expect(getNode(f, 3)).toEqual(before);
    expect(toStateDocument(fold(f.writes, { base: fromStateDocument(f.snapshot.state) }).state)).toEqual(state(f));
    const created = passed(await f.execute('node.create', catalogCases['node.create'](f)));
    passed(await f.execute('change.undo', { eventId: created.eventId })); expect(state(f).nodes.some(n => n.id === NEW)).toBe(false);
  });
  test('run undo reverses several events atomically and remains idempotent', async () => {
    const f = setup(); const original = getNode(f, 1).title;
    const first = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'First' } }, { runId: 'synthetic:run' }));
    const second = passed(await f.execute('node.update', { id: nodeId(1), patch: { title: 'Second' } }, { runId: 'synthetic:run' }));
    const undo = passed(await f.execute('run.undo', { runId: 'synthetic:run' }, { idempotencyKey: 'synthetic:undo-run' }));
    expect(getNode(f, 1).title).toBe(original);
    expect(f.writes.slice(-2).map(e => e.undoOf)).toEqual([second.eventId, first.eventId]);
    expect(await f.execute('run.undo', { runId: 'synthetic:run' }, { idempotencyKey: 'synthetic:undo-run' })).toEqual(undo);
  });
  test('idempotency never bypasses changed MCP access or another actor', async () => {
    const f = setup();
    const args = { id: nodeId(1), patch: { title: 'MCP edit' } };
    passed(await f.execute('node.update', args, { actor: 'mcp', idempotencyKey: 'synthetic:mcp-retry' }));
    f.ports.mcp.readOnly = true;
    denied(await f.execute('node.update', args, { actor: 'mcp', idempotencyKey: 'synthetic:mcp-retry' }), 'POLICY_DENIED');
    denied(await f.execute('node.update', args, { actor: 'ai', idempotencyKey: 'synthetic:mcp-retry' }), 'POLICY_DENIED');
  });
  test('commands are captured when submitted rather than when the queue advances', async () => {
    const f = setup(); const command = { name: 'node.update', args: { id: nodeId(1), patch: { title: 'Submitted' } }, actor: 'user' };
    const pending = f.domain.execute(command); command.args.patch.title = 'Mutated';
    passed(await pending); expect(getNode(f, 1).title).toBe('Submitted');
  });
  test('AI run undo preserves every Rejection across restart and reference replay', async () => {
    const f = setup(); const original = getNode(f, 1).title; const evidenceRefs = [{ sourceId: state(f).sources[0].id }];
    for (const title of ['AI first', 'AI second']) passed(await f.execute('node.update', { id: nodeId(1), patch: { title } }, { actor: 'ai', runId: 'synthetic:ai-run', evidenceRefs }));
    passed(await f.execute('run.undo', { runId: 'synthetic:ai-run' }));
    expect(getNode(f, 1).title).toBe(original); expect(state(f).rejections).toHaveLength(f.snapshot.state.rejections.length + 2);
    const restarted = new Domain(f.snapshot, f.writes, f.ports); expect(restarted.getSnapshot().state.rejections).toEqual(state(f).rejections);
    expect(toStateDocument(fold(f.writes, { base: fromStateDocument(f.snapshot.state) }).state)).toEqual(state(f));
  });
  test('a conflict anywhere in run undo prevents every compensating append', async () => {
    const f = setup();
    for (const n of [1, 2]) passed(await f.execute('node.update', { id: nodeId(n), patch: { title: `Run edit ${n}` } }, { runId: 'synthetic:conflict-run' }));
    await f.execute('node.update', { id: nodeId(1), patch: { title: 'Later user edit' } });
    const before = f.domain.getSnapshot(); const count = f.writes.length;
    denied(await f.execute('run.undo', { runId: 'synthetic:conflict-run' }), 'STALE_BASE');
    expect(f.writes).toHaveLength(count); expect(f.domain.getSnapshot()).toEqual(before);
  });
  test('MCP retry rechecks every event in a saved run-undo batch', async () => {
    const f = setup();
    for (const n of [1, 12]) passed(await f.execute('node.update', { id: nodeId(n), patch: { details: 'Run update' } }, { runId: 'synthetic:scope-run' }));
    passed(await f.execute('run.undo', { runId: 'synthetic:scope-run' }, { actor: 'mcp', idempotencyKey: 'synthetic:scope-undo' }));
    f.ports.mcp.initiativeIds = [getNode(f, 12).initiativeId];
    denied(await f.execute('run.undo', { runId: 'synthetic:scope-run' }, { actor: 'mcp', idempotencyKey: 'synthetic:scope-undo' }), 'POLICY_DENIED');
  });
  test('append failure neither changes state nor notifies subscribers', async () => {
    const f = setup(); const before = f.domain.getSnapshot(); const changes = [];
    f.domain.subscribe(change => changes.push(change)); f.failAppend();
    denied(await f.execute('node.setState', { id: nodeId(1), state: 'done' }), 'WORKSPACE_READ_ONLY');
    expect(f.domain.getSnapshot()).toEqual(before); expect(changes).toEqual([]);
  });
  test('commands serialize and subscriber exceptions cannot alter an acknowledged commit', async () => {
    const f = setup(); let notifications = 0;
    f.domain.subscribe(() => { throw new Error('synthetic listener'); }); f.domain.subscribe(() => { notifications++; });
    const [a, b] = await Promise.all([f.execute('node.update', { id: nodeId(1), patch: { title: 'A' } }), f.execute('node.update', { id: nodeId(1), patch: { title: 'B' } })]);
    passed(a); passed(b); expect(b.ops.find(op => op.field === 'title').baseEventId).toBe(a.eventId); expect(notifications).toBe(2);
  });
});

describe('policy at the write boundary', () => {
  test('AI cannot activate, invent Tasks, bypass connector scope or change ingestion device', async () => {
    const f = setup(); const evidenceRefs = [{ sourceId: state(f).sources[0].id }];
    for (const [name, args, actor] of [['initiative.approve', { id: id('01', 2) }, 'ai'], ['node.create', catalogCases['node.create'](f), 'ai'], ['node.setState', { id: nodeId(1), state: 'done' }, 'connector'], ['settings.setIngestionDevice', { ingestionDeviceId: id('0d', 2) }, 'ai']]) {
      denied(await f.execute(name, args, { actor, evidenceRefs }), 'POLICY_DENIED');
    }
    expect(f.writes).toEqual([]);
  });
  test('AI creation requires a trusted match and evidence-backed user assertion', async () => {
    const f = setup(); const args = catalogCases['node.create'](f); const sourceId = state(f).sources[0].id;
    f.ports.reconciliationProof = () => ({ match: { attempted: true, matchedId: null }, commitmentAssertion: { id: nextRecordId('05'), target: { kind: 'node', id: NEW }, predicate: 'user_commitment', value: { speakerEntityId: f.ports.userEntityId, unambiguous: true }, certainty: 'explicit', status: 'applied', observedAt: f.ports.now(), evidenceRefs: [{ sourceId }] } });
    const created = passed(await f.execute('node.create', args, { actor: 'ai', evidenceRefs: [{ sourceId }] }));
    expect(state(f).nodes.find(n => n.id === NEW)).toBeTruthy();
    passed(await f.execute('change.undo', { eventId: created.eventId }));
    expect(state(f).rejections).toContainEqual(expect.objectContaining({ signature: suggestionSignature({ name: 'node.create', args }) }));
    denied(await f.execute('node.create', args, { actor: 'ai', evidenceRefs: [{ sourceId }] }), 'POLICY_DENIED');
  });
  test('manual edge protection persists across replay and can be explicitly cleared', async () => {
    const f = setup(); const edgeId = state(f).edges[0].id; const sourceId = state(f).sources[0].id;
    passed(await f.execute('edge.update', { id: edgeId, patch: { label: 'Manual label' } }));
    const restarted = new Domain(f.snapshot, f.writes, f.ports);
    const suggestion = passed(await restarted.execute({ name: 'edge.update', args: { id: edgeId, patch: { label: 'AI label' } }, actor: 'ai', evidenceRefs: [{ sourceId }] }));
    expect(suggestion.suggestedAssertionIds).toHaveLength(1);
    expect(restarted.getSnapshot().state.edges[0].label).toBe('Manual label');
    passed(await restarted.execute({ name: 'field.unprotect', args: { target: { kind: 'edge', id: edgeId }, field: 'label' }, actor: 'user' }));
    passed(await restarted.execute({ name: 'edge.update', args: { id: edgeId, patch: { label: 'AI label' } }, actor: 'ai', evidenceRefs: [{ sourceId }] }));
  });
  test('scope applies to question resolution children and cross-initiative edges', async () => {
    const f = setup({ mcp: { enabled: true, readOnly: false, initiativeIds: [id('01')] } });
    denied(await f.execute('edge.create', { record: { ...state(f).edges[0], id: nextRecordId('03'), fromId: nodeId(6), toId: nodeId(11), type: 'depends_on' } }, { actor: 'mcp' }), 'POLICY_DENIED');
    denied(await f.execute('settings.setDefaultCachePolicy', { defaultCachePolicy: 'none' }, { actor: 'mcp' }), 'POLICY_DENIED');
  });
  test('invalid fields and schema violations leave no writes', async () => {
    const f = setup();
    for (const [name, args] of [['node.update', { id: nodeId(1), patch: { owner: 'external' } }], ['node.create', { record: { ...getNode(f, 1), id: NEW, owner: 'external' } }], ['initiative.setMoscow', { id: id('01'), moscow: 'must_have' }], ['node.setState', { id: nodeId(1), state: 'blocked' }], ['unknown.run', {}]]) denied(await f.execute(name, args), 'VALIDATION_FAILED');
    expect(f.writes).toEqual([]);
  });
  test('protected AI updates become evidence-backed suggestions with one material question', async () => {
    const f = setup(); const sourceId = state(f).sources[0].id; const original = state(f).initiatives[0].moscow;
    const result = passed(await f.execute('initiative.setMoscow', { id: id('01'), moscow: 'wont_do' }, { actor: 'ai', evidenceRefs: [{ sourceId }] }));
    expect(state(f).initiatives[0].moscow).toBe(original);
    expect(result.suggestedAssertionIds).toHaveLength(1);
    expect(state(f).assertions.find(a => a.id === result.suggestedAssertionIds[0])).toMatchObject({ status: 'suggested', value: 'wont_do' });
    expect(result.raisedQuestionIds).toHaveLength(1);
  });
  test('schema validation precedes protected-field suggestions', async () => {
    const f = setup();
    denied(await f.execute('initiative.setMoscow', { id: id('01'), moscow: 'must_have' }, { actor: 'ai', evidenceRefs: [{ sourceId: state(f).sources[0].id }] }), 'VALIDATION_FAILED');
    expect(f.writes).toEqual([]);
  });
  test('scoped MCP can protect an edge without adding a persisted field', async () => {
    const f = setup({ mcp: { enabled: true, readOnly: false, initiativeIds: [id('01')] } });
    const edgeId = state(f).edges[0].id;
    passed(await f.execute('field.protect', { target: { kind: 'edge', id: edgeId }, field: 'label' }, { actor: 'mcp' }));
    const suggestion = passed(await f.execute('edge.update', { id: edgeId, patch: { label: 'Suggested label' } }, { actor: 'ai', evidenceRefs: [{ sourceId: state(f).sources[0].id }] }));
    expect(suggestion.suggestedAssertionIds).toHaveLength(1);
  });
  test('undo restores explicit edge protection even when the original event had no ops', async () => {
    const f = setup(); const edgeId = state(f).edges[0].id;
    await f.execute('field.protect', { target: { kind: 'edge', id: edgeId }, field: 'label' });
    const unprotect = passed(await f.execute('field.unprotect', { target: { kind: 'edge', id: edgeId }, field: 'label' }));
    passed(await f.execute('change.undo', { eventId: unprotect.eventId }));
    const suggestion = passed(await f.execute('edge.update', { id: edgeId, patch: { label: 'Proposed' } }, { actor: 'ai', evidenceRefs: [{ sourceId: state(f).sources[0].id }] }));
    expect(suggestion.suggestedAssertionIds).toHaveLength(1);
  });
  test('AI cannot delete an object to evade its protected fields', async () => {
    const f = setup(); await f.execute('node.update', { id: nodeId(1), patch: { title: 'Manual title' } });
    const result = await f.execute('node.delete', { id: nodeId(1) }, { actor: 'ai', evidenceRefs: [{ sourceId: state(f).sources[0].id }] });
    denied(result, 'PROTECTED_FIELD'); expect(getNode(f, 1).title).toBe('Manual title');
  });
  test('deleting an edge also removes and restores its contextual attachments', async () => {
    const f = setup(); const edgeId = state(f).edges[0].id;
    const question = { ...state(f).questions[0], id: nextRecordId('06'), dedupeKey: 'synthetic:edge-question', target: { kind: 'edge', id: edgeId }, initiativeId: state(f).edges[0].initiativeId };
    await f.execute('question.raise', { record: question });
    const deletion = passed(await f.execute('edge.delete', { id: edgeId }));
    expect(state(f).questions.some(q => q.id === question.id)).toBe(false);
    passed(await f.execute('change.undo', { eventId: deletion.eventId })); expect(state(f).questions.some(q => q.id === question.id)).toBe(true);
  });
  test('clearing a setting replays with the same optional-null semantics', async () => {
    const f = setup(); passed(await f.execute('settings.setIngestionDevice', { ingestionDeviceId: null }));
    expect(state(f).settings).not.toHaveProperty('ingestionDeviceId');
    expect(toStateDocument(fold(f.writes, { base: fromStateDocument(f.snapshot.state) }).state)).toEqual(state(f));
  });
  test('nullable MoSCoW is retained while optional null clears a field', async () => {
    const f = setup(); passed(await f.execute('initiative.setMoscow', { id: id('01'), moscow: null }));
    expect(state(f).initiatives[0].moscow).toBeNull();
    passed(await f.execute('node.update', { id: nodeId(1), patch: { details: null } })); expect(getNode(f, 1)).not.toHaveProperty('details');
    expect(toStateDocument(fold(f.writes, { base: fromStateDocument(f.snapshot.state) }).state)).toEqual(state(f));
  });
});
