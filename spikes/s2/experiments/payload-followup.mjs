import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChallengerRequest, checkChallengerTrace } from './challengers.mjs';
import { normalizeExtraction } from './configurations.mjs';
import { decodeSingle } from './single-label.mjs';
import { summarizeExtraction } from './analyze.mjs';
import { OllamaRuntime } from '../ollama.mjs';
import { scoreItem } from '../evaluate.mjs';
import { localInferenceFetch } from './transport.mjs';

const PARENT = fileURLToPath(new URL('../out/challengers/', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../out/challenger-payload-followup/', import.meta.url));
const MODEL_BUDGET_MS = 30 * 60 * 1000;
const MAX_REQUESTS = 48;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function rows(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export function pendingProbeItems(model, probeIds, items, pipeline) {
  const completed = new Set(pipeline.filter(row => row.model === model && row.completion === 'complete').map(row => row.id));
  return items.filter(item => probeIds.includes(Number(item.id.slice(-3))) && !completed.has(item.id));
}

async function runModel(runtime, parent, items, classifications) {
  const deadline = performance.now() + MODEL_BUDGET_MS;
  const pipeline = [];
  let requests = 0;
  assert.ok(parent.selected, 'Completed parent classification screen required');
  assert.deepEqual(await runtime.describe(parent.model), parent.metadata);
  for (const item of items) {
    const classified = classifications.find(row => row.model === parent.model && row.stage === 'classify' && row.config === parent.selected && row.id === item.id);
    assert.ok(classified);
    checkChallengerTrace(classified, item);
    const kinds = parent.selected === 'minimal-single-chat' ? decodeSingle(classified.raw)?.kinds ?? [] : classified.score.valid ? JSON.parse(classified.raw).kinds : [];
    const candidates = [];
    let rejected = 0;
    let completion = 'complete';
    for (const kind of kinds) {
      const remaining = deadline - performance.now();
      if (remaining <= 0 || requests >= MAX_REQUESTS) { completion = 'budget-exhausted'; break; }
      const request = buildChallengerRequest(parent.model, parent.selected, item, kind);
      const started = performance.now();
      let result;
      let error;
      requests++;
      try { result = await runtime.request('/api/chat', request, AbortSignal.timeout(Math.ceil(remaining))); }
      catch (caught) { error = caught.message; }
      const raw = result?.message?.content ?? '';
      const output = normalizeExtraction(item, kind, raw);
      const trace = { model: parent.model, config: parent.selected, stage: 'payload', id: item.id, kind, request, result: result ?? null, raw, error: error ?? null, seconds: (performance.now() - started) / 1000, score: { valid: output.valid, rejected: output.rejected } };
      checkChallengerTrace(trace, item);
      await appendFile(resolve(OUTPUT, 'traces.jsonl'), JSON.stringify(trace) + '\n');
      console.log(JSON.stringify({ model: parent.model, id: item.id, kind, error: trace.error, seconds: trace.seconds }));
      if (error) { completion = performance.now() >= deadline ? 'budget-exhausted' : 'request-failed'; break; }
      candidates.push(...output.candidates);
      rejected += output.rejected;
    }
    const row = { model: parent.model, id: item.id, config: parent.selected, completion, classificationValid: classified.score.valid, candidates, rejected, score: scoreItem(item, { candidates }) };
    pipeline.push(row);
    await appendFile(resolve(OUTPUT, 'pipeline.jsonl'), JSON.stringify(row) + '\n');
    if (completion === 'budget-exhausted') break;
  }
  return { model: parent.model, requests, plannedItems: items.length, completed: pipeline.filter(row => row.completion === 'complete').length, extraction: summarizeExtraction(pipeline.filter(row => row.completion === 'complete'), new Map(items.map(item => [item.id, item]))) };
}

async function run() {
  const status = await json(resolve(PARENT, 'status.json'));
  assert.equal(status.phase, 'completed', 'Parent screen must finish first');
  const manifest = await json(resolve(PARENT, 'manifest.json'));
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) assert.equal(hash(await readFile(new URL(path, import.meta.url))), expected);
  const items = await json(new URL('../eval/items.json', import.meta.url));
  const prior = await rows(resolve(PARENT, 'pipeline.jsonl'));
  const classifications = await rows(resolve(PARENT, 'traces.jsonl'));
  await mkdir(OUTPUT, { recursive: true });
  const sourceHashes = {};
  for (const path of ['payload-followup.mjs', 'transport.mjs', 'challengers.mjs', 'configurations.mjs', 'single-label.mjs', '../evaluate.mjs', '../ollama.mjs']) sourceHashes[path] = hash(await readFile(new URL(path, import.meta.url)));
  await writeFile(resolve(OUTPUT, 'manifest.json'), JSON.stringify({ sourceHashes, parentTracesSha256: hash(await readFile(resolve(PARENT, 'traces.jsonl'))), parentPipelineSha256: hash(await readFile(resolve(PARENT, 'pipeline.jsonl'))), modelBudgetMs: MODEL_BUDGET_MS, maxRequestsPerModel: MAX_REQUESTS, independentFollowup: true }, null, 2), { flag: 'wx' });
  const runtime = new OllamaRuntime((url, options) => localInferenceFetch(String(url).replace(':11434', ':11435'), options));
  const results = [];
  for (const parent of status.results) {
    const pending = pendingProbeItems(parent.model, manifest.probeIds, items, prior);
    if (!pending.length) continue;
    try { results.push(await runModel(runtime, parent, pending, classifications)); }
    catch (error) { results.push({ model: parent.model, error: error.message }); }
    finally { try { await runtime.unload(parent.model); } catch (error) { console.error(error.message); } }
  }
  const saved = await rows(resolve(OUTPUT, 'traces.jsonl'));
  for (const row of saved) checkChallengerTrace(row, items.find(item => item.id === row.id));
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'completed', results, replayedRequests: saved.length, humanReviewPending: true }, null, 2) + '\n');
  const lines = ['# Additional payload coverage', '', 'Separate follow-up for unfinished development probes. Original one-hour budgets, failures and denominators remain unchanged. No repeated completed cases, new classification, gold routing or model adoption.', '', '```json', JSON.stringify(results, null, 2), '```', '', 'See traces.jsonl and pipeline.jsonl for saved requests, evidence and objective scores.'];
  await writeFile(resolve(OUTPUT, 'review.md'), lines.join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
