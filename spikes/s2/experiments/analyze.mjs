import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CLASSIFIERS, FULL_CONFIGS, buildRequest, buildPayloadRequest, normalizeExtraction, scoreKinds } from './configurations.mjs';
import { HOLDOUT } from './holdout.mjs';
import { scoreItem } from '../evaluate.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DEFAULT_OUTPUT = resolve(ROOT, 'spikes/s2/out/experiments');
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row.score[field] ?? 0), 0);
function median(values) {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  if (!ordered.length) return null;
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarizeClassification(rows, items) {
  const tp = sum(rows, 'tp');
  const fp = sum(rows, 'fp');
  const fn = sum(rows, 'fn');
  const negatives = rows.filter(row => items.get(row.id).expected.length === 0 && !items.get(row.id).injection);
  const attacks = rows.filter(row => items.get(row.id).injection);
  return {
    requests: rows.length, valid: sum(rows, 'valid'), exact: sum(rows, 'exact'), tp, fp, fn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    negativePass: sum(negatives, 'exact'), negativeCount: negatives.length,
    attackPass: sum(attacks, 'exact'), attackCount: attacks.length,
    medianSeconds: median(rows.map(row => row.seconds)), totalSeconds: rows.reduce((total, row) => total + row.seconds, 0),
  };
}

function summarizeExtraction(rows, items) {
  const tp = sum(rows, 'truePositive');
  const fp = sum(rows, 'falsePositive');
  const fn = sum(rows, 'falseNegative');
  const pass = row => row.classificationValid !== false && row.score.schemaValid && row.score.falsePositive === 0 && row.score.falseNegative === 0;
  const negatives = rows.filter(row => items.get(row.id).expected.length === 0 && !items.get(row.id).injection);
  const attacks = rows.filter(row => items.get(row.id).injection);
  const userTasks = rows.flatMap(row => (row.candidates ?? []).filter(candidate => candidate.kind === 'user_commitment').map(candidate => ({ row, candidate })));
  return {
    items: rows.length, valid: sum(rows, 'schemaValid'), exact: rows.filter(pass).length, tp, fp, fn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    negativePass: negatives.filter(pass).length, negativeCount: negatives.length,
    attackPass: attacks.filter(pass).length, attackCount: attacks.length,
    rejected: rows.reduce((total, row) => total + (row.rejected ?? 0), 0),
    userTasks: userTasks.length,
    wrongUserKind: userTasks.filter(({ row }) => !items.get(row.id).expected.some(candidate => candidate.kind === 'user_commitment')).length,
  };
}

async function readRows(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function analyze(directory = DEFAULT_OUTPUT) {
  const developmentText = await readFile(new URL('../eval/items.json', import.meta.url), 'utf8');
  const development = JSON.parse(developmentText);
  const items = new Map([...development, ...HOLDOUT].map(item => [item.id, item]));
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.identity.dataset, sha256(developmentText));
  for (const [path, digest] of Object.entries(manifest.identity.sourceHashes)) assert.equal(sha256(await readFile(new URL(path, import.meta.url))), digest, `changed source ${path}`);
  const rows = await readRows(resolve(directory, 'traces.jsonl'));
  const keys = rows.map(row => [row.phase, row.model, row.config, row.id, row.kind ?? ''].join('/'));
  assert.equal(new Set(keys).size, keys.length, 'duplicate trace');
  for (const row of rows) {
    const item = items.get(row.id);
    assert.ok(item, `unknown item ${row.id}`);
    let expectedRequest;
    let expectedScore;
    if (row.phase === 'payload') {
      expectedRequest = buildPayloadRequest(row.model, item, row.kind);
      const normalized = normalizeExtraction(item, row.kind, row.raw);
      expectedScore = { valid: normalized.valid, rejected: normalized.rejected };
    } else {
      const config = [...CLASSIFIERS, ...FULL_CONFIGS].find(config => config.id === row.config);
      assert.ok(config, 'unknown configuration');
      expectedRequest = buildRequest(row.model, config, item);
      expectedScore = config.task === 'full' ? scoreItem(item, row.raw) : scoreKinds(item, row.raw);
    }
    assert.deepEqual(row.request, expectedRequest, `request changed ${row.id}`);
    assert.deepEqual(row.score, expectedScore, `score changed ${row.id}`);
  }
  const pipeline = await readRows(resolve(directory, 'pipeline.jsonl'));
  const pipelineKeys = pipeline.map(row => `${row.model}/${row.id}`);
  assert.equal(new Set(pipelineKeys).size, pipelineKeys.length, 'duplicate pipeline item');
  for (const row of pipeline) {
    const item = items.get(row.id);
    const classification = rows.find(trace => trace.model === row.model && trace.config === row.config && trace.id === row.id && trace.phase !== 'payload' && trace.phase !== 'full');
    assert.ok(classification, 'missing classification');
    const kinds = classification.score.valid ? JSON.parse(classification.raw).kinds : [];
    const extracted = kinds.map(kind => {
      const trace = rows.find(trace => trace.phase === 'payload' && trace.model === row.model && trace.config === row.config && trace.id === row.id && trace.kind === kind);
      assert.ok(trace, `missing payload ${row.id}/${kind}`);
      return normalizeExtraction(item, kind, trace.raw);
    });
    assert.deepEqual(row.candidates, extracted.flatMap(result => result.candidates));
    assert.equal(row.rejected, extracted.reduce((total, result) => total + result.rejected, 0));
    assert.equal(row.classificationValid, classification.score.valid);
    assert.deepEqual(row.score, scoreItem(item, { candidates: row.candidates }));
  }
  const groups = {};
  for (const row of rows.filter(row => row.phase !== 'payload' && row.phase !== 'full')) {
    const group = `${row.model}/${row.phase}/${row.config}`;
    (groups[group] ??= []).push(row);
  }
  const classification = Object.fromEntries(Object.entries(groups).map(([group, selected]) => [group, summarizeClassification(selected, items)]));
  const extraction = {};
  for (const model of Object.keys(manifest.metadata)) for (const split of ['development', 'holdout']) {
    const selected = pipeline.filter(row => row.model === model && row.split === split);
    if (selected.length) extraction[`${model}/${split}`] = summarizeExtraction(selected, items);
  }
  const full = {};
  for (const model of Object.keys(manifest.metadata)) for (const config of FULL_CONFIGS) {
    const selected = rows.filter(row => row.model === model && row.config === config.id);
    if (selected.length) full[`${model}/${config.id}`] = summarizeExtraction(selected, items);
  }
  const result = { requests: rows.length, replayed: true, classification, extraction, full };
  await writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await analyze(process.argv[2]), null, 2));
