import { expect, test } from 'vitest';
import { Domain } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
function fixture() {
  const snapshot = readJson('fixtures/states/portfolio.state.json'); const validators = loadValidators(); let seq = 0; let id = 9100; let writes = 0;
  const domain = new Domain(snapshot, [], { newId: () => `09000000-0000-7000-8000-${String(id++).padStart(12,'0')}`, now: () => '2026-11-09T14:00:00Z', deviceId: snapshot.state.devices[0].id, userEntityId: '08000000-0000-7000-8000-000000000002', validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors, validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors, commit: async drafts => { writes++; return drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794232800000-${String(seq).padStart(4,'0')}` })); } });
  return { domain, snapshot, writes: () => writes };
}
test('approved multi-command plans preview without writes, apply atomically and undo as one event', async () => {
  const { domain, snapshot, writes } = fixture(); const [first,second] = snapshot.state.nodes;
  const command = { name: 'command.apply', actor: 'user', args: { commands: [{ name: 'node.update', args: { id: first.id, patch: { title: 'Synthetic first edit' } } }, { name: 'node.update', args: { id: second.id, patch: { title: 'Synthetic second edit' } } }] } };
  expect(domain.preview(command).ops.length).toBeGreaterThan(0); expect(writes()).toBe(0); expect((await domain.query('node.get',{id:first.id})).title).toBe(first.title);
  const result = await domain.execute(command); expect(result.ok).toBe(true); expect(writes()).toBe(1);
  expect((await domain.execute({ name: 'change.undo', actor: 'user', args: { eventId: result.eventId } })).ok).toBe(true); expect((await domain.query('node.get',{id:first.id})).title).toBe(first.title);
});
test('invalid or autonomous plans cannot partially mutate canonical state', async () => {
  const { domain, snapshot, writes } = fixture(); const node = snapshot.state.nodes[0];
  const commands = [{ name: 'node.update', args: { id: node.id, patch: { title: 'Must not persist' } } }, { name: 'node.setState', args: { id: node.id, state: 'impossible' } }];
  expect((await domain.execute({ name: 'command.apply', actor: 'user', args: { commands } })).ok).toBe(false); expect(writes()).toBe(0); expect((await domain.query('node.get',{id:node.id})).title).toBe(node.title);
  expect((await domain.execute({ name: 'command.apply', actor: 'ai', args: { commands: commands.slice(0,1) } })).ok).toBe(false);
});
