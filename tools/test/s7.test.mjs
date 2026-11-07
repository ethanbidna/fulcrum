import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { buildPlan, targetTriple } from '../../spikes/s7/build.mjs';
import { measure, processTree } from '../../spikes/s7/measure.mjs';

const CORE = fileURLToPath(new URL('../../spikes/s7/core.cjs', import.meta.url));
const MAXIMUM_RESPONSE_BYTES = 65536;

test('S7 confirms real FTS5 query execution in the Node runtime', () => {
  const result = JSON.parse(execFileSync(process.execPath, [CORE, '--self-test'], { encoding: 'utf8' }));
  assert.equal(result.runtime, 'node');
  assert.equal(result.fts5, true);
  assert.equal(result.matches, 1);
  assert.match(result.sqliteVersion, /^\d+\.\d+/);
});

test('S7 Node SEA and Bun plans remain separate and use matching architecture names', () => {
  assert.equal(targetTriple('x64'), 'x86_64-apple-darwin');
  assert.equal(targetTriple('arm64'), 'aarch64-apple-darwin');
  assert.throws(() => targetTriple('ia32'));
  const node = buildPlan('node', 'x64');
  assert.ok(node.some(command => command.args.includes('--experimental-sea-config')));
  assert.ok(node.some(command => command.args.includes('NODE_SEA_BLOB')));
  const bun = buildPlan('bun', 'arm64');
  assert.ok(bun.some(command => command.args.includes('--target=bun-darwin-arm64')));
  assert.equal(bun.some(command => command.args.includes('NODE_SEA_BLOB')), false);
  assert.throws(() => buildPlan('unknown', 'x64'));
});

async function startCore(context) {
  const directory = await mkdtemp('/tmp/f7-test-');
  const socketPath = join(directory, 'rpc.sock');
  const child = spawn(process.execPath, [CORE, '--socket', socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Core exited before readiness')));
    child.stdout.once('data', () => resolve());
  });
  return { socketPath, child };
}

async function request(socketPath, chunks) {
  const client = connect(socketPath);
  await once(client, 'connect');
  const response = new Promise((resolve, reject) => {
    let text = '';
    client.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0])); });
    client.on('error', reject);
  });
  for (const chunk of chunks) client.write(chunk);
  try { return await response; } finally { client.destroy(); }
}

test('S7 private Unix socket handles split JSON-RPC frames and rejects unknown methods', { timeout: 10000 }, async context => {
  const { socketPath } = await startCore(context);
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  const response = await request(socketPath, ['{"jsonrpc":"2.0","id":1,', '"method":"health"}\n']);
  assert.equal(response.id, 1);
  assert.equal(response.result.fts5, true);
  const unknown = await request(socketPath, ['{"jsonrpc":"2.0","id":2,"method":"execute","params":{"command":"activate"}}\n']);
  assert.equal(unknown.error.code, -32601);
  const invalid = await request(socketPath, ['broken\n']);
  assert.equal(invalid.error.code, -32700);
});

test('S7 oversized frames are rejected without running a command', { timeout: 10000 }, async context => {
  const { socketPath } = await startCore(context);
  const response = await request(socketPath, ['x'.repeat(MAXIMUM_RESPONSE_BYTES + 1)]);
  assert.equal(response.error.code, -32600);
});

test('S7 measurement observes real RPC readiness and leaves GUI/signing checks pending', { timeout: 10000 }, async () => {
  const result = await measure({ kind: 'sidecar', runtime: 'node', executable: process.execPath, args: [CORE], artifact: CORE,
    settleMs: 0, sampleCount: 1, intervalMs: 0 });
  assert.equal(result.fts5, true);
  assert.ok(result.firstSuccessfulHealthRpcMs > 0);
  assert.equal(result.visibleWindowFirstPaintMs, null);
  assert.equal(result.notarization, 'not_run');
  assert.ok(result.samples[0].sidecarRssBytes > 0);
  assert.equal(JSON.stringify(result).includes(CORE), false);
  const tree = processTree([{ pid: 1, parent: 0 }, { pid: 2, parent: 1 }, { pid: 3, parent: 2 }, { pid: 4, parent: 0 }], 1);
  assert.deepEqual(tree.map(row => row.pid), [1, 2, 3]);
});

test('S7 measurement rejects missing executables without hanging during cleanup', { timeout: 1000 }, async () => {
  await assert.rejects(measure({ kind: 'sidecar', runtime: 'node', executable: '/nonexistent/fulcrum-s7', artifact: CORE }));
});
