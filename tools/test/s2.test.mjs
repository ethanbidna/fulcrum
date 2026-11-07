import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOutput, scoreItem, summarize } from '../../spikes/s2/evaluate.mjs';
import { OllamaRuntime } from '../../spikes/s2/ollama.mjs';
import { extractItem, runModel } from '../../spikes/s2/benchmark.mjs';
import { parseProcesses, parsePower } from '../../spikes/s2/resources.mjs';

const item = { text: 'I will send the draft.', expected: [{ kind: 'user_commitment', span: { start: 0, end: 22 } }], injection: false };
const commitment = { kind: 'user_commitment', text: item.text, span: { start: 0, end: 22 } };

test('S2 rejects extra fields, unknown kinds, and invalid evidence spans', () => {
  assert.equal(validateOutput({ candidates: [commitment] }, item.text), true);
  for (const candidate of [
    { ...commitment, command: 'activate' },
    { ...commitment, kind: 'execute' },
    { ...commitment, span: { start: 0, end: 999 } },
    { ...commitment, span: { start: 5, end: 5 } },
    { ...commitment, span: undefined },
    { kind: 'external_commitment', text: 'send', span: commitment.span },
  ]) assert.equal(validateOutput({ candidates: [candidate] }, item.text), false);
});

test('S2 matches evidence one-to-one and penalizes duplicates and wrong attribution', () => {
  const score = scoreItem(item, { candidates: [commitment, commitment] });
  assert.equal(score.truePositive, 1);
  assert.equal(score.falsePositive, 1);
  assert.equal(score.falseNegative, 0);
  const external = { ...item, expected: [{ kind: 'external_commitment', who: 'colleague', span: commitment.span }] };
  assert.equal(scoreItem(external, { candidates: [commitment] }).misattributedTasks, 1);
  assert.equal(scoreItem(item, { candidates: [{ ...commitment, span: { start: 0, end: 1 } }] }).truePositive, 0);
});

test('S2 distinguishes malformed JSON, schema failure, empty output, and injection', () => {
  const rows = [
    scoreItem(item, '{'),
    scoreItem(item, { candidates: [{ kind: 'execute' }] }),
    scoreItem({ ...item, injection: true, expected: [] }, { candidates: [commitment] }),
  ];
  const result = summarize(rows);
  assert.equal(result.jsonValidityPercent, 200 / 3);
  assert.equal(result.schemaValidityPercent, 100 / 3);
  assert.equal(result.injectionFollowedRate, 1);
  assert.equal(result.recall, 0);
  assert.equal(summarize([]).precision, null);
});

test('S2 Ollama sends the closed schema and refuses redirects', async () => {
  let observed;
  const runtime = new OllamaRuntime(async (url, options) => {
    observed = { url, ...options };
    return { ok: true, json: async () => ({ response: '{"candidates":[]}', eval_count: 2, eval_duration: 1e9 }) };
  });
  await runtime.extract('llama3.2:1b-instruct-q4_K_M', item);
  assert.equal(observed.redirect, 'error');
  assert.equal(observed.url, 'http://127.0.0.1:11434/api/generate');
  const body = JSON.parse(observed.body);
  assert.equal(body.stream, false);
  assert.ok(body.format.properties.candidates);
  assert.equal(body.options.temperature, 0);
  assert.equal(JSON.parse(body.prompt).sourceText, item.text);
  assert.equal(body.prompt.includes('expected'), false);
});

test('S2 records initial failure and repairs only once', async () => {
  let calls = 0;
  const runtime = { extract: async () => ({ response: ++calls === 1 ? '{' : JSON.stringify({ candidates: [commitment] }) }) };
  const row = await extractItem(runtime, 'synthetic-model', item, new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(row.initial.jsonValid, false);
  assert.equal(row.final.truePositive, 1);
  calls = 0;
  runtime.extract = async () => { calls++; return { response: '{' }; };
  assert.equal((await extractItem(runtime, 'synthetic-model', item, new AbortController().signal)).final.schemaValid, false);
  assert.equal(calls, 2);
});

test('S2 saves incomplete runs honestly and unloads after interruption', async () => {
  const controller = new AbortController();
  let unloaded = false;
  const runtime = {
    describe: async () => ({ digest: 'synthetic' }),
    extract: async () => { controller.abort(); throw new Error('interrupted'); },
    unload: async () => { unloaded = true; },
  };
  let saved;
  const sample = () => ({ rssBytes: 100, cpuPercent: 0, swapUsedBytes: null, batteryPercent: null, onBattery: null });
  await runModel(runtime, 'synthetic-model', [item], controller.signal, async result => { saved = result; }, sample);
  assert.equal(unloaded, true);
  assert.equal(saved.status, 'interrupted');
  assert.equal(saved.completedItems, 0);
  assert.equal(saved.resources.batteryPercentagePointsPer100Items, null);
  assert.equal(saved.manual.pauseStopsCpuWithin5Seconds, null);
});

test('S2 completed run aggregates tokens and sampled resources', async () => {
  const runtime = {
    describe: async () => ({ digest: 'synthetic' }),
    extract: async () => ({ response: JSON.stringify({ candidates: [commitment] }), eval_count: 12, eval_duration: 2e9 }),
    unload: async () => {},
  };
  let count = 0;
  const sample = () => ({ rssBytes: ++count * 100, cpuPercent: 50, swapUsedBytes: 0, batteryPercent: 90 - count, onBattery: true });
  let saved;
  await runModel(runtime, 'synthetic-model', [item], new AbortController().signal, async result => { saved = result; }, sample);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.tokensPerSecond, 6);
  assert.equal(saved.afterRepair.precision, 1);
  assert.equal(saved.afterRepair.recall, 1);
  assert.equal(saved.resources.sampledPeakRssBytes, 200);
  assert.equal(saved.resources.batteryPercentagePointsPer100Items, 100);
  assert.equal(saved.manual.uiResponsive, null);
});

test('S2 measures runner children without recording process paths', () => {
  const result = parseProcesses('10 1 2.0 100 /synthetic/ollama\n11 10 50.0 200 /synthetic/runner\n12 1 99.0 999 /synthetic/other', 99);
  assert.deepEqual(result, { rssBytes: 300 * 1024, cpuPercent: 52 });
  assert.deepEqual(parsePower("Now drawing from 'Battery Power'\n55%; discharging"), { batteryPercent: 55, onBattery: true });
  assert.deepEqual(parseProcesses(''), { rssBytes: null, cpuPercent: null });
});

test('S2 refuses cloud and non-Q4 metadata before inference', async () => {
  for (const local of [{ name: 'model', remote_host: 'synthetic' }, { name: 'model' }]) {
    const runtime = new OllamaRuntime(async url => ({ ok: true, json: async () => url.endsWith('/api/tags') ? { models: [local] } : { details: { quantization_level: 'Q8_0' } } }));
    await assert.rejects(runtime.describe('model'));
  }
});

test('S2 eval covers every candidate kind, attribution, negatives and injection', () => {
  const items = JSON.parse(readFileSync(new URL('../../spikes/s2/eval/items.json', import.meta.url)));
  assert.ok(items.length >= 40);
  assert.equal(new Set(items.map(entry => entry.id)).size, items.length);
  const kinds = new Set(items.flatMap(entry => entry.expected.map(candidate => candidate.kind)));
  assert.equal(kinds.size, 8);
  assert.ok(items.filter(entry => entry.injection).length >= 8);
  assert.ok(items.filter(entry => entry.expected.length === 0).length >= 8);
  for (const entry of items) {
    assert.ok(entry.dimensions.kind && entry.dimensions.speaker && entry.dimensions.complication);
    for (const candidate of entry.expected) {
      assert.ok(candidate.span.end <= entry.text.length);
      assert.ok(candidate.span.end > candidate.span.start);
    }
    const candidates = entry.expected.map(expected => ({
      ...expected,
      ...(['user_commitment', 'external_commitment'].includes(expected.kind) ? { text: entry.text.slice(expected.span.start, expected.span.end) } : {}),
      ...(expected.kind === 'new_initiative' ? { rationale: 'Synthetic rationale' } : {}),
    }));
    assert.equal(validateOutput({ candidates }, entry.text), true, entry.id);
    const score = scoreItem(entry, { candidates });
    assert.equal(score.falsePositive, 0, entry.id);
    assert.equal(score.falseNegative, 0, entry.id);
    assert.equal(score.injectionFollowed, false, entry.id);
  }
});
