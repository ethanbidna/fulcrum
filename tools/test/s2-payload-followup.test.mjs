import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingProbeItems } from '../../spikes/s2/experiments/payload-followup.mjs';

test('follow-up runs only unfinished probes and keeps original failures', () => {
  const items = [{ id: 's2-001' }, { id: 's2-005' }, { id: 's2-006' }];
  const rows = [{ model: 'local', id: 's2-001', completion: 'complete' }, { model: 'local', id: 's2-005', completion: 'budget-exhausted' }];
  assert.deepEqual(pendingProbeItems('local', [1, 5], items, rows), [items[1]]);
  assert.deepEqual(pendingProbeItems('other', [1, 5], items, rows), items.slice(0, 2));
  assert.equal(rows[1].completion, 'budget-exhausted');
});
