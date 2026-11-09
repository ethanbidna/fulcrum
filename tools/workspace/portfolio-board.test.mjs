import { expect, test } from 'vitest';
import { Domain, projectBoard } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
const fixture = () => readJson('fixtures/states/portfolio.state.json');
const now = '2026-11-08T20:00:00Z';
test('board is one projection of active cards, facets and contextual question counts', () => {
  const snapshot = fixture(); const board = projectBoard(snapshot.state, [], { now });
  expect(board.cards).toHaveLength(4); expect(board.rail.questionCount).toBe(3);
  expect(board.cards.some(card => card.initiative.lifecycle !== 'active')).toBe(false);
  expect(board.categories.map(category => category.label)).toEqual(['Tooling', 'Governance', 'Research']);
  expect(board.teams.every(team => team.type === 'team')).toBe(true);
  expect(board.objectives).toHaveLength(3);
  expect(board.questionCounts[snapshot.state.initiatives[0].id]).toBe(1);
  const proposal = snapshot.state.initiatives.find(item => item.lifecycle === 'proposed');
  expect(board.questionCounts[proposal.id]).toBe(1);
});
test('typed board query is isolated and reflects acknowledged manual ranking', async () => {
  const snapshot = fixture(); const validators = loadValidators(); let seq = 0;
  const domain = new Domain(snapshot, [], { newId: () => '09000000-0000-7000-8000-000000009999', now: () => now,
    deviceId: snapshot.state.devices[0].id, userEntityId: snapshot.state.entities[1].id,
    validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors,
    validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors,
    commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794168000000-${String(seq).padStart(4, '0')}` })) });
  const board = await domain.query('portfolio.board', {}); board.categories[0].label = 'mutated';
  expect((await domain.query('portfolio.board', {})).categories[0].label).toBe('Tooling');
  const id = snapshot.state.initiatives[0].id;
  expect(await domain.execute({ name: 'initiative.rank', args: { id, manualRank: 'Zz' }, actor: 'user' })).toMatchObject({ ok: true });
  expect((await domain.query('portfolio.board', {})).cards.find(card => card.initiative.id === id).initiative.manualRank).toBe('Zz');
});
function commandDomain(options = {}) {
  const snapshot = fixture(); const validators = loadValidators(); let seq = 0; let id = 9000;
  const domain = new Domain(snapshot, [], { newId: () => `09000000-0000-7000-8000-${String(id++).padStart(12, '0')}`, now: () => now,
    deviceId: snapshot.state.devices[0].id, userEntityId: snapshot.state.entities[1].id,
    validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors,
    validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors,
    commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794168000000-${String(seq).padStart(4, '0')}` })), ...options });
  return { domain, snapshot };
}
test('rank batches reject partial invalid updates and undo as one change', async () => {
  const { domain, snapshot } = commandDomain(); const first = snapshot.state.initiatives[0]; const second = snapshot.state.initiatives[2];
  const invalid = await domain.execute({ name: 'initiative.rerank', args: { ranks: [{ id: first.id, manualRank: 'a1' }, { id: snapshot.state.initiatives[1].id, manualRank: 'a0' }] }, actor: 'user' });
  expect(invalid.ok).toBe(false); expect(domain.getSnapshot().state).toEqual(snapshot.state); expect(domain.history()).toHaveLength(0);
  const changed = await domain.execute({ name: 'initiative.rerank', args: { ranks: [{ id: first.id, manualRank: 'a1' }, { id: second.id, manualRank: 'a0' }] }, actor: 'user' });
  expect(changed.ok).toBe(true); expect(domain.history()).toHaveLength(1);
  expect((await domain.execute({ name: 'change.undo', args: { eventId: changed.eventId }, actor: 'user' })).ok).toBe(true);
  expect(domain.getSnapshot().state.initiatives.map(item => item.manualRank)).toEqual(snapshot.state.initiatives.map(item => item.manualRank));
});
test('rank batches retain MCP initiative scope checks', async () => {
  const first = fixture().state.initiatives[0];
  const { domain, snapshot } = commandDomain({ mcp: { enabled: true, readOnly: false, initiativeIds: [first.id] } });
  const result = await domain.execute({ name: 'initiative.rerank', args: { ranks: [{ id: first.id, manualRank: 'a1' }, { id: snapshot.state.initiatives[2].id, manualRank: 'a0' }] }, actor: 'mcp' });
  expect(result.ok).toBe(false); expect(domain.getSnapshot().state).toEqual(snapshot.state);
});

test('recent changes name nodes, question prompts and relationship direction', () => {
  const { state } = fixture();
  const node = state.nodes[0]; const question = state.questions[0]; const edge = state.edges.find(item => item.type === 'depends_on');
  const entries = [
    { kind: 'node', id: node.id, operation: 'set', field: 'state', before: 'todo', after: 'done' },
    { kind: 'question', id: question.id, operation: 'create', after: question },
    { kind: 'edge', id: edge.id, operation: 'create', after: edge },
  ].map((change, index) => ({ id: String(index), at: now, changes: [change] }));
  const contexts = projectBoard(state, entries, { now }).rail.meaningfulChanges.map(entry => entry.context);
  expect(contexts).toEqual([node.title, question.prompt,
    `${state.nodes.find(item => item.id === edge.fromId).title} depends on ${state.nodes.find(item => item.id === edge.toId).title}`]);
});
