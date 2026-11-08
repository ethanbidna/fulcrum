import assert from 'node:assert/strict';
import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OllamaRuntime } from '../ollama.mjs';
import { scoreItem } from '../evaluate.mjs';

const DEADLINE_MS = 10 * 60 * 1000;
const OUTPUT = fileURLToPath(new URL('../out/probe-retries/', import.meta.url));
const originalKey = row => [row.model, row.config, row.id].join('/');
const hash = value => createHash('sha256').update(value).digest('hex');

export function selectFailedProbes(rows, attempts) {
  const tried = new Set(attempts.map(row => row.originalKey));
  return rows.filter(row => row.phase === 'full' && row.error && !tried.has(originalKey(row)));
}

async function readRows(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function run(directory) {
  assert.ok(directory, 'pass the original experiment output directory');
  const originalText = await readFile(resolve(directory, 'traces.jsonl'), 'utf8');
  const rows = originalText.trim().split('\n').map(line => JSON.parse(line));
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const items = JSON.parse(await readFile(new URL('../eval/items.json', import.meta.url), 'utf8'));
  await mkdir(OUTPUT, { recursive: true });
  const path = resolve(OUTPUT, 'traces.jsonl');
  const attempts = await readRows(path);
  const runtime = new OllamaRuntime();
  for (const row of selectFailedProbes(rows, attempts)) {
    assert.deepEqual(await runtime.describe(row.model), manifest.metadata[row.model]);
    const started = performance.now();
    let result;
    let error;
    let cause;
    try { result = await runtime.request('/api/generate', row.request, AbortSignal.timeout(DEADLINE_MS)); }
    catch (caught) { error = caught.message; cause = caught.cause?.code; }
    const raw = result?.response ?? '';
    const attempt = { originalKey: originalKey(row), originalTracesSha256: hash(originalText), originalError: row.error,
      attempt: 2, timestamp: new Date().toISOString(), request: row.request, result: result ?? null, raw,
      error: error ?? null, cause: cause ?? null, seconds: (performance.now() - started) / 1000,
      score: scoreItem(items.find(item => item.id === row.id), raw), metadata: manifest.metadata[row.model] };
    await appendFile(path, JSON.stringify(attempt) + '\n');
    console.log(JSON.stringify(attempt));
    try { await runtime.unload(row.model); } catch (caught) { console.error(caught.message); }
  }
  await writeFile(resolve(OUTPUT, 'status.json'), JSON.stringify({ phase: 'completed', originalFailuresRetained: true, retriesAreSeparate: true }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run(process.argv[2]);
