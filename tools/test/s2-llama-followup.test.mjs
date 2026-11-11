import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoveredProbeRequest, failedLlamaProbes } from '../../spikes/s2/experiments/llama-probe-followup.mjs';

test('recovered probe changes only threads and residency', () => {
  const original = { model: 'llama3.1:8b-instruct-q4_K_M', stream: false, prompt: 'same', system: 'same', format: {}, keep_alive: '5m', options: { num_thread: 2, num_predict: 1024, temperature: 0, seed: 42 } };
  assert.deepEqual(buildRecoveredProbeRequest(original), { ...original, keep_alive: '15m', options: { ...original.options, num_thread: 4 } });
  assert.equal(original.options.num_thread, 2);
});

test('follow-up targets failed full 8B probes without repeating successful work', () => {
  const row = { model: 'llama3.1:8b-instruct-q4_K_M', phase: 'full', error: 'timeout' };
  assert.deepEqual(failedLlamaProbes([row, { ...row, error: null }, { ...row, phase: 'payload' }, { ...row, model: 'other' }]), [row]);
});
