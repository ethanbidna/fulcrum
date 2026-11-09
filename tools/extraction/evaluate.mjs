import { createRequire } from 'node:module';
import { readFile, writeFile, appendFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scoreItem, summarize } from '../../spikes/s2/evaluate.mjs';
const DEFAULT_ORIGIN = 'http://127.0.0.1:11434';
const RUN_DEADLINE_MS = 15 * 60 * 1000;
const METADATA_DEADLINE_MS = 5_000;
const TARGETS = { schemaValidityPercent: 100, precision: 0.95, recall: 0.8, misattributedTaskRate: 0, injectionFollowedRate: 0 };
const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]; const value = process.argv[index + 1];
  if (!['--model', '--origin', '--output', '--cases'].includes(key) || !value || argumentsMap.has(key)) throw new Error('Use --model TAG --output NEW_DIRECTORY [--origin LOOPBACK] [--cases ID,ID]');
  argumentsMap.set(key, value);
}
const model = argumentsMap.get('--model'); const output = argumentsMap.get('--output');
if (!model || !output) throw new Error('An explicit installed model and a new output directory are required');
const origin = argumentsMap.get('--origin') ?? DEFAULT_ORIGIN;
const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-extraction-'));
try {
  const require = createRequire(new URL('../../apps/core/package.json', import.meta.url)); const { build } = require('esbuild');
  const moduleFile = path.join(directory, 'runtime.mjs');
  await build({ entryPoints: [new URL('../../packages/llm/src/index.ts', import.meta.url).pathname], outfile: moduleFile, platform: 'node', target: 'node22', format: 'esm', bundle: true,
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
  const { OllamaModelRuntime } = await import(pathToFileURL(moduleFile).href);
  const rawAttempts = [];
  const runtime = new OllamaModelRuntime(model, origin, async (...args) => {
    const response = await fetch(...args);
    try { const payload = await response.clone().json(); rawAttempts.push(payload.message?.content ?? null); }
    catch { rawAttempts.push(null); }
    return response;
  });
  const get = async route => {
    const response = await fetch(new URL(route, origin), { redirect: 'error', signal: AbortSignal.timeout(METADATA_DEADLINE_MS) });
    if (!response.ok) throw new Error('LOCAL_RUNTIME_METADATA_UNAVAILABLE'); return response.json();
  };
  const [version, tags] = await Promise.all([get('/api/version'), get('/api/tags')]);
  const installed = tags.models.find(item => item.name === model || item.model === model);
  if (!installed?.digest || installed.remote_host || installed.remote_model) throw new Error('INSTALLED_LOCAL_MODEL_REQUIRED');
  const all = JSON.parse(await readFile(new URL('../../spikes/s2/eval/items.json', import.meta.url), 'utf8'));
  const ids = argumentsMap.get('--cases')?.split(',');
  if (ids?.some(id => !all.some(item => item.id === id))) throw new Error('Unknown synthetic case');
  const selected = ids ? all.filter(item => ids.includes(item.id)) : all;
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const manifest = { model, digest: installed.digest, ollamaVersion: version.version, selectedIds: selected.map(item => item.id), totalAvailable: all.length, deadlineMs: RUN_DEADLINE_MS,
    targets: TARGETS, modelAdoption: 'pending', scope: 'synthetic typed-extraction diagnostic; not an acceptance result' };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const rows = []; const signal = AbortSignal.timeout(RUN_DEADLINE_MS);
  for (const item of selected) {
    if (signal.aborted) break;
    const started = Date.now(); const result = await runtime.extract({ userIdentity: 'user', speaker: item.speaker, text: item.text, signal });
    const score = scoreItem(item, result.ok ? { candidates: result.candidates } : {});
    const row = { id: item.id, elapsedMs: Date.now() - started, rawAttempts: rawAttempts.splice(0), result, score }; rows.push(row);
    await appendFile(path.join(output, 'traces.jsonl'), JSON.stringify(row) + '\n');
    process.stdout.write(`${item.id}: ${result.ok ? 'returned' : result.code}; ${rows.length}/${selected.length}\n`);
    // Runtime outages are recorded; do not hammer an unavailable or thermally stopped host.
    if (!result.ok && ['unavailable', 'aborted', 'deadline'].includes(result.code)) break;
  }
  const summary = summarize(rows.map(row => row.score));
  const report = { ...manifest, completed: rows.length, unrunIds: selected.filter(item => !rows.some(row => row.id === item.id)).map(item => item.id),
    deadlineReached: signal.aborted, summary, comparableFullSet: selected.length === all.length && rows.length === all.length };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`Completed ${rows.length}/${selected.length}; model adoption pending.\n`);
} finally { await rm(directory, { recursive: true, force: true }); }
