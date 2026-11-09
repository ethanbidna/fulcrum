import { expect, test } from 'vitest';
import { Domain } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
function setup() {
  const snapshot = readJson('fixtures/states/portfolio.state.json'); const validators = loadValidators(); let seq = 0;
  return { snapshot, domain: new Domain(snapshot, [], { newId: () => '09000000-0000-7000-8000-000000009001', now: () => '2026-11-09T13:00:00Z', deviceId: snapshot.state.devices[0].id, userEntityId: '08000000-0000-7000-8000-000000000002', mcp: { enabled: true, readOnly: false }, validateState: value => validators.workspaceState(value) ? [] : validators.workspaceState.errors, validateEvent: value => validators.changeEvent(value) ? [] : validators.changeEvent.errors, commit: async drafts => drafts.map(draft => ({ ...draft, seq: ++seq, hlc: `1794229200000-${String(seq).padStart(4, '0')}` })) }) };
}
test('explicit conversational intent produces the same operations and protections as a manual edit', async () => {
  const manual = setup(); const conversational = setup();
  const args = { id: manual.snapshot.state.nodes[0].id, patch: { title: 'Review synthetic plan' } };
  const first = await manual.domain.execute({ name: 'node.update', args, actor: 'user' });
  const second = await conversational.domain.execute({ name: 'node.update', args, actor: 'mcp' });
  expect(first.ok).toBe(true); expect(second.ok).toBe(true); expect(second.ops).toEqual(first.ops);
});
