import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildChallengerRequest } from './challengers.mjs';
import { alignQuote, normalizeExtraction, scoreKinds } from './configurations.mjs';
import { localInferenceFetch } from './transport.mjs';
import { scoreItem } from '../evaluate.mjs';
import { OllamaRuntime } from '../ollama.mjs';
import { hardwareSummary, sampleResources } from '../resources.mjs';

const MODEL = 'qwen3.5:4b';
const CONFIGURATION = 'kind-chat';
const VERSION = '0.40.15';
const DIGEST = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const PORT = '11435';
const WALL_BUDGET_MS = 2 * 60 * 60 * 1000;
const REQUEST_BUDGET_MS = 5 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 1000;
const FIXTURE = '../eval/qwen35-holdout.json';
const SOURCES = [FIXTURE, 'qwen35-holdout.mjs', 'challengers.mjs', 'configurations.mjs', 'transport.mjs', '../evaluate.mjs', '../ollama.mjs', '../resources.mjs', '../thermal.swift'];

function referenceItem(item) {
  const expected = item.expected.map(({ quote, ...fields }) => {
    const span = alignQuote(item.text, quote);
    assert.ok(span, `Invalid reference quote for ${item.id}`);
    return { ...fields, span };
  });
  return { ...item, expected };
}

export async function evaluateCase(fixture, request) {
  const item = referenceItem(fixture);
  const candidates = [];
  const payloads = [];
  const result = { id: item.id, stratum: item.stratum, candidates, payloads };
  const route = await request(item);
  if (!route) return { ...result, complete: false, exact: false };

  const routing = scoreKinds(item, route.message?.content ?? '');
  const kinds = routing.valid ? JSON.parse(route.message.content).kinds : [];
  let complete = true;
  for (const kind of kinds) {
    const payload = await request(item, kind);
    if (!payload) {
      complete = false;
      continue;
    }
    const normalized = normalizeExtraction(item, kind, payload.message?.content ?? '');
    payloads.push({ kind, valid: normalized.valid, rejected: normalized.rejected });
    candidates.push(...normalized.candidates);
  }

  const score = scoreItem(item, { candidates });
  const exact = complete && routing.valid && payloads.every(payload => payload.valid && payload.rejected === 0)
    && score.schemaValid && score.falsePositive === 0 && score.falseNegative === 0;
  return { ...result, complete, routing, score, exact };
}

async function sourceHashes() {
  return Object.fromEntries(await Promise.all(SOURCES.map(async path => [
    path, createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex'),
  ])));
}

function createJournal(directory) {
  return (file, row) => appendFile(join(directory, file), JSON.stringify(row) + '\n');
}

function createRequest(runtime, journal, stop, deadline) {
  return async (item, kind) => {
    const remaining = Math.floor(deadline - performance.now());
    if (stop.aborted || remaining <= 0) return null;

    const frame = { id: item.id, kind: kind ?? null };
    const request = buildChallengerRequest(MODEL, CONFIGURATION, item, kind);
    const started = performance.now();
    const timeout = AbortSignal.timeout(Math.min(REQUEST_BUDGET_MS, remaining));
    await journal('requests.jsonl', { ...frame, request, at: new Date().toISOString() });
    let response;
    let error;
    try {
      response = await runtime.request('/api/chat', request, AbortSignal.any([stop, timeout]));
    } catch (caught) {
      error = { type: stop.aborted ? 'stopped' : timeout.aborted ? 'timeout' : 'request-error', message: caught.message };
    }
    await journal('responses.jsonl', { ...frame, response: response ?? null, error: error ?? null, wallMs: performance.now() - started });
    return response ?? null;
  };
}

async function main(directory) {
  const runtime = new OllamaRuntime((input, options) => {
    const url = new URL(input);
    url.port = PORT;
    return localInferenceFetch(url, options);
  });
  const identity = await runtime.describe(MODEL);
  assert.equal(identity.digest, DIGEST);
  assert.equal(identity.ollamaVersion, VERSION);
  assert.equal(identity.details.quantization_level, 'Q4_K_M');

  const fixtures = JSON.parse(await readFile(new URL(FIXTURE, import.meta.url), 'utf8'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  await mkdir(directory);
  const journal = createJournal(directory);
  const manifest = { model: MODEL, identity, configuration: CONFIGURATION, revision,
    hashes: await sourceHashes(), wallBudgetMs: WALL_BUDGET_MS, requestBudgetMs: REQUEST_BUDGET_MS,
    cases: fixtures.map(item => item.id), hardware: hardwareSummary(), started: new Date().toISOString() };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const deadline = performance.now() + WALL_BUDGET_MS;
  const request = createRequest(runtime, journal, stop.signal, deadline);
  let samplingError;
  let sample = Promise.resolve();
  const collect = () => {
    sample = sample.then(() => journal('resources.jsonl', { at: new Date().toISOString(), ...sampleResources() }))
      .catch(error => { samplingError = error; stop.abort(); });
  };
  collect();
  const sampler = setInterval(collect, SAMPLE_INTERVAL_MS);
  try {
    for (const item of fixtures) {
      if (stop.signal.aborted || performance.now() >= deadline) break;
      const result = await evaluateCase(item, request);
      await journal('cases.jsonl', result);
      console.log(`${item.id} ${result.complete ? 'completed' : 'incomplete'}`);
    }
  } finally {
    clearInterval(sampler);
    await sample;
  }
  if (samplingError) throw samplingError;
  await writeFile(join(directory, 'status.json'), JSON.stringify({
    ended: new Date().toISOString(), stopped: stop.signal.aborted, budgetExpired: performance.now() >= deadline,
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: qwen35-holdout.mjs NEW_OUTPUT_DIRECTORY');
  await main(resolve(directory));
}
