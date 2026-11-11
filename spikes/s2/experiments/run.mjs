import { createHash } from 'node:crypto';
import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIFIERS, FULL_CONFIGS, buildRequest, buildPayloadRequest, normalizeExtraction, scoreKinds } from './configurations.mjs';
import { HOLDOUT } from './holdout.mjs';
import { scoreItem } from '../evaluate.mjs';
import { OllamaRuntime } from '../ollama.mjs';

const MODELS = ['llama3.2:3b-instruct-q4_K_M', 'llama3.1:8b-instruct-q4_K_M'];
const ENDPOINT = 'http://127.0.0.1:11434';
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUTPUT = resolve(ROOT, 'spikes/s2/out/experiments');
const DATASET = fileURLToPath(new URL('../eval/items.json', import.meta.url));
const FULL_IDS = [1, 5, 9, 13, 25, 29, 33, 48];
const SCREEN_IDS = [1, 2, 5, 6, 9, 12, 13, 14, 17, 18, 21, 23, 25, 26, 29, 31, 33, 35, 36, 40, 41, 43, 46, 48];
const hash = value => createHash('sha256').update(value).digest('hex');
const key = row => `${row.phase}/${row.model}/${row.config}/${row.id}/${row.kind ?? ''}`;

export function rankConfigurations(rows, configurations = CLASSIFIERS) {
  return configurations.map(config => {
    const selected = rows.filter(row => row.config === config.id);
    const total = field => selected.reduce((sum, row) => sum + Number(row.score[field] ?? 0), 0);
    return { config, count: selected.length, exact: total('exact'), fp: total('fp'), fn: total('fn'), invalid: selected.length - total('valid') };
  }).sort((first, second) => second.exact - first.exact || first.fp - second.fp || first.invalid - second.invalid || first.fn - second.fn);
}

async function request(route, body) {
  const started = performance.now();
  try {
    const response = await fetch(`${ENDPOINT}/api/${route}`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const result = await response.json();
    return { result, raw: result.response ?? result.message?.content ?? '', seconds: (performance.now() - started) / 1000 };
  } catch (error) {
    return { raw: '', error: error.message, seconds: (performance.now() - started) / 1000 };
  }
}

async function readRows(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function run() {
  await mkdir(OUTPUT, { recursive: true });
  const datasetText = await readFile(DATASET, 'utf8');
  const development = JSON.parse(datasetText);
  const screen = development.filter(item => SCREEN_IDS.includes(Number(item.id.slice(-3))));
  const remainder = development.filter(item => !SCREEN_IDS.includes(Number(item.id.slice(-3))));
  const paths = ['configurations.mjs', 'holdout.mjs', 'run.mjs'];
  const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(new URL(path, import.meta.url)))])));
  const identity = { dataset: hash(datasetText), sourceHashes };
  const manifestPath = resolve(OUTPUT, 'manifest.json');
  let previous;
  try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && JSON.stringify(previous.identity) !== JSON.stringify(identity)) throw new Error('Experiment changed; use a fresh output directory');
  const runtime = new OllamaRuntime();
  const metadata = Object.fromEntries(await Promise.all(MODELS.map(async model => [model, await runtime.describe(model)])));
  if (previous && JSON.stringify(previous.metadata) !== JSON.stringify(metadata)) throw new Error('Runtime/model identity changed');
  await writeFile(manifestPath, `${JSON.stringify({ ...previous, identity, metadata, node: process.version, startedAt: previous?.startedAt ?? new Date().toISOString(), screenIds: screen.map(item => item.id), holdoutCount: HOLDOUT.length, selection: 'Two best classifiers per model by screening exact-set accuracy, then false positives, invalid outputs, false negatives; ties retain declared order. Payload uses screening winner, never holdout winner.', configs: [...CLASSIFIERS, ...FULL_CONFIGS] }, null, 2)}\n`);
  const tracePath = resolve(OUTPUT, 'traces.jsonl');
  const rows = await readRows(tracePath);
  const completed = new Map(rows.map(row => [key(row), row]));
  const pipelinePath = resolve(OUTPUT, 'pipeline.jsonl');
  const pipeline = new Map((await readRows(pipelinePath)).map(row => [`${row.model}/${row.id}`, row]));
  const winners = {};
  let interrupted = false;
  process.once('SIGINT', () => { interrupted = true; });
  process.once('SIGTERM', () => { interrupted = true; });

  async function record(row, body, route, score) {
    if (interrupted) throw new Error('Interrupted between requests');
    const existing = completed.get(key(row));
    if (existing) return existing;
    const outcome = await request(route, body);
    const entry = { ...row, timestamp: new Date().toISOString(), request: body, ...outcome, score: score(outcome.raw) };
    await appendFile(tracePath, `${JSON.stringify(entry)}\n`);
    rows.push(entry);
    completed.set(key(entry), entry);
    await writeFile(resolve(OUTPUT, 'status.json'), `${JSON.stringify({ requests: rows.length, latest: key(entry), seconds: entry.seconds, score: entry.score, updatedAt: entry.timestamp, phase: 'running' }, null, 2)}\n`);
    console.log(JSON.stringify({ requests: rows.length, latest: key(entry), seconds: Math.round(entry.seconds), score: entry.score }));
    if (entry.error) throw new Error(`Request failed; preserved trace: ${entry.error}`);
    return entry;
  }

  async function classify(phase, model, config, items) {
    for (const item of items) await record({ phase, model, config: config.id, id: item.id }, buildRequest(model, config, item), config.api, raw => scoreKinds(item, raw));
  }

  try {
    for (const model of MODELS) {
      for (const config of CLASSIFIERS) await classify('screen', model, config, screen);
      const ranking = rankConfigurations(rows.filter(row => row.phase === 'screen' && row.model === model));
      winners[model] = ranking.slice(0, 2).map(row => row.config);
      await writeFile(resolve(OUTPUT, 'selection.json'), `${JSON.stringify(winners, null, 2)}\n`);
      for (const config of winners[model]) {
        await classify('development-remainder', model, config, remainder);
        await classify('holdout', model, config, HOLDOUT);
      }
      const winner = winners[model][0];
      for (const item of [...development, ...HOLDOUT]) {
        const phase = item.id.startsWith('h-') ? 'holdout' : SCREEN_IDS.includes(Number(item.id.slice(-3))) ? 'screen' : 'development-remainder';
        const classification = completed.get(key({ phase, model, config: winner.id, id: item.id }));
        const kinds = classification.score.valid ? JSON.parse(classification.raw).kinds : [];
        const candidates = [];
        let rejected = 0;
        for (const kind of kinds) {
          const trace = await record({ phase: 'payload', model, config: winner.id, id: item.id, kind }, buildPayloadRequest(model, item, kind), 'generate', raw => {
            const normalized = normalizeExtraction(item, kind, raw);
            return { valid: normalized.valid, rejected: normalized.rejected };
          });
          const normalized = normalizeExtraction(item, kind, trace.raw);
          rejected += normalized.rejected;
          candidates.push(...normalized.candidates);
        }
        const result = { model, config: winner.id, id: item.id, split: item.id.startsWith('h-') ? 'holdout' : 'development', classificationValid: classification.score.valid, rejected, candidates, score: scoreItem(item, { candidates }) };
        pipeline.set(`${model}/${item.id}`, result);
        await writeFile(pipelinePath, [...pipeline.values()].map(row => JSON.stringify(row)).join('\n') + '\n');
      }
      for (const config of FULL_CONFIGS) {
        for (const item of development.filter(item => FULL_IDS.includes(Number(item.id.slice(-3))))) {
          await record({ phase: 'full', model, config: config.id, id: item.id }, buildRequest(model, config, item), 'generate', raw => scoreItem(item, raw));
        }
      }
      await runtime.unload(model);
    }
    await writeFile(resolve(OUTPUT, 'status.json'), `${JSON.stringify({ requests: rows.length, phase: 'completed', completedAt: new Date().toISOString() }, null, 2)}\n`);
  } finally {
    await Promise.allSettled(MODELS.map(model => runtime.unload(model)));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
