import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { auditReport } from '../../spikes/s2/review.mjs';
import { scoreItem, summarize, OUTPUT_SCHEMA } from '../../spikes/s2/evaluate.mjs';
import { SYSTEM, GENERATION_OPTIONS } from '../../spikes/s2/ollama.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const item = { id: 'synthetic-review', text: 'I will review.', speaker: 'user', injection: false,
    expected: [{ kind: 'user_commitment', span: { start: 0, end: 14 } }] };
  const dataset = JSON.stringify([item]);
  const response = JSON.stringify({ candidates: [{ kind: 'user_commitment', text: item.text, span: { start: 0, end: 14 } }] });
  const score = scoreItem(item, response);
  const report = { datasetSha256: hash(dataset), schemaSha256: hash(JSON.stringify(OUTPUT_SCHEMA)), systemPromptSha256: hash(SYSTEM), generationOptions: GENERATION_OPTIONS,
    models: [{ model: 'synthetic', status: 'completed', rows: [{ id: item.id, attempts: [{ response, score }], initial: score, final: score }], initial: summarize([score]), afterRepair: summarize([score]) }] };
  return { report, dataset };
}

test('S2 review rejects changed inputs, duplicate/missing rows and tampered scores', () => {
  const { report, dataset } = fixture();
  assert.equal(auditReport(report, dataset).models[0].allStoredScoresReproduced, true);
  const altered = structuredClone(report); altered.models[0].rows[0].final.truePositive = 0;
  assert.throws(() => auditReport(altered, dataset), /Stored score mismatch/);
  const missing = structuredClone(report); missing.models[0].rows = [];
  assert.throws(() => auditReport(missing, dataset), /Incomplete/);
  assert.throws(() => auditReport(report, `${dataset} `), /configuration/);
  const duplicate = JSON.parse(dataset); duplicate.push(duplicate[0]);
  assert.throws(() => auditReport(report, JSON.stringify(duplicate)), /Duplicate/);
});

test('S2 review checks UTF-16 gold bounds before trusting reference matches', () => {
  const { report, dataset } = fixture();
  const items = JSON.parse(dataset); items[0].expected[0].span.end = 200;
  assert.throws(() => auditReport(report, JSON.stringify(items)), /Invalid gold span/);
});

test('S2 committed real run scores reproduce from all saved attempts', () => {
  const dataset = readFileSync(new URL('../../spikes/s2/eval/items.json', import.meta.url), 'utf8');
  for (const model of ['3b', '8b']) {
    const report = JSON.parse(readFileSync(new URL(`../../docs/spikes/S2-results/intel-${model}.json`, import.meta.url), 'utf8'));
    const audit = auditReport(report, dataset);
    assert.equal(audit.models[0].items, 48);
    assert.equal(audit.models[0].negativeItems, 8);
    assert.equal(audit.models[0].attackItems, 8);
    assert.equal(audit.models[0].allStoredScoresReproduced, true);
  }
});
