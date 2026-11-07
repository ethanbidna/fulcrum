import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { OllamaRuntime, SYSTEM, GENERATION_OPTIONS } from './ollama.mjs';
import { scoreItem, summarize, OUTPUT_SCHEMA } from './evaluate.mjs';
import { hardwareSummary, sampleResources } from './resources.mjs';

const MODELS = ['llama3.2:1b-instruct-q4_K_M', 'llama3.2:3b-instruct-q4_K_M', 'llama3.1:8b-instruct-q4_K_M'];
const SAMPLE_INTERVAL_MS = 1000;
const NANOSECONDS_PER_SECOND = 1e9;
const ITEMS_PER_BATTERY_UNIT = 100;
const MAXIMUM_ATTEMPTS = 2;
const defaultOutput = 'spikes/s2/out/results.json';

function parseOptions(args) {
  const options = { output: defaultOutput, models: MODELS };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !['--output', '--model'].includes(flag)) throw new Error('Usage: node spikes/s2/benchmark.mjs [--model TAG] [--output FILE]');
    if (flag === '--output') options.output = value;
    if (flag === '--model') {
      if (!MODELS.includes(value)) throw new Error('Use one of the three documented local Q4 model tags');
      options.models = [value];
    }
  }
  return options;
}

export async function extractItem(runtime, model, item, signal) {
  const attempts = [];
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt++) {
    const started = performance.now();
    const response = await runtime.extract(model, item, signal, { mode: attempt > 0 ? 'repair' : 'initial' });
    const score = scoreItem(item, response.response);
    attempts.push({ response: response.response, score, latencyMs: performance.now() - started,
      evalCount: response.eval_count ?? null, evalDurationNs: response.eval_duration ?? null,
      loadDurationNs: response.load_duration ?? null, doneReason: response.done_reason ?? null });
    if (score.schemaValid) break;
  }
  return { id: item.id, attempts, initial: attempts[0].score, final: attempts.at(-1).score };
}

function resourceSummary(samples, count) {
  const values = key => samples.map(row => row[key]).filter(value => value !== null);
  const max = key => values(key).length ? Math.max(...values(key)) : null;
  const first = samples[0];
  const last = samples.at(-1);
  const batteryOnly = samples.every(row => row.onBattery && row.batteryPercent !== null);
  return { sampledPeakRssBytes: max('rssBytes'), sampledPeakCpuPercent: max('cpuPercent'),
    swapStartBytes: first.swapUsedBytes, swapEndBytes: last.swapUsedBytes, sampledPeakSwapBytes: max('swapUsedBytes'),
    batteryPercentagePointsPer100Items: batteryOnly && count ? (first.batteryPercent - last.batteryPercent) * ITEMS_PER_BATTERY_UNIT / count : null,
    thermalState: null, batteryOnly, sampleIntervalMs: SAMPLE_INTERVAL_MS };
}

export async function runModel(runtime, model, items, signal, save, sampleDriver = sampleResources) {
  const metadata = await runtime.describe(model);
  const samples = [];
  const rows = [];
  const started = performance.now();
  const sample = () => samples.push({ elapsedMs: performance.now() - started, ...sampleDriver() });
  sample();
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  let status = 'completed';
  let failure = null;
  try {
    for (const item of items) {
      signal.throwIfAborted();
      rows.push(await extractItem(runtime, model, item, signal));
      process.stdout.write(`${model}: ${rows.length}/${items.length}\n`);
    }
  } catch (error) {
    status = signal.aborted ? 'interrupted' : 'failed';
    failure = signal.aborted ? 'signal' : error.name;
  } finally {
    clearInterval(timer);
    sample();
  }
  const attempts = rows.flatMap(row => row.attempts);
  const durations = attempts.filter(row => row.evalDurationNs > 0 && row.evalCount !== null);
  const totalDuration = durations.reduce((sum, row) => sum + row.evalDurationNs, 0);
  const result = { model, ...metadata, status, failure, completedItems: rows.length, totalItems: items.length,
    wallTimeMs: performance.now() - started, initial: summarize(rows.map(row => row.initial)),
    afterRepair: summarize(rows.map(row => row.final)),
    tokensPerSecond: totalDuration ? durations.reduce((sum, row) => sum + row.evalCount, 0) * NANOSECONDS_PER_SECOND / totalDuration : null,
    resources: resourceSummary(samples, rows.length), samples, rows,
    manual: { uiResponsive: null, backgroundQosConfirmed: null, pauseStopsCpuWithin5Seconds: null, thermalLog: null, fanObservation: null } };
  // Aborting HTTP is not proof that inference has stopped; the manual CPU check is required.
  try { await runtime.unload(model); } catch { result.unloadFailed = true; }
  await save(result);
  return result;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const data = await readFile(new URL('./eval/items.json', import.meta.url), 'utf8');
  const items = JSON.parse(data);
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const report = { formatVersion: 1, startedAt: new Date().toISOString(), hardware: hardwareSummary(),
    datasetSha256: createHash('sha256').update(data).digest('hex'),
    schemaSha256: createHash('sha256').update(JSON.stringify(OUTPUT_SCHEMA)).digest('hex'), models: [] };
  report.systemPromptSha256 = createHash('sha256').update(SYSTEM).digest('hex');
  report.generationOptions = GENERATION_OPTIONS;
  const save = async result => {
    report.models.push(result);
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
  };
  const runtime = new OllamaRuntime();
  for (const model of options.models) {
    const result = await runModel(runtime, model, items, controller.signal, save);
    if (result.status !== 'completed') { process.exitCode = 1; break; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`Benchmark failed: ${error.name}. Check local Ollama, model tags, and output permissions.\n`); process.exitCode = 1; });
}
