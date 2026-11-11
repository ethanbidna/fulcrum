import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCase } from '../../spikes/s2/experiments/qwen35-holdout.mjs';

const promise = 'I will wrap the spare jig.';
const fixture = { id: 'synthetic', stratum: 'attribution', speaker: 'user', text: promise, injection: false,
  expected: [{ kind: 'user_commitment', quote: promise, text: 'wrap the spare jig' }] };
const reply = value => ({ message: { content: JSON.stringify(value) } });

test('Qwen3.5 payload calls follow the predicted kind even when it differs from the reference', async () => {
  const requested = [];
  const result = await evaluateCase(fixture, async (_item, kind) => {
    requested.push(kind);
    if (!kind) return reply({ kinds: ['external_commitment'] });
    return reply({ candidates: [{ quote: promise, who: 'colleague-a', text: 'wrap the spare jig' }] });
  });
  assert.deepEqual(requested, [undefined, 'external_commitment']);
  assert.equal(result.score.falsePositive, 1);
  assert.equal(result.score.falseNegative, 1);
  assert.equal(result.exact, false);
});

test('Qwen3.5 distinguishes empty valid routing, malformed routing and missing payloads', async () => {
  const negative = { ...fixture, expected: [] };
  const abstained = await evaluateCase(negative, async () => reply({ kinds: [] }));
  assert.equal(abstained.exact, true);

  const malformed = await evaluateCase(negative, async () => reply({ kinds: ['unsupported'] }));
  assert.equal(malformed.complete, true);
  assert.equal(malformed.routing.valid, false);
  assert.equal(malformed.exact, false);

  const interrupted = await evaluateCase(fixture, async (_item, kind) => kind ? null : reply({ kinds: ['user_commitment'] }));
  assert.equal(interrupted.complete, false);
  assert.equal(interrupted.exact, false);
});

test('Qwen3.5 rejects an ungrounded extra candidate even if the remaining candidate matches', async () => {
  const result = await evaluateCase(fixture, async (_item, kind) => kind
    ? reply({ candidates: [{ quote: promise, text: 'wrap the spare jig' }, { quote: 'Invented quote.', text: 'replace the jig' }] })
    : reply({ kinds: ['user_commitment'] }));
  assert.equal(result.score.truePositive, 1);
  assert.equal(result.payloads[0].rejected, 1);
  assert.equal(result.exact, false);
});
