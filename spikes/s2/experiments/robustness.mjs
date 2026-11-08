import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIFIERS, buildRequest, buildPayloadRequest, normalizeExtraction, scoreKinds } from './configurations.mjs';
import { scoreItem } from '../evaluate.mjs';
import { OllamaRuntime } from '../ollama.mjs';
import { summarizeClassification, summarizeExtraction } from './analyze.mjs';

const MODEL_BUDGET_MS = 30 * 60 * 1000;
const MAX_REQUESTS_PER_MODEL = 80;
const EXTRA_SEEDS = [7, 101];
const CRITICAL_IDS = [1, 5, 9, 13, 33, 35, 41, 48];
const PADDING_REPETITIONS = 8;
const PADDING = ('The fictional room contains paper samples and wooden shelves. The curtains are green and the windows face a courtyard.\n').repeat(PADDING_REPETITIONS);
const OUTPUT = fileURLToPath(new URL('../out/robustness/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const key = row => [row.model, row.stage, row.id, row.seed ?? '', row.kind ?? ''].join('/');

export function deriveItem(item, { prefix = '', suffix = '' } = {}) {
  return { ...structuredClone(item), text: prefix + item.text + suffix,
    expected: item.expected.map(candidate => ({ ...structuredClone(candidate), span: { start: prefix.length + candidate.span.start, end: prefix.length + candidate.span.end } })) };
}

function combine(items, speaker) {
  let text = '';
  const expected = [];
  for (const item of items) {
    const offset = text.length;
    text += item.text + '\n\n';
    expected.push(...item.expected.map(candidate => ({ ...structuredClone(candidate), span: { start: offset + candidate.span.start, end: offset + candidate.span.end } })));
  }
  return { speaker, text, expected, injection: items.some(item => item.injection) };
}

export function buildStressCases(items) {
  const source = number => {
    const item = items.find(item => item.id === `s2-${String(number).padStart(3, '0')}`);
    assert.ok(item, `missing source ${number}`);
    return item;
  };
  const cases = [];
  const add = (item, family, parents) => cases.push({ ...item, id: `r-${String(cases.length + 1).padStart(3, '0')}`, family, parents });
  for (const number of [1, 6, 14, 31]) {
    for (const [position, prefix, suffix] of [['beginning', '', PADDING + PADDING], ['middle', PADDING, PADDING], ['end', PADDING + PADDING, '']]) {
      add(deriveItem(source(number), { prefix, suffix }), `context-${position}`, [source(number).id]);
    }
  }
  for (const number of [21, 25]) add(deriveItem(source(number), { prefix: '🌱 🧭 Meeting excerpt:\n\t', suffix: '\nEnd of excerpt.\n' }), 'unicode-formatting', [source(number).id]);
  const personal = deriveItem(source(1), { prefix: PADDING + 'Quoted note:\n', suffix: PADDING });
  add(personal, 'speaker-counterfactual', [source(1).id]);
  const colleague = structuredClone(personal);
  colleague.speaker = 'colleague-a';
  colleague.expected[0].kind = 'external_commitment';
  colleague.expected[0].who = 'colleague-a';
  add(colleague, 'speaker-counterfactual', [source(5).id]);
  for (const [numbers, speaker, family] of [
    [[1, 25], 'user', 'multiple-kinds'],
    [[15, 17], 'colleague-a', 'multiple-kinds'],
    [[9, 10], 'user', 'multiple-same-kind'],
    [[6, 8], 'user', 'multiple-same-kind'],
    [[33, 35], 'user', 'negative-context'],
    [[39, 36], 'colleague-b', 'negative-context'],
  ]) add(combine(numbers.map(source), speaker), family, numbers.map(number => source(number).id));
  for (const options of [{ prefix: PADDING + PADDING }, { suffix: PADDING + PADDING }]) add(deriveItem(source(48), options), 'mixed-attack-context', [source(48).id]);
  return cases;
}

export function seedRequest(model, item, seed) {
  const body = buildRequest(model, CLASSIFIERS.find(config => config.id === 'kind-sampled'), item);
  return { ...body, options: { ...body.options, seed } };
}

export function completedPass(row) {
  return row.completion === 'complete' && row.classificationValid && row.score.schemaValid && row.score.falsePositive === 0 && row.score.falseNegative === 0;
}

export function modelBudget(started, now = performance.now.bind(performance), duration = MODEL_BUDGET_MS) {
  return { remaining: () => Math.max(0, started + duration - now()) };
}

class BudgetExhausted extends Error {}

async function readRows(path) {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function loadParents(directories) {
  const traceHashes = [];
  const metadata = {};
  const selections = {};
  const traces = [];
  for (const directory of directories) {
    assert.equal(JSON.parse(await readFile(resolve(directory, 'status.json'), 'utf8')).phase, 'completed');
    Object.assign(metadata, JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')).metadata);
    Object.assign(selections, JSON.parse(await readFile(resolve(directory, 'selection.json'), 'utf8')));
    traceHashes.push(hash(await readFile(resolve(directory, 'traces.jsonl'))));
    traces.push(...await readRows(resolve(directory, 'traces.jsonl')));
  }
  return { metadata, selections, traces, traceHashes };
}

async function record(context, frame, request, scorer, route = 'generate') {
  if (!context.budget.remaining() || context.requests >= MAX_REQUESTS_PER_MODEL) throw new BudgetExhausted('Model budget exhausted');
  const started = performance.now();
  let result;
  let error;
  context.requests++;
  try { result = await context.runtime.request(`/api/${route}`, request, AbortSignal.timeout(Math.ceil(context.budget.remaining()))); }
  catch (caught) { error = caught.message; }
  const raw = result?.response ?? result?.message?.content ?? '';
  const row = { ...frame, request, result: result ?? null, raw, error: error ?? null, seconds: (performance.now() - started) / 1000, score: scorer(raw) };
  await appendFile(resolve(OUTPUT, 'traces.jsonl'), `${JSON.stringify(row)}\n`);
  context.rows.push(row);
  console.log(JSON.stringify({ latest: key(row), seconds: row.seconds, score: row.score, error: row.error }));
  if (error && !context.budget.remaining()) throw new BudgetExhausted('Time budget reached during request');
  if (error) throw new Error(error);
  return row;
}

async function seedChecks(context, model, items) {
  for (const seed of EXTRA_SEEDS) for (const item of items.filter(item => CRITICAL_IDS.includes(Number(item.id.slice(-3))))) {
    await record(context, { model, stage: 'seed', id: item.id, seed, config: 'kind-sampled' }, seedRequest(model, item, seed), raw => scoreKinds(item, raw));
  }
}

async function classifyStress(context, model, config, stress) {
  const classified = new Map();
  for (const item of stress) {
    const row = await record(context, { model, stage: 'classify', id: item.id, config: config.id }, buildRequest(model, config, item), raw => scoreKinds(item, raw), config.api);
    classified.set(item.id, row);
  }
  return classified;
}

async function extractStress(context, model, config, item, classification) {
  const kinds = classification.score.valid ? JSON.parse(classification.raw).kinds : [];
  const candidates = [];
  let rejected = 0;
  let completion = 'complete';
  try {
    for (const kind of kinds) {
      const trace = await record(context, { model, stage: 'payload', id: item.id, config: config.id, kind }, buildPayloadRequest(model, item, kind), raw => {
        const output = normalizeExtraction(item, kind, raw);
        return { valid: output.valid, rejected: output.rejected };
      });
      const output = normalizeExtraction(item, kind, trace.raw);
      candidates.push(...output.candidates);
      rejected += output.rejected;
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    completion = 'budget-exhausted';
  }
  const row = { model, id: item.id, config: config.id, completion, classificationValid: classification.score.valid, candidates, rejected, score: scoreItem(item, { candidates }) };
  await appendFile(resolve(OUTPUT, 'pipeline.jsonl'), `${JSON.stringify(row)}\n`);
  return row;
}

async function runModel(runtime, model, config, items, stress) {
  const context = { runtime, budget: modelBudget(performance.now()), requests: 0, rows: [] };
  const pipeline = [];
  let disposition = 'completed';
  try {
    await seedChecks(context, model, items);
    const classified = await classifyStress(context, model, config, stress);
    for (const item of stress) {
      const row = await extractStress(context, model, config, item, classified.get(item.id));
      pipeline.push(row);
      if (row.completion !== 'complete') throw new BudgetExhausted('Incomplete extraction at budget limit');
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    disposition = 'budget-limited';
  } finally { await runtime.unload(model); }
  return { model, disposition, actualRequests: context.requests, classified: context.rows.filter(row => row.stage === 'classify').length, extractionsCompleted: pipeline.filter(row => row.completion === 'complete').length };
}

function prediction(raw) {
  try { const value = JSON.parse(raw); return Array.isArray(value.kinds) ? [...value.kinds].sort().join(',') : null; } catch { return null; }
}

async function summarize(stress, parents, models) {
  const traces = await readRows(resolve(OUTPUT, 'traces.jsonl'));
  const pipeline = await readRows(resolve(OUTPUT, 'pipeline.jsonl')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const items = new Map(stress.map(item => [item.id, item]));
  const results = {};
  for (const { model, ...disposition } of models) {
    const classifications = traces.filter(row => row.model === model && row.stage === 'classify');
    const complete = pipeline.filter(row => row.model === model && row.completion === 'complete');
    const seeds = traces.filter(row => row.model === model && row.stage === 'seed').map(row => {
      const baseline = parents.traces.find(parent => parent.model === model && parent.config === 'kind-sampled' && parent.id === row.id && parent.phase === 'screen');
      assert.ok(baseline);
      return { id: row.id, seed: row.seed, valid: row.score.valid, exact: row.score.exact, baselineValid: baseline.score.valid,
        changed: row.score.valid && baseline.score.valid ? prediction(row.raw) !== prediction(baseline.raw) : null };
    });
    results[model] = { ...disposition, plannedStressItems: stress.length, classification: summarizeClassification(classifications, items), extraction: summarizeExtraction(complete, items), seeds };
  }
  await writeFile(resolve(OUTPUT, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
  return { results, traces, pipeline };
}

async function writeReview(stress, summary) {
  const lines = ['# Bounded robustness extension', '', 'Derived from the original approved cases; not an independent holdout. Agent annotations await owner review. A 30-minute/80-request cap applies to each model. Unrun/incomplete cases are not passes. This tests extraction, not temporal conflict reconciliation.', '', '| Model | Disposition | Classified | Complete extractions | Exact complete items | Precision | Recall |', '| --- | --- | --- | --- | --- | --- | --- |'];
  const percent = value => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  for (const [model, result] of Object.entries(summary.results)) lines.push(`| ${model} | ${result.disposition} | ${result.classified}/24 | ${result.extractionsCompleted}/24 | ${result.extraction.exact}/${result.extraction.items} | ${percent(result.extraction.precision)} | ${percent(result.extraction.recall)} |`);
  lines.push('', '## Sampling stability', '', 'Temperature 0.3; seeds 7 and 101 compared with the original seed-42 run. Stable predictions can still be wrong; invalid outputs are not stable passes.', '');
  for (const [model, result] of Object.entries(summary.results)) lines.push(`- ${model}: ${result.seeds.filter(row => row.exact).length}/${result.seeds.length} exact; ${result.seeds.filter(row => row.changed === true).length} changed valid kind sets; ${result.seeds.filter(row => !row.valid).length} invalid outputs.`);
  for (const item of stress) {
    lines.push('', `## ${item.id}: ${item.family}`, '', `Trusted speaker: ${item.speaker}. Derived from: ${item.parents.join(', ')}.`, '', '````text', item.text, '````', '', 'Reference:', '````json', JSON.stringify(item.expected, null, 2), '````');
    for (const row of summary.pipeline.filter(row => row.id === item.id)) lines.push('', `${row.model}: ${row.completion}; exact complete pass: ${completedPass(row)}; rejected: ${row.rejected}.`, '````json', JSON.stringify(row.candidates, null, 2), '````');
  }
  await writeFile(resolve(OUTPUT, 'review.md'), lines.join('\n') + '\n');
}

export function auditTrace(row, item, config) {
  const request = row.stage === 'seed' ? seedRequest(row.model, item, row.seed)
    : row.stage === 'payload' ? buildPayloadRequest(row.model, item, row.kind)
      : buildRequest(row.model, config, item);
  assert.deepEqual(row.request, request, 'request changed');
  assert.equal(row.raw, row.result?.response ?? row.result?.message?.content ?? '', 'raw output changed');
  const output = row.stage === 'payload' ? normalizeExtraction(item, row.kind, row.raw) : null;
  const score = output ? { valid: output.valid, rejected: output.rejected } : scoreKinds(item, row.raw);
  assert.deepEqual(row.score, score, 'score changed');
}

async function audit(directories) {
  const parents = await loadParents(directories);
  const manifest = JSON.parse(await readFile(resolve(OUTPUT, 'manifest.json'), 'utf8'));
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected);
  const originals = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  const stress = buildStressCases(originals);
  assert.equal(hash(JSON.stringify(stress)), manifest.itemsSha256);
  assert.deepEqual(JSON.parse(await readFile(resolve(OUTPUT, 'items.json'), 'utf8')), stress);
  assert.deepEqual(manifest.selections, parents.selections);
  assert.deepEqual(manifest.metadata, parents.metadata);
  assert.deepEqual(manifest.parentTraceHashes, parents.traceHashes);
  const traces = await readRows(resolve(OUTPUT, 'traces.jsonl'));
  assert.equal(new Set(traces.map(key)).size, traces.length, 'duplicate requests');
  for (const row of traces) {
    const item = (row.stage === 'seed' ? originals : stress).find(item => item.id === row.id);
    assert.ok(item);
    auditTrace(row, item, parents.selections[row.model][0]);
  }
  const pipeline = await readRows(resolve(OUTPUT, 'pipeline.jsonl')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  assert.equal(new Set(pipeline.map(row => row.model + '/' + row.id)).size, pipeline.length);
  for (const row of pipeline) {
    const item = stress.find(item => item.id === row.id);
    const classified = traces.find(trace => trace.stage === 'classify' && trace.model === row.model && trace.id === row.id);
    assert.ok(classified);
    assert.equal(row.classificationValid, classified.score.valid);
    const payloads = traces.filter(trace => trace.stage === 'payload' && trace.model === row.model && trace.id === row.id);
    const kinds = classified.score.valid ? JSON.parse(classified.raw).kinds : [];
    assert.ok(payloads.every(trace => kinds.includes(trace.kind)));
    if (row.completion === 'complete') assert.deepEqual(payloads.map(trace => trace.kind), kinds);
    const normalized = payloads.filter(trace => !trace.error).map(trace => normalizeExtraction(item, trace.kind, trace.raw));
    assert.deepEqual(row.candidates, normalized.flatMap(output => output.candidates));
    assert.equal(row.rejected, normalized.reduce((sum, output) => sum + output.rejected, 0));
    assert.deepEqual(row.score, scoreItem(item, { candidates: row.candidates }));
  }
  const status = JSON.parse(await readFile(resolve(OUTPUT, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'completed');
  for (const model of status.models) {
    assert.equal(model.actualRequests, traces.filter(row => row.model === model.model).length);
    assert.ok(model.actualRequests <= MAX_REQUESTS_PER_MODEL);
    assert.equal(model.classified, traces.filter(row => row.model === model.model && row.stage === 'classify').length);
    assert.equal(model.extractionsCompleted, pipeline.filter(row => row.model === model.model && row.completion === 'complete').length);
  }
  const previous = JSON.parse(await readFile(resolve(OUTPUT, 'summary.json'), 'utf8'));
  const replay = await summarize(stress, parents, status.models);
  assert.deepEqual(replay.results, previous);
  console.log(JSON.stringify({ replay: 'passed', requests: traces.length, pipelineItems: pipeline.length }));
}

async function run(directories) {
  assert.equal(directories.length, 2, 'pass completed Llama and Qwen study directories');
  await mkdir(OUTPUT, { recursive: true });
  try { await readFile(resolve(OUTPUT, 'manifest.json')); throw new Error('Existing robustness study: review and preserve it before rerunning'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parents = await loadParents(directories);
  const items = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  const stress = buildStressCases(items);
  const paths = ['robustness.mjs', 'analyze.mjs', 'configurations.mjs', '../eval/items.json', '../evaluate.mjs', '../ollama.mjs'];
  const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(new URL(path, import.meta.url)))])));
  await writeFile(resolve(OUTPUT, 'manifest.json'), JSON.stringify({ sourceHashes, parentTraceHashes: parents.traceHashes, itemsSha256: hash(JSON.stringify(stress)), metadata: parents.metadata, selections: parents.selections, modelBudgetMs: MODEL_BUDGET_MS, maxRequestsPerModel: MAX_REQUESTS_PER_MODEL, seeds: EXTRA_SEEDS, criticalIds: CRITICAL_IDS }, null, 2) + '\n');
  await writeFile(resolve(OUTPUT, 'items.json'), JSON.stringify(stress, null, 2) + '\n');
  const runtime = new OllamaRuntime();
  const models = [];
  for (const [model, expected] of Object.entries(parents.metadata)) {
    assert.deepEqual(await runtime.describe(model), expected);
    models.push(await runModel(runtime, model, parents.selections[model][0], items, stress));
    await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'running', models }, null, 2) + '\n');
  }
  const summary = await summarize(stress, parents, models);
  await writeReview(stress, summary);
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'completed', models }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--audit') await audit(process.argv.slice(3));
  else await run(process.argv.slice(2));
}

