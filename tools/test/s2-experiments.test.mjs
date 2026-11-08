import assert from 'node:assert/strict';
import test from 'node:test';
import { alignQuote, scoreKinds, buildRequest, normalizeExtraction, CLASSIFIERS } from '../../spikes/s2/experiments/configurations.mjs';
import { rankConfigurations } from '../../spikes/s2/experiments/run.mjs';
import { HOLDOUT } from '../../spikes/s2/experiments/holdout.mjs';
import { summarizeClassification } from '../../spikes/s2/experiments/analyze.mjs';
import { buildSingleRequest, decodeSingle } from '../../spikes/s2/experiments/single-label.mjs';

test('quote grounding derives UTF-16 offsets and rejects ambiguity', () => {
  assert.deepEqual(alignQuote('🌱 Intro. I will send it.', 'I will send it.'), { start: 10, end: 25 });
  assert.equal(alignQuote('Same. Same.', 'Same.'), null);
  assert.equal(alignQuote('Real text.', 'Invented text.'), null);
  assert.equal(alignQuote('Real text.', ''), null);
});

test('classification counts false facts, omissions and invalid responses', () => {
  const item = { expected: [{ kind: 'user_commitment' }] };
  assert.deepEqual(scoreKinds(item, '{"kinds":["user_commitment"]}'), { valid: true, exact: true, tp: 1, fp: 0, fn: 0 });
  assert.equal(scoreKinds({ expected: [] }, '{"kinds":["external_commitment"]}').fp, 1);
  assert.equal(scoreKinds(item, '{"kinds":[]}').fn, 1);
  for (const raw of ['bad', '{"kinds":["tool"]}', '{"kinds":["user_commitment","user_commitment"]}', '{"kinds":[],"command":"x"}']) {
    assert.equal(scoreKinds(item, raw).valid, false);
    assert.equal(scoreKinds(item, raw).exact, false);
  }
});

test('prompts never contain item gold; controlled variants differ as declared', () => {
  const item = { speaker: 'user', text: 'Input.', expected: [{ secret: 'GOLD-SECRET' }] };
  const zero = buildRequest('model', CLASSIFIERS[0], item);
  const few = buildRequest('model', CLASSIFIERS[1], item);
  assert.equal(JSON.stringify(few).includes('GOLD-SECRET'), false);
  assert.equal(few.options.temperature, zero.options.temperature);
  assert.equal(few.format, zero.format);
  assert.notEqual(few.system, zero.system);
  const json = buildRequest('model', CLASSIFIERS[2], item);
  assert.equal(json.system, few.system);
  assert.equal(json.format, 'json');
  const free = buildRequest('model', CLASSIFIERS[3], item);
  assert.equal(free.system, few.system);
  assert.equal(free.format, undefined);
});

test('grounded extraction rejects unsupported fields and derives spans', () => {
  const item = { speaker: 'user', text: 'I will send it.' };
  const raw = { candidates: [{ quote: item.text, text: 'send it' }] };
  const result = normalizeExtraction(item, 'user_commitment', raw);
  assert.deepEqual(result.candidates[0].span, { start: 0, end: 15 });
  assert.equal(result.candidates[0].kind, 'user_commitment');
  assert.equal(normalizeExtraction(item, 'user_commitment', { candidates: [{ ...raw.candidates[0], dueHint: '2099-01-01' }] }).rejected, 1);
  assert.equal(normalizeExtraction(item, 'user_commitment', { candidates: [{ ...raw.candidates[0], quote: 'Fake' }] }).rejected, 1);
});

test('selection uses exact classification and breaks ties by false facts', () => {
  const configs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const rows = [
    { config: 'a', score: { exact: false, valid: true, fp: 1, fn: 0 } },
    { config: 'b', score: { exact: false, valid: true, fp: 0, fn: 1 } },
    { config: 'c', score: { exact: true, valid: true, fp: 0, fn: 0 } },
  ];
  assert.deepEqual(rankConfigurations(rows, configs).map(row => row.config.id), ['c', 'b', 'a']);
});

test('holdout has diverse unique cases and valid annotated spans', () => {
  assert.equal(HOLDOUT.length, 64);
  assert.equal(new Set(HOLDOUT.map(item => item.id)).size, 64);
  assert.equal(new Set(HOLDOUT.map(item => item.text)).size, 62); // Two identity counterfactual pairs.
  assert.equal(HOLDOUT.filter(item => item.injection).length, 8);
  for (const item of HOLDOUT) for (const expected of item.expected) {
    assert.ok(expected.span.start >= 0);
    assert.ok(expected.span.end <= item.text.length);
    assert.ok(expected.span.start < expected.span.end);
  }
});

test('classification summaries keep invalid empty output out of negative passes', () => {
  const items = new Map([
    ['p', { expected: [{ kind: 'user_commitment' }], injection: false }],
    ['n', { expected: [], injection: false }],
    ['a', { expected: [], injection: true }],
  ]);
  const rows = [
    { id: 'p', seconds: 1, score: { valid: true, exact: true, tp: 1, fp: 0, fn: 0 } },
    { id: 'n', seconds: 2, score: { valid: false, exact: false, tp: 0, fp: 0, fn: 0 } },
    { id: 'a', seconds: 3, score: { valid: true, exact: false, tp: 0, fp: 1, fn: 0 } },
  ];
  const summary = summarizeClassification(rows, items);
  assert.equal(summary.exact, 1);
  assert.equal(summary.negativePass, 0);
  assert.equal(summary.attackPass, 0);
  assert.equal(summary.precision, 0.5);
  assert.equal(summary.recall, 1);
  assert.equal(summary.medianSeconds, 2);
});

test('single-label diagnostic distinguishes absence from invalid output', () => {
  assert.deepEqual(decodeSingle('{"kind":"none"}'), { kinds: [] });
  assert.deepEqual(decodeSingle('{"kind":"decision_made"}'), { kinds: ['decision_made'] });
  assert.equal(decodeSingle('{"kind":"none","command":"delete"}'), null);
  assert.equal(decodeSingle('{"kind":"unknown"}'), null);
  const body = buildSingleRequest('model', { speaker: 'user', text: 'Input.', expected: [{ secret: 'GOLD-SECRET' }] });
  assert.equal(JSON.stringify(body).includes('GOLD-SECRET'), false);
  assert.equal(body.options.num_predict, 32);
  assert.ok(body.system.includes('none'));
});
