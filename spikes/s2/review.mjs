import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { scoreItem, summarize, OUTPUT_SCHEMA, validateOutput } from './evaluate.mjs';
import { SYSTEM, GENERATION_OPTIONS } from './ollama.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key]), 0);

export function auditReport(report, datasetText) {
  const items = JSON.parse(datasetText);
  const expectedIds = items.map(item => item.id);
  if (new Set(expectedIds).size !== items.length) throw new Error('Duplicate dataset IDs');
  for (const item of items) {
    for (const candidate of item.expected) {
      const { start, end } = candidate.span;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > item.text.length) throw new Error(`Invalid gold span: ${item.id}`);
    }
  }
  const hashes = { dataset: report.datasetSha256 === hash(datasetText), schema: report.schemaSha256 === hash(JSON.stringify(OUTPUT_SCHEMA)),
    systemPrompt: report.systemPromptSha256 === hash(SYSTEM), generationOptions: isDeepStrictEqual(report.generationOptions, GENERATION_OPTIONS) };
  if (Object.values(hashes).some(value => !value)) throw new Error('Run configuration does not match review inputs');
  const models = report.models.map(model => {
    if (model.status !== 'completed' || !isDeepStrictEqual(model.rows.map(row => row.id), expectedIds)) throw new Error('Incomplete or reordered run');
    const failures = [];
    for (const [index, row] of model.rows.entries()) {
      for (const attempt of row.attempts) {
        if (!isDeepStrictEqual(scoreItem(items[index], attempt.response), attempt.score)) failures.push(row.id);
      }
      if (!isDeepStrictEqual(row.initial, row.attempts[0].score) || !isDeepStrictEqual(row.final, row.attempts.at(-1).score)) failures.push(row.id);
    }
    const initial = summarize(model.rows.map(row => row.initial));
    const final = summarize(model.rows.map(row => row.final));
    if (!isDeepStrictEqual(initial, model.initial) || !isDeepStrictEqual(final, model.afterRepair)) failures.push('summary');
    if (failures.length) throw new Error(`Stored score mismatch: ${failures.join(', ')}`);
    const rows = model.rows.map(row => row.final);
    const negatives = rows.filter((_, index) => !items[index].injection && items[index].expected.length === 0);
    const attacks = rows.filter(row => row.injection);
    const kindCounts = {};
    for (const [index, row] of model.rows.entries()) {
      const response = row.attempts.at(-1).response;
      try {
        const output = JSON.parse(response);
        if (!validateOutput(output, items[index].text)) continue;
        for (const candidate of output.candidates) kindCounts[candidate.kind] = (kindCounts[candidate.kind] ?? 0) + 1;
      } catch {}
    }
    return { model: model.model, allStoredScoresReproduced: true, items: rows.length,
      truePositive: sum(rows, 'truePositive'), falsePositive: sum(rows, 'falsePositive'), falseNegative: sum(rows, 'falseNegative'),
      userCommitments: sum(rows, 'userTasks'), unsupportedUserCommitments: sum(rows, 'misattributedTasks'),
      repairedItems: model.rows.filter(row => row.attempts.length > 1).length,
      invalidAfterRepair: rows.filter(row => !row.schemaValid).map(row => row.id),
      negativeItems: negatives.length, negativesWithCandidates: negatives.filter(row => row.falsePositive > 0).length,
      attackItems: attacks.length, attackProxyFailures: attacks.filter(row => row.injectionFollowed).length,
      attackInvalidOutputs: attacks.filter(row => !row.schemaValid).length,
      attackValidUnexpectedCandidates: attacks.filter(row => row.schemaValid && row.injectionFollowed).length,
      emittedKinds: kindCounts, initial, afterRepair: final };
  });
  return { formatVersion: 1, hashes, goldSpansInBounds: true, models };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: review.mjs REPORT OUTPUT');
  const datasetText = await readFile(new URL('./eval/items.json', import.meta.url), 'utf8');
  const result = auditReport(JSON.parse(await readFile(input, 'utf8')), datasetText);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
