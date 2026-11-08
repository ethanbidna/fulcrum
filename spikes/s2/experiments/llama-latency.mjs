import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OllamaRuntime } from '../ollama.mjs';
import { localInferenceFetch } from './transport.mjs';
import { scoreItem } from '../evaluate.mjs';

const MODEL = 'llama3.1:8b-instruct-q4_K_M';
const ENDPOINT = 'http://127.0.0.1:11435';
const OUTPUT = fileURLToPath(new URL('../out/llama-latency/', import.meta.url));
const STUDY_BUDGET_MS = 30 * 60 * 1000;
const MAX_EVENTS = 8192;
const hash = value => createHash('sha256').update(value).digest('hex');

export function buildLatencyVariants(original) {
  return [
    { id: 'short-smoke', timeoutMs: 90_000, request: { model: original.model, prompt: 'Reply OK.', stream: true, keep_alive: '15m', options: { ...original.options, num_predict: 8 } } },
    { id: 'cold-prefill-one-token', timeoutMs: 900_000, request: { ...original, stream: true, options: { ...original.options, num_predict: 1 } } },
    { id: 'warm-original', timeoutMs: 600_000, request: { ...original, stream: true } },
    { id: 'warm-four-threads', timeoutMs: 600_000, request: { ...original, stream: true, options: { ...original.options, num_thread: 4 } } },
  ];
}

export function decodeStreamLines(pending, chunk) {
  const parts = (pending + chunk).split('\n');
  return { pending: parts.pop(), events: parts.filter(line => line.trim()).map(line => JSON.parse(line)) };
}

async function streamRequest(body, timeoutMs) {
  const started = performance.now();
  const events = [];
  let firstTokenSeconds = null;
  let headersSeconds = null;
  let pending = '';
  let error = null;
  try {
    await new Promise((resolve, reject) => {
      const request = httpRequest(ENDPOINT + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }, response => {
        headersSeconds = (performance.now() - started) / 1000;
        response.setEncoding('utf8');
        response.on('data', chunk => {
          try {
            const decoded = decodeStreamLines(pending, chunk);
            pending = decoded.pending;
            for (const event of decoded.events) {
              if (events.length >= MAX_EVENTS) throw new Error('Stream event limit reached');
              const seconds = (performance.now() - started) / 1000;
              if (event.response && firstTokenSeconds === null) firstTokenSeconds = seconds;
              events.push({ seconds, event });
              console.log(JSON.stringify({ streamSeconds: seconds, response: event.response, done: event.done, error: event.error }));
            }
          } catch (caught) { request.destroy(caught); }
        });
        response.once('error', reject);
        response.once('end', () => {
          if (response.statusCode !== 200) { reject(new Error(`HTTP ${response.statusCode}`)); return; }
          if (pending.trim()) { reject(new Error('Unterminated stream line')); return; }
          resolve();
        });
      });
      request.once('error', reject);
      request.end(JSON.stringify(body));
    });
  } catch (caught) { error = { message: caught.message, code: caught.code ?? null, cause: caught.cause?.code ?? null }; }
  return { seconds: (performance.now() - started) / 1000, headersSeconds, firstTokenSeconds, error, events,
    raw: events.map(row => row.event.response ?? '').join(''), final: events.findLast(row => row.event.done)?.event ?? null };
}

async function run() {
  const parentPath = fileURLToPath(new URL('../out/experiments/', import.meta.url));
  const parentText = await readFile(resolve(parentPath, 'traces.jsonl'), 'utf8');
  const parents = parentText.trim().split('\n').map(line => JSON.parse(line));
  const original = parents.find(row => row.model === MODEL && row.phase === 'full' && row.config === 'full-schema-text' && row.id === 's2-001');
  assert.ok(original);
  const runtime = new OllamaRuntime((url, options) => localInferenceFetch(String(url).replace(':11434', ':11435'), options));
  const metadata = await runtime.describe(MODEL);
  const parent = JSON.parse(await readFile(resolve(parentPath, 'manifest.json'), 'utf8')).metadata[MODEL];
  assert.equal(metadata.digest, parent.digest);
  assert.deepEqual(metadata.details, parent.details);
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(resolve(OUTPUT, 'manifest.json'), JSON.stringify({ model: MODEL, metadata, parentMetadata: parent, parentTracesSha256: hash(parentText), sourceSha256: hash(await readFile(import.meta.filename)), studyBudgetMs: STUDY_BUDGET_MS, variants: buildLatencyVariants(original.request), separateDiagnostic: true, concurrentInference: true }, null, 2), { flag: 'wx' });
  const items = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  const item = items.find(item => item.id === original.id);
  const deadline = performance.now() + STUDY_BUDGET_MS;
  const results = [];
  try {
    for (const variant of buildLatencyVariants(original.request)) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) break;
      await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'running', current: variant.id, results }, null, 2) + '\n');
      const result = { id: variant.id, request: variant.request, ...await streamRequest(variant.request, Math.min(remaining, variant.timeoutMs)) };
      if (variant.id.startsWith('warm-')) result.score = scoreItem(item, result.raw);
      await appendFile(resolve(OUTPUT, 'traces.jsonl'), JSON.stringify(result) + '\n');
      results.push({ id: result.id, seconds: result.seconds, firstTokenSeconds: result.firstTokenSeconds, completed: Boolean(result.final), error: result.error, metrics: result.final, score: result.score });
    }
  } finally { await runtime.unload(MODEL); }
  await writeFile(resolve(OUTPUT, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'completed', results, humanReviewPending: true }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
