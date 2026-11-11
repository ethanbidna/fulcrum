import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
test('S3 native comparison uses real ContextIndex and the shared scenario-6 fixture',()=>{
 const fixtureBytes=execFileSync(process.execPath,['spikes/s3/native.mjs','--fixture']);const fixture=JSON.parse(fixtureBytes);
 const report=JSON.parse(execFileSync(process.execPath,['spikes/s3/native.mjs']));
 assert.equal(report.fixtureSha256,createHash('sha256').update(fixtureBytes).digest('hex'));
 assert.equal(report.episodeCount,fixture.episodes.length);assert.ok(report.episodeCount>0);
 assert.deepEqual(report.resolutions,fixture.expected);assert.equal(report.llmRequests,0);assert.equal(report.embeddingRequests,0);assert.ok(report.rebuildMs>=0);
});
