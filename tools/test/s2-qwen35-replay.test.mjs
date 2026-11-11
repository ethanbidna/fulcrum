import assert from 'node:assert/strict';
import { cp, mkdtemp, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { replayHoldout } from '../../spikes/s2/experiments/qwen35-replay.mjs';

const archive = fileURLToPath(new URL('../../docs/spikes/S2-results/qwen35-holdout/', import.meta.url));

test('the frozen holdout replays all recorded requests and scores', async () => {
  assert.deepEqual(await replayHoldout(archive), {
    requests: 42, completed: 24, exact: 15, truePositive: 13, falsePositive: 9, falseNegative: 8,
  });
});

test('replay detects a changed response journal', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fulcrum-replay-'));
  try {
    await cp(archive, temporary, { recursive: true });
    await appendFile(join(temporary, 'responses.jsonl'), '\n');
    await assert.rejects(replayHoldout(temporary), /Archive hash mismatch: responses.jsonl/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
