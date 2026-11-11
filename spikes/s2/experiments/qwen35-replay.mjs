import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildChallengerRequest } from './challengers.mjs';
import { evaluateCase } from './qwen35-holdout.mjs';

const SOURCE = new URL('../eval/qwen35-holdout.json', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parseRows = bytes => bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));

export async function replayHoldout(directory) {
  const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
  const files = new Map(await Promise.all(Object.entries(summary.artifactSha256).map(async ([name, expected]) => {
    const bytes = await readFile(join(directory, name));
    assert.equal(digest(bytes), expected, `Archive hash mismatch: ${name}`);
    return [name, bytes];
  })));
  const manifest = JSON.parse(files.get('manifest.json'));
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    assert.equal(digest(await readFile(new URL(name, import.meta.url))), expected, `Source hash mismatch: ${name}`);
  }
  const fixtures = JSON.parse(await readFile(SOURCE));
  assert.deepEqual(manifest.cases, fixtures.map(item => item.id));

  const requests = parseRows(files.get('requests.jsonl'));
  const responses = parseRows(files.get('responses.jsonl'));
  assert.equal(requests.length, responses.length);
  let cursor = 0;
  const cases = [];
  for (const fixture of fixtures) {
    cases.push(await evaluateCase(fixture, async (item, kind) => {
      const sent = requests[cursor];
      const received = responses[cursor++];
      const context = `${item.id} ${kind ?? 'classifier'}`;
      assert.equal(sent?.id, item.id, context);
      assert.equal(sent.kind, kind ?? null, context);
      assert.deepEqual(sent.request, buildChallengerRequest(manifest.model, manifest.configuration, item, kind), context);
      assert.equal(received?.id, sent.id, context);
      assert.equal(received.kind, sent.kind, context);
      assert.equal(received.error, null, context);
      assert.ok(received.response, context);
      return received.response;
    }));
  }
  assert.equal(cursor, requests.length, 'Unconsumed archive rows');
  assert.deepEqual(cases, parseRows(files.get('cases.jsonl')));
  const completed = cases.filter(row => row.complete).length;
  const exact = cases.filter(row => row.exact).length;
  const scores = Object.fromEntries(Object.keys(summary.completedCaseScores).map(key => [
    key, cases.filter(row => row.complete).reduce((total, row) => total + row.score[key], 0),
  ]));
  assert.equal(completed, summary.completed);
  assert.equal(exact, summary.exact);
  assert.deepEqual(scores, summary.completedCaseScores);
  return { requests: cursor, completed, exact, ...scores };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: qwen35-replay.mjs ARCHIVE_DIRECTORY');
  console.log(JSON.stringify(await replayHoldout(directory), null, 2));
}
