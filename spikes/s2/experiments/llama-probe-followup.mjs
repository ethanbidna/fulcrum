import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OllamaRuntime } from '../ollama.mjs';
import { localInferenceFetch } from './transport.mjs';
import { scoreItem } from '../evaluate.mjs';

const MODEL = 'llama3.1:8b-instruct-q4_K_M';
const OUTPUT = fileURLToPath(new URL('../out/llama-probe-followup/', import.meta.url));
const STUDY_BUDGET_MS = 45 * 60 * 1000;
const REQUEST_DEADLINE_MS = 10 * 60 * 1000;
const THREADS = 4;
const hash = value => createHash('sha256').update(value).digest('hex');

export function buildRecoveredProbeRequest(original) {
  return { ...original, keep_alive: '15m', options: { ...original.options, num_thread: THREADS } };
}

export function failedLlamaProbes(rows) {
  return rows.filter(row => row.model === MODEL && row.phase === 'full' && row.error);
}

async function run() {
  const parent = fileURLToPath(new URL('../out/experiments/', import.meta.url));
  const originalText = await readFile(resolve(parent, 'traces.jsonl'), 'utf8');
  const original = originalText.trim().split('\n').map(line => JSON.parse(line));
  const selected = failedLlamaProbes(original);
  const items = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(await readFile(resolve(parent, 'manifest.json'), 'utf8')).metadata[MODEL];
  const runtime = new OllamaRuntime((url, options) => localInferenceFetch(String(url).replace(':11434', ':11435'), options));
  const metadata = await runtime.describe(MODEL);
  assert.equal(metadata.digest, expected.digest);
  assert.deepEqual(metadata.details, expected.details);
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'manifest.json'), JSON.stringify({ metadata, parentMetadata: expected, parentTracesSha256: hash(originalText), sourceSha256: hash(await readFile(import.meta.filename)), planned: selected.map(row => ({ id: row.id, config: row.config })), studyBudgetMs: STUDY_BUDGET_MS, requestDeadlineMs: REQUEST_DEADLINE_MS, threads: THREADS, modelResidentAcrossFailures: true, independentFollowup: true }, null, 2), { flag: 'wx' });
  const deadline = performance.now() + STUDY_BUDGET_MS;
  const results = [];
  try {
    for (const row of selected) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) break;
      await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'running', current: `${row.config}/${row.id}`, attempted: results.length, planned: selected.length }, null, 2) + '\n');
      const request = buildRecoveredProbeRequest(row.request);
      const started = performance.now();
      let result;
      let error;
      try { result = await runtime.request('/api/generate', request, AbortSignal.timeout(Math.min(remaining, REQUEST_DEADLINE_MS))); }
      catch (caught) { error = caught.message; }
      const raw = result?.response ?? '';
      const item = items.find(item => item.id === row.id);
      const entry = { id: row.id, config: row.config, request, result: result ?? null, raw, error: error ?? null, seconds: (performance.now() - started) / 1000, score: scoreItem(item, raw) };
      assert.deepEqual(entry.request, buildRecoveredProbeRequest(row.request));
      assert.deepEqual(entry.score, scoreItem(item, entry.raw));
      results.push(entry);
      await appendFile(resolve(OUTPUT, 'traces.jsonl'), JSON.stringify(entry) + '\n');
      console.log(JSON.stringify({ id: row.id, config: row.config, seconds: entry.seconds, error: entry.error, score: entry.score }));
    }
  } finally { await runtime.unload(MODEL); }
  const summary = { phase: 'completed', planned: selected.length, attempted: results.length, returned: results.filter(row => !row.error).length, exact: results.filter(row => !row.error && row.score.schemaValid && row.score.falsePositive === 0 && row.score.falseNegative === 0).length, originalFailuresRetained: true, humanReviewPending: true };
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(resolve(OUTPUT, 'review.md'), '# Separate 8B probe follow-up\n\nSame weights, prompts, schemas, seeds, context and output limits; newer runtime, four CPU threads, and model residency across failures. Ten-minute request limit retained, 45-minute overall cap. Original failures are unchanged; incomplete and erroneous probes are not passes. Concurrent host activity prevents controlled hardware comparisons.\n\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
