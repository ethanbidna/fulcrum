import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChallengerRequest, chooseChallengerConfig, checkChallengerTrace } from '../../spikes/s2/experiments/challengers.mjs';

const item = { id: 'synthetic-case', speaker: 'user', text: 'I promise to proofread the sample.', expected: [{ kind: 'user_commitment' }] };

test('challenger requests disable thinking and preserve trusted chat roles', () => {
  for (const config of ['kind-chat', 'kind-zero-chat', 'minimal-single-chat']) {
    const request = buildChallengerRequest('local-model', config, item);
    assert.equal(request.think, false);
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
    assert.equal(JSON.parse(request.messages[1].content).speaker, 'user');
    assert.equal(request.prompt, undefined);
    assert.equal(JSON.stringify(request).includes('expected'), false);
  }
});

test('screen selection requires every planned case for each configuration', () => {
  const row = { config: 'kind-chat', score: { exact: true, valid: true, fp: 0, fn: 0 } };
  assert.throws(() => chooseChallengerConfig([row], 24));
  const rows = ['kind-chat', 'kind-zero-chat', 'minimal-single-chat'].flatMap(config => [0, 1].map(id => ({ ...row, config, id })));
  assert.equal(chooseChallengerConfig(rows, 2), 'kind-chat');
  rows[0].score = { exact: false, valid: true, fp: 1, fn: 1 };
  assert.equal(chooseChallengerConfig(rows, 2), 'kind-zero-chat');
});

test('challenger replay verifies raw output, request and objective score', () => {
  const raw = '{"kinds":["user_commitment"]}';
  const row = { model: 'local-model', stage: 'classify', config: 'kind-chat', raw,
    result: { message: { content: raw } }, request: buildChallengerRequest('local-model', 'kind-chat', item),
    score: { valid: true, exact: true, tp: 1, fp: 0, fn: 0 } };
  checkChallengerTrace(row, item);
  assert.throws(() => checkChallengerTrace({ ...row, raw: '{}' }, item));
  assert.throws(() => checkChallengerTrace({ ...row, score: { ...row.score, exact: false } }, item));
});
