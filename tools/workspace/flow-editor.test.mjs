import { expect, test } from 'vitest';
import { Domain } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
function setup() {
  const snapshot = readJson('fixtures/states/portfolio.state.json'); const validators = loadValidators(); let id = 9000; let seq = 0;
  const domain = new Domain(snapshot, [], { newId: () => `09000000-0000-7000-8000-${String(id++).padStart(12, '0')}`, now: () => '2026-11-08T20:00:00Z', deviceId: snapshot.state.devices[0].id, userEntityId: '08000000-0000-7000-8000-000000000002', validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors, validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors, commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794168000000-${String(seq).padStart(4, '0')}` })) });
  return { domain, snapshot, execute: (name, args) => domain.execute({ name, args, actor: 'user' }) };
}
test('invalid canvas relationship returns a human invariant message without changing the graph', async () => {
  const { snapshot, domain, execute } = setup(); const nodes = snapshot.state.nodes;
  const before = domain.getSnapshot();
  const task = nodes.find(node => node.type === 'task'); const dependency = nodes.find(node => node.type === 'dependency' && node.initiativeId === task.initiativeId);
  const result = await execute('edge.create', { record: { id: '03000000-0000-7000-8000-000000009999', fromId: task.id, toId: dependency.id, initiativeId: task.initiativeId, type: 'contains' } });
  expect(result).toMatchObject({ ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Contains relationships can only connect Tasks.', details: { invariant: 'CONTAINS_REQUIRES_TASKS' } } });
  expect(domain.getSnapshot()).toEqual(before);
});
test('canvas rename, create, typed connect and delete are durable commands with one-change undo', async () => {
  const { snapshot, domain, execute } = setup(); const initiativeId = snapshot.state.initiatives[0].id; const id = '02000000-0000-7000-8000-000000009999'; const edgeId = '03000000-0000-7000-8000-000000009999';
  expect((await execute('node.create', { record: { id, initiativeId, type: 'task', title: 'Synthetic action', state: 'open' } })).ok).toBe(true);
  expect((await execute('node.update', { id, patch: { title: 'Renamed action' } })).ok).toBe(true);
  expect((await execute('edge.create', { record: { id: edgeId, initiativeId, fromId: id, toId: snapshot.state.nodes[0].id, type: 'leads_to' } })).ok).toBe(true);
  const deleted = await execute('node.delete', { id }); expect(deleted.ok).toBe(true);
  expect((await domain.query('graph.get', { initiativeId })).edges.some(edge => edge.id === edgeId)).toBe(false);
  expect((await execute('change.undo', { eventId: deleted.eventId })).ok).toBe(true);
  const graph = await domain.query('graph.get', { initiativeId }); expect(graph.nodes.find(node => node.id === id).title).toBe('Renamed action'); expect(graph.edges.some(edge => edge.id === edgeId)).toBe(true);
});
