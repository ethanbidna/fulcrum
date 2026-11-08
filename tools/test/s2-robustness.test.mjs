import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildStressCases, deriveItem, seedRequest, completedPass, modelBudget, auditTrace } from '../../spikes/s2/experiments/robustness.mjs';
import { buildRequest, CLASSIFIERS, scoreKinds } from '../../spikes/s2/experiments/configurations.mjs';

const items = JSON.parse(await readFile(new URL('../../spikes/s2/eval/items.json', import.meta.url), 'utf8'));

test('context augmentation shifts gold spans in UTF-16 without changing facts', () => {
  const original = items[0];
  const prefix = '🌱\n';
  const derived = deriveItem(original, { prefix, suffix: '\nExtra context.' });
  assert.equal(derived.expected[0].span.start, prefix.length);
  assert.equal(derived.text.slice(derived.expected[0].span.start, derived.expected[0].span.end), original.text);
  assert.deepEqual(original.expected[0].span, { start: 0, end: 29 });
});

test('stress set covers all kinds, paired identity and multiple facts', () => {
  const stress = buildStressCases(items);
  assert.equal(stress.length, 24);
  assert.equal(new Set(stress.map(item => item.id)).size, 24);
  assert.equal(new Set(stress.map(item => `${item.speaker}/${item.text}`)).size, 24);
  const kinds = new Set(stress.flatMap(item => item.expected.map(candidate => candidate.kind)));
  assert.equal(kinds.size, 8);
  const paired = stress.filter(item => item.family === 'speaker-counterfactual');
  assert.equal(paired[0].text, paired[1].text);
  assert.equal(paired[0].expected[0].kind, 'user_commitment');
  assert.equal(paired[1].expected[0].kind, 'external_commitment');
  assert.equal(paired[1].expected[0].who, 'colleague-a');
  assert.equal(stress.filter(item => item.expected.length === 2).length, 4);
  assert.equal(stress.filter(item => item.injection).length, 2);
  for (const item of stress) for (const candidate of item.expected) {
    assert.ok(candidate.span.start >= 0 && candidate.span.end <= item.text.length);
    assert.ok(item.text.slice(candidate.span.start, candidate.span.end).length > 0);
  }
});

test('seed check changes only the seed and never includes gold labels', () => {
  const model = 'synthetic-local';
  const config = CLASSIFIERS.find(config => config.id === 'kind-sampled');
  const original = buildRequest(model, config, items[0]);
  const request = seedRequest(model, items[0], 7);
  assert.deepEqual(request, { ...original, options: { ...original.options, seed: 7 } });
  assert.equal(JSON.parse(request.prompt).expected, undefined);
});

test('budget cutoffs cannot turn partial results into passes', () => {
  const perfect = { falsePositive: 0, falseNegative: 0, schemaValid: true };
  assert.equal(completedPass({ completion: 'complete', classificationValid: true, score: perfect }), true);
  assert.equal(completedPass({ completion: 'budget-exhausted', classificationValid: true, score: perfect }), false);
  assert.equal(completedPass({ completion: 'complete', classificationValid: false, score: perfect }), false);
  const budget = modelBudget(1000, () => 1050, 100);
  assert.equal(budget.remaining(), 50);
  assert.equal(modelBudget(1000, () => 1200, 100).remaining(), 0);
});


test('offline replay rejects changed requests, raw outputs and scores', () => {
  const item = buildStressCases(items)[0];
  const config = CLASSIFIERS[0];
  const raw = '{"kinds":["user_commitment"]}';
  const row = { model: 'synthetic-local', stage: 'classify', id: item.id,
    request: buildRequest('synthetic-local', config, item), raw,
    result: { response: raw }, error: null, score: { } };
  assert.throws(() => auditTrace(row, item, config));
  row.score = scoreKinds(item, raw);
  auditTrace(row, item, config);
  assert.throws(() => auditTrace({ ...row, raw: '{}' }, item, config));
  assert.throws(() => auditTrace({ ...row, request: { ...row.request, prompt: 'altered' } }, item, config));
});
