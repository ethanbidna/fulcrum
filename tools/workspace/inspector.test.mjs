import { expect, test } from 'vitest';
import { Domain, projectInspection } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
const fixture = () => readJson('fixtures/states/portfolio.state.json');
function setup() {
  const snapshot = fixture(); const validators = loadValidators(); let seq = 0; let id = 9000;
  const domain = new Domain(snapshot, [], { newId: () => `09000000-0000-7000-8000-${String(id++).padStart(12, '0')}`, now: () => '2026-11-08T20:00:00Z', deviceId: snapshot.state.devices[0].id, userEntityId: '08000000-0000-7000-8000-000000000002', validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors, validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors, commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794168000000-${String(seq).padStart(4, '0')}` })) });
  return { domain, state: snapshot.state, execute: (name, args) => domain.execute({ name, args, actor: 'user' }) };
}
test('inspection returns only exact contextual questions and distinct attached sources', () => {
  const { state } = fixture(); const question = state.questions.find(question => question.target.kind === 'edge');
  const target = question.target; const edge = state.edges.find(edge => edge.id === target.id);
  edge.evidenceRefs = [edge.evidenceRefs?.[0] ?? { sourceId: state.sources[0].id }, edge.evidenceRefs?.[0] ?? { sourceId: state.sources[0].id }];
  const result = projectInspection(state, target); expect(result.kind).toBe('edge'); expect(result.evidenceCount).toBe(1); expect(result.questions.map(item => item.id)).toEqual([question.id]);
  expect(projectInspection(state, { kind: 'node', id: edge.fromId }).questions).not.toContainEqual(expect.objectContaining({ id: question.id }));
});
test('focused edit is immediately canonical and child completion never completes its parent', async () => {
  const { state, domain, execute } = setup(); const edge = state.edges.find(edge => edge.type === 'contains');
  const parent = state.nodes.find(node => node.id === edge.fromId); const child = state.nodes.find(node => node.id === edge.toId);
  const focused = await domain.query('graph.focus', { nodeId: parent.id }); expect(focused.nodes.map(node => node.id)).toContain(child.id);
  const changed = await execute('node.update', { id: child.id, patch: { title: 'Focused synthetic edit' } }); expect(changed.ok).toBe(true);
  expect((await domain.query('graph.get', { initiativeId: parent.initiativeId })).nodes.find(node => node.id === child.id).title).toBe('Focused synthetic edit');
  const inspection = await domain.query('inspector.get', { target: { kind: 'node', id: parent.id } }); expect(inspection.children.find(node => node.id === child.id).title).toBe('Focused synthetic edit');
  expect((await execute('node.setState', { id: child.id, state: 'done' })).ok).toBe(true);
  expect((await domain.query('node.get', { id: parent.id })).state).toBe(parent.state);
  expect((await execute('change.undo', { eventId: changed.eventId })).ok).toBe(true);
});
test('typed inspector query is detached and rejects invalid targets without writes', async () => {
  const { domain, state } = setup(); const target = { kind: 'node', id: state.nodes[0].id };
  const result = await domain.query('inspector.get', { target }); result.record.title = 'Mutation';
  expect((await domain.query('inspector.get', { target })).record.title).toBe(state.nodes[0].title);
  await expect(domain.query('inspector.get', { target: { kind: 'source', id: state.sources[0].id } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(domain.query('inspector.get', {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(domain.history()).toEqual([]);
});
