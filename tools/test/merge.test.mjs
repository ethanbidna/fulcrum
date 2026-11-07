import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readJson, REPO_ROOT } from '../reference/schemas.mjs';
import { readWorkspace } from '../reference/workspace-reader.mjs';
import { fold, toStateDocument, fromStateDocument, checkpointIsUsable } from '../reference/fold.mjs';

const expected = readJson('fixtures/scenarios/expectations.json').crossDeviceCollision;
const ws = () => readWorkspace(path.join(REPO_ROOT, expected.workspace));

function shuffled(items, seed) {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('reader dedupes conflicted-copy segments and ignores a torn tail', () => {
  const { events, diagnostics } = ws();
  assert.equal(events.length, expected.eventCount);
  const found = new Set(diagnostics.map(d => d.code));
  for (const code of expected.diagnosticsInclude) assert.ok(found.has(code), code);
  assert.ok(!found.has('EVENT_ID_COLLISION'));
});

test('concurrent MoSCoW edits on two Macs: deterministic winner plus a material conflict', () => {
  const { state, conflicts, frontier } = fold(ws().events);
  const initiative = state.initiatives.get(expected.finalInitiative.id);
  assert.equal(initiative.title, expected.finalInitiative.title);
  assert.equal(initiative.moscow, expected.finalInitiative.moscow);
  assert.deepEqual(frontier, expected.frontier);
  assert.equal(conflicts.length, expected.conflicts.length);
  const [conflict] = conflicts;
  for (const key of ['type', 'kind', 'id', 'field', 'values', 'material']) assert.deepEqual(conflict[key], expected.conflicts[0][key], key);
  assert.equal(`sync:${conflict.kind}:${conflict.id}:${conflict.field}`, expected.expectedQuestionDedupeKey);
});

test('fold result is independent of arrival order', () => {
  const { events } = ws();
  const reference = JSON.stringify(toStateDocument(fold(events).state));
  for (const seed of [1, 7, 42, 1234]) {
    assert.equal(JSON.stringify(toStateDocument(fold(shuffled(events, seed)).state)), reference);
  }
});

test('re-applying the same events is idempotent', () => {
  const { events } = ws();
  const once = toStateDocument(fold(events).state);
  const twice = toStateDocument(fold([...events, ...events]).state);
  assert.deepEqual(twice, once);
});

test('checkpoint + replay equals full replay', () => {
  const { events, checkpoints } = ws();
  const [checkpoint] = checkpoints.map(c => c.body);
  assert.equal(checkpointIsUsable(checkpoint, events), expected.checkpointUsable);
  const remaining = events.filter(e => e.seq > (checkpoint.frontier[e.deviceId] ?? 0));
  const resumed = fold(remaining, {
    base: fromStateDocument(checkpoint.state),
    baseWriters: new Map(Object.entries(checkpoint.fieldWriters)),
  });
  const full = fold(events);
  assert.deepEqual(toStateDocument(resumed.state), toStateDocument(full.state));
  assert.deepEqual(resumed.conflicts.map(c => c.field), full.conflicts.map(c => c.field));
});

test('a checkpoint is unusable when a late event sorts before it', () => {
  const { events, checkpoints } = ws();
  const checkpoint = checkpoints[0].body;
  const late = { ...events.find(e => e.seq === 1 && e.deviceId !== Object.keys(checkpoint.frontier)[0]), hlc: '0000000000001-0000' };
  assert.equal(checkpointIsUsable(checkpoint, [...events, late]), false);
});
