import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildChallengerRequest } from '../../spikes/s2/experiments/challengers.mjs';
import { alignQuote, EXAMPLES, KINDS } from '../../spikes/s2/experiments/configurations.mjs';
import { HOLDOUT } from '../../spikes/s2/experiments/holdout.mjs';
import { validateOutput } from '../../spikes/s2/evaluate.mjs';

const CASES_PER_GROUP = 4;
const MODEL = 'qwen3.5:4b';
const CONFIGURATION = 'kind-chat';
const GROUPS = ['attribution', 'relationships', 'state', 'multiple-facts', 'source-instructions', 'evidence'];
const readCases = name => JSON.parse(readFileSync(new URL(`../../spikes/s2/eval/${name}.json`, import.meta.url), 'utf8'));
const cases = readCases('qwen35-holdout');

test('Qwen3.5 holdout covers six groups and eight candidate kinds with fresh source text', () => {
  assert.equal(new Set(cases.map(item => item.id)).size, GROUPS.length * CASES_PER_GROUP);
  assert.equal(cases.length, GROUPS.length * CASES_PER_GROUP);
  for (const group of GROUPS) assert.equal(cases.filter(item => item.stratum === group).length, CASES_PER_GROUP);
  assert.deepEqual(new Set(cases.flatMap(item => item.expected.map(candidate => candidate.kind))), new Set(KINDS));
  const priorText = new Set([...readCases('items'), ...HOLDOUT].map(item => item.text));
  for (const example of EXAMPLES) priorText.add(example.input.sourceText);
  for (const item of cases) assert.ok(!priorText.has(item.text), item.id);
});

test('Qwen3.5 reference quotes give valid UTF-16 spans and output shapes', () => {
  for (const item of cases) {
    const candidates = item.expected.map(({ quote, ...fields }) => {
      const span = alignQuote(item.text, quote);
      assert.ok(span, item.id);
      assert.equal(item.text.slice(span.start, span.end), quote, item.id);
      return { ...fields, span };
    });
    assert.ok(validateOutput({ candidates }, item.text), item.id);
  }
});

test('Qwen3.5 holdout requests contain source input without reference labels', () => {
  for (const item of cases) {
    const requests = [undefined, ...KINDS].map(kind => buildChallengerRequest(MODEL, CONFIGURATION, item, kind));
    for (const request of requests) {
      assert.equal(request.think, false);
      assert.deepEqual(JSON.parse(request.messages.at(-1).content), {
        userIdentity: 'user', speaker: item.speaker, sourceText: item.text,
      });
    }
  }
});
