import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIFIERS, buildRequest, buildPayloadRequest, scoreKinds, normalizeExtraction } from './configurations.mjs';
import { buildSingleRequest, decodeSingle } from './single-label.mjs';
import { summarizeClassification, summarizeExtraction } from './analyze.mjs';
import { scoreItem } from '../evaluate.mjs';
import { OllamaRuntime } from '../ollama.mjs';

const MODELS = ['qwen3.5:4b', 'gemma4:e4b'];
const CONFIGS = ['kind-chat', 'kind-zero-chat', 'minimal-single-chat'];
const SCREEN_IDS = [1, 2, 5, 6, 9, 12, 13, 14, 17, 18, 21, 23, 25, 26, 29, 31, 33, 35, 36, 40, 41, 43, 46, 48];
const PROBE_IDS = [1, 5, 9, 13, 17, 21, 25, 29, 33, 35, 41, 48];
const MODEL_BUDGET_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 120;
const ENDPOINT = 'http://127.0.0.1:11435';
const OUTPUT = fileURLToPath(new URL('../out/challengers/', import.meta.url));
const SOURCE_FILES = ['challengers.mjs', 'configurations.mjs', 'single-label.mjs', 'analyze.mjs', '../evaluate.mjs', '../ollama.mjs', '../eval/items.json'];
const hash = value => createHash('sha256').update(value).digest('hex');
const traceKey = row => [row.model, row.stage, row.config ?? '', row.id, row.kind ?? ''].join('/');
const rawOutput = result => result?.message?.content ?? result?.response ?? '';

function asChat(request) {
  if (request.messages) return { ...request, think: false };
  const { system, prompt, ...options } = request;
  return { ...options, think: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
}

export function buildChallengerRequest(model, config, item, kind) {
  if (kind) return asChat(buildPayloadRequest(model, item, kind));
  if (config === 'minimal-single-chat') return asChat(buildSingleRequest(model, item));
  assert.ok(CONFIGS.includes(config));
  const base = CLASSIFIERS.find(candidate => candidate.id === (config === 'kind-zero-chat' ? 'kind-zero' : 'kind-chat'));
  return asChat(buildRequest(model, base, item));
}

function classificationScore(item, config, raw) {
  return scoreKinds(item, config === 'minimal-single-chat' ? decodeSingle(raw) : raw);
}

export function chooseChallengerConfig(rows, itemCount) {
  const ranking = CONFIGS.map(config => {
    const selected = rows.filter(row => row.config === config);
    assert.equal(selected.length, itemCount, 'screen incomplete');
    assert.equal(new Set(selected.map(row => row.id)).size, itemCount, 'duplicate screen case');
    const total = field => selected.reduce((sum, row) => sum + Number(row.score[field]), 0);
    return { config, exact: total('exact'), fp: total('fp'), invalid: itemCount - total('valid'), fn: total('fn') };
  });
  ranking.sort((first, second) => second.exact - first.exact || first.fp - second.fp || first.invalid - second.invalid || first.fn - second.fn);
  return ranking[0].config;
}

export function checkChallengerTrace(row, item) {
  assert.ok(['classify', 'payload'].includes(row.stage));
  assert.deepEqual(row.request, buildChallengerRequest(row.model, row.config, item, row.kind));
  assert.equal(row.raw, rawOutput(row.result));
  const normalized = row.stage === 'payload' ? normalizeExtraction(item, row.kind, row.raw) : null;
  assert.deepEqual(row.score, normalized ? { valid: normalized.valid, rejected: normalized.rejected } : classificationScore(item, row.config, row.raw));
}

class BudgetExhausted extends Error {}

async function record(context, frame, request, item) {
  const remaining = context.deadline - performance.now();
  if (remaining <= 0 || context.rows.length >= MAX_REQUESTS) throw new BudgetExhausted('Model budget exhausted');
  const started = performance.now();
  let result;
  let error;
  try { result = await context.runtime.request('/api/chat', request, AbortSignal.timeout(Math.ceil(remaining))); }
  catch (caught) { error = caught.message; }
  const row = { ...frame, request, result: result ?? null, raw: rawOutput(result), error: error ?? null, seconds: (performance.now() - started) / 1000 };
  const normalized = frame.stage === 'payload' ? normalizeExtraction(item, frame.kind, row.raw) : null;
  row.score = normalized ? { valid: normalized.valid, rejected: normalized.rejected } : classificationScore(item, frame.config, row.raw);
  context.rows.push(row);
  await appendFile(resolve(OUTPUT, 'traces.jsonl'), JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ latest: traceKey(row), seconds: row.seconds, score: row.score, error: row.error }));
  if (error && performance.now() >= context.deadline) throw new BudgetExhausted('Deadline reached during request');
  if (error) throw new Error(error);
  return row;
}

async function probe(context, model, config, item) {
  const classified = context.rows.find(row => row.stage === 'classify' && row.config === config && row.id === item.id);
  const decoded = config === 'minimal-single-chat' ? decodeSingle(classified.raw) : classified.score.valid ? JSON.parse(classified.raw) : null;
  const candidates = [];
  let rejected = 0;
  let completion = 'complete';
  try {
    for (const kind of decoded?.kinds ?? []) {
      const row = await record(context, { model, stage: 'payload', config, id: item.id, kind }, buildChallengerRequest(model, config, item, kind), item);
      const normalized = normalizeExtraction(item, kind, row.raw);
      candidates.push(...normalized.candidates);
      rejected += normalized.rejected;
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    completion = 'budget-exhausted';
  }
  const row = { model, config, id: item.id, completion, classificationValid: classified.score.valid, candidates, rejected, score: scoreItem(item, { candidates }) };
  context.pipeline.push(row);
  await appendFile(resolve(OUTPUT, 'pipeline.jsonl'), JSON.stringify(row) + '\n');
  if (completion !== 'complete') throw new BudgetExhausted('Extraction incomplete');
}

async function runModel(runtime, model, items) {
  const context = { runtime, deadline: performance.now() + MODEL_BUDGET_MS, rows: [], pipeline: [] };
  let disposition = 'completed';
  let error;
  let metadata;
  let selected;
  try {
    metadata = await runtime.describe(model);
    const show = await runtime.request('/api/show', { model });
    await writeFile(resolve(OUTPUT, model.replaceAll(':', '-') + '-metadata.json'), JSON.stringify({ metadata, capabilities: show.capabilities, thinking: show.thinking, modelInfo: show.model_info }, null, 2) + '\n');
    for (const config of CONFIGS) for (const item of items) {
      await record(context, { model, stage: 'classify', config, id: item.id }, buildChallengerRequest(model, config, item), item);
    }
    selected = chooseChallengerConfig(context.rows, items.length);
    for (const item of items.filter(item => PROBE_IDS.includes(Number(item.id.slice(-3))))) await probe(context, model, selected, item);
  } catch (caught) {
    disposition = caught instanceof BudgetExhausted ? 'budget-limited' : 'failed';
    error = caught.message;
  } finally {
    try { await runtime.unload(model); } catch (caught) { error ??= caught.message; if (disposition === 'completed') disposition = 'failed'; }
  }
  const itemMap = new Map(items.map(item => [item.id, item]));
  return { model, metadata, disposition, error, selected, requests: context.rows.length, plannedClassifications: items.length * CONFIGS.length, plannedProbes: PROBE_IDS.length,
    classification: Object.fromEntries(CONFIGS.map(config => [config, summarizeClassification(context.rows.filter(row => row.stage === 'classify' && row.config === config), itemMap)])),
    extraction: summarizeExtraction(context.pipeline.filter(row => row.completion === 'complete'), itemMap) };
}

async function rowsFrom(name) {
  try { return (await readFile(resolve(OUTPUT, name), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function replay(items, manifest, results) {
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected);
  const traces = await rowsFrom('traces.jsonl');
  const pipeline = await rowsFrom('pipeline.jsonl');
  assert.equal(new Set(traces.map(traceKey)).size, traces.length);
  for (const row of traces) checkChallengerTrace(row, items.find(item => item.id === row.id));
  for (const row of pipeline) {
    const item = items.find(item => item.id === row.id);
    const classified = traces.find(trace => trace.model === row.model && trace.stage === 'classify' && trace.id === row.id && trace.config === row.config);
    const kinds = row.config === 'minimal-single-chat' ? decodeSingle(classified.raw)?.kinds ?? [] : classified.score.valid ? JSON.parse(classified.raw).kinds : [];
    const payloads = traces.filter(trace => trace.model === row.model && trace.stage === 'payload' && trace.id === row.id);
    assert.ok(payloads.every(trace => kinds.includes(trace.kind)));
    if (row.completion === 'complete') assert.deepEqual(payloads.map(trace => trace.kind), kinds);
    const normalized = payloads.filter(trace => !trace.error).map(trace => normalizeExtraction(item, trace.kind, trace.raw));
    assert.equal(row.classificationValid, classified.score.valid);
    assert.deepEqual(row.candidates, normalized.flatMap(output => output.candidates));
    assert.equal(row.rejected, normalized.reduce((sum, output) => sum + output.rejected, 0));
    assert.deepEqual(row.score, scoreItem(item, { candidates: row.candidates }));
  }
  const itemMap = new Map(items.map(item => [item.id, item]));
  for (const result of results) {
    const modelRows = traces.filter(row => row.model === result.model);
    assert.equal(result.requests, modelRows.length);
    assert.ok(result.requests <= MAX_REQUESTS);
    for (const config of CONFIGS) assert.deepEqual(result.classification[config], summarizeClassification(modelRows.filter(row => row.stage === 'classify' && row.config === config), itemMap));
    if (result.selected) assert.equal(result.selected, chooseChallengerConfig(modelRows.filter(row => row.stage === 'classify'), items.length));
    assert.deepEqual(result.extraction, summarizeExtraction(pipeline.filter(row => row.model === result.model && row.completion === 'complete'), itemMap));
  }
  return { replay: 'passed', requests: traces.length, pipelineItems: pipeline.length };
}

async function writeReview(items, results) {
  const pipeline = await rowsFrom('pipeline.jsonl');
  const lines = ['# Additional local challengers', '', 'Development screening and a 12-case extraction probe; no new holdout and no model adoption. Uses a separate newer Ollama runtime with thinking disabled and chat messages for every request. Runtime/chat differences confound comparisons with the main battery. All annotations require semantic review. One hour/120 requests per model; incomplete cases are not passes.', '', '| Model | State | Configuration | Exact classification | Complete extraction | Exact extraction |', '| --- | --- | --- | --- | --- | --- |'];
  for (const result of results) for (const [config, row] of Object.entries(result.classification)) lines.push(`| ${result.model} | ${result.disposition} | ${config} | ${row.exact}/${row.requests} of 24 planned | ${result.extraction.items}/12 | ${result.extraction.exact}/${result.extraction.items} |`);
  for (const result of results) lines.push('', `${result.model}: selected=${result.selected ?? 'none'}; requests=${result.requests}; error=${result.error ?? 'none'}.`);
  for (const row of pipeline) {
    const item = items.find(item => item.id === row.id);
    lines.push('', `## ${row.model}: ${row.id}`, '', `Trusted speaker: ${item.speaker}. Completion: ${row.completion}.`, '', '````text', item.text, '````', '', 'Reference:', '````json', JSON.stringify(item.expected, null, 2), '````', '', 'Output:', '````json', JSON.stringify(row.candidates, null, 2), '````');
  }
  await writeFile(resolve(OUTPUT, 'review.md'), lines.join('\n') + '\n');
}

async function run(mode) {
  const development = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  const items = development.filter(item => SCREEN_IDS.includes(Number(item.id.slice(-3))));
  if (mode === 'audit') {
    const manifest = JSON.parse(await readFile(resolve(OUTPUT, 'manifest.json'), 'utf8'));
    const results = JSON.parse(await readFile(resolve(OUTPUT, 'summary.json'), 'utf8'));
    console.log(JSON.stringify(await replay(items, manifest, results)));
    return;
  }
  await mkdir(OUTPUT, { recursive: true });
  try { await readFile(resolve(OUTPUT, 'manifest.json')); throw new Error('Existing challenger study: preserve before rerunning'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceHashes = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async path => [path, hash(await readFile(new URL(path, import.meta.url)))])));
  const manifest = { models: MODELS, configs: CONFIGS, screenIds: items.map(item => item.id), probeIds: PROBE_IDS, sourceHashes, budgetMs: MODEL_BUDGET_MS, maxRequestsPerModel: MAX_REQUESTS, think: false, endpoint: ENDPOINT, startedAt: new Date().toISOString() };
  await writeFile(resolve(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const runtime = new OllamaRuntime((url, options) => fetch(String(url).replace('http://127.0.0.1:11434', ENDPOINT), options));
  const results = [];
  for (const model of MODELS) {
    results.push(await runModel(runtime, model, items));
    await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'running', results }, null, 2) + '\n');
  }
  await writeFile(resolve(OUTPUT, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
  await writeFile(resolve(OUTPUT, 'replay.json'), JSON.stringify(await replay(items, manifest, results), null, 2) + '\n');
  await writeReview(items, results);
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'completed', results, humanReviewPending: true }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run(process.argv[2] === '--audit' ? 'audit' : 'inference');
