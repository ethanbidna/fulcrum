import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLatencyVariants, decodeStreamLines } from '../../spikes/s2/experiments/llama-latency.mjs';

test('latency variants retain the original request except declared controls', () => {
  const request = { model: 'local', stream: false, system: 'same', prompt: 'same', format: { type: 'object' }, options: { num_thread: 2, num_predict: 1024, seed: 42, num_ctx: 4096, temperature: 0 } };
  const variants = buildLatencyVariants(request);
  assert.deepEqual(variants[1].request, { ...request, stream: true, options: { ...request.options, num_predict: 1 } });
  assert.deepEqual(variants[2].request, { ...request, stream: true });
  assert.deepEqual(variants[3].request, { ...request, stream: true, options: { ...request.options, num_thread: 4 } });
  assert.equal(request.stream, false);
});

test('stream decoder retains partial JSON lines across chunks', () => {
  const first = decodeStreamLines('', '{"response":"🌱"}\n{"done":');
  assert.deepEqual(first.events, [{ response: '🌱' }]);
  assert.equal(first.pending, '{"done":');
  assert.deepEqual(decodeStreamLines(first.pending, 'true}\n').events, [{ done: true }]);
});
