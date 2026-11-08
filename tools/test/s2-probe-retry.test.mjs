import assert from 'node:assert/strict';
import test from 'node:test';
import { selectFailedProbes } from '../../spikes/s2/experiments/retry-probe.mjs';

test('probe recovery selects failed full probes without changing requests', () => {
  const failed = { model: 'synthetic', phase: 'full', id: 'sample', config: 'full-schema-text', request: { marker: 'unchanged' }, error: 'fetch failed' };
  const rows = [failed, { ...failed, error: null }, { ...failed, phase: 'payload' }];
  assert.deepEqual(selectFailedProbes(rows, []), [failed]);
  assert.deepEqual(selectFailedProbes(rows, [{ originalKey: 'synthetic/full-schema-text/sample' }]), []);
  assert.equal(rows[0].request.marker, 'unchanged');
});
