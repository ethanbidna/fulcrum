import { spawn, execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtemp, mkdir, rm, lstat, readdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const START_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 25;
const SETTLE_MS = 5000;
const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 1000;
const KIB = 1024;
const MAXIMUM_FRAME_BYTES = 65536;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function processTree(rows, parent) {
  const included = new Set([parent]);
  let previous;
  do {
    previous = included.size;
    for (const row of rows) if (included.has(row.parent)) included.add(row.pid);
  } while (included.size !== previous);
  return rows.filter(row => included.has(row.pid));
}

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, parent, rssBytes: rss * KIB };
  });
}

async function apparentBytes(path) {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map(entry => apparentBytes(join(path, entry))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

function requestHealth(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let pending = '';
    const finish = (error, value) => { socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(RPC_TIMEOUT_MS, () => finish(new Error('Health timeout')));
    socket.once('error', () => finish(new Error('Sidecar not ready')));
    socket.once('connect', () => socket.write('{"jsonrpc":"2.0","id":1,"method":"health"}\n'));
    socket.on('data', chunk => {
      pending += chunk;
      if (Buffer.byteLength(pending) > MAXIMUM_FRAME_BYTES) return finish(new Error('Oversized health response'));
      if (!pending.includes('\n')) return;
      try {
        const response = JSON.parse(pending.split('\n')[0]);
        if (response.jsonrpc !== '2.0' || response.id !== 1 || !response.result) throw new Error();
        finish(null, response.result);
      } catch { finish(new Error('Invalid health response')); }
    });
  });
}

async function waitForHealth(child, socketPath) {
  const started = performance.now();
  while (performance.now() - started < START_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Application exited before readiness');
    try { return await requestHealth(socketPath); } catch { await pause(POLL_INTERVAL_MS); }
  }
  throw new Error('Application did not become ready');
}

async function idleSamples(child, health, options) {
  await pause(options.settleMs ?? SETTLE_MS);
  const samples = [];
  for (let sample = 0; sample < (options.sampleCount ?? SAMPLE_COUNT); sample++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Application exited during measurement');
    const tree = processTree(processes(), child.pid);
    if (!tree.some(row => row.pid === health.processId)) throw new Error('Sidecar missing during measurement');
    samples.push({ processTreeRssBytes: tree.reduce((sum, row) => sum + row.rssBytes, 0), sidecarRssBytes: tree.find(row => row.pid === health.processId)?.rssBytes ?? null });
    await pause(options.intervalMs ?? SAMPLE_INTERVAL_MS);
  }
  return samples;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const children = processTree(processes(), child.pid).filter(row => row.pid !== child.pid);
  for (const row of children) {
    try { process.kill(row.pid, 'SIGTERM'); } catch {}
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), RPC_TIMEOUT_MS);
  try { await exited; } finally { clearTimeout(force); }
}

export async function measure(options) {
  const directory = await mkdtemp('/tmp/f7-measure-');
  const socketDirectory = options.kind === 'app' ? join(directory, 'app') : directory;
  const socketPath = join(socketDirectory, 'rpc.sock');
  const args = options.kind === 'app' ? [] : [...(options.args ?? []), '--socket', socketPath];
  const started = performance.now();
  const child = spawn(options.executable, args, { env: { ...process.env, FULCRUM_S7_SOCKET_DIR: socketDirectory }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  // Spawn errors must be observed while readiness polling is active.
  let spawnFailed = false;
  child.once('error', () => { spawnFailed = true; });
  try {
    const health = await waitForHealth(child, socketPath);
    const firstSuccessfulHealthRpcMs = performance.now() - started;
    if (spawnFailed || !health.fts5 || health.matches !== 1 || health.runtime !== options.runtime) throw new Error('Packaged FTS5/runtime verification failed');
    const samples = await idleSamples(child, health, options);
    return { formatVersion: 1, measuredAt: new Date().toISOString(), kind: options.kind, runtime: health.runtime,
      hardware: { platform: os.platform(), architecture: os.arch(), memoryBytes: os.totalmem() },
      sqliteVersion: health.sqliteVersion, fts5: true, artifactApparentBytes: await apparentBytes(options.artifact),
      firstSuccessfulHealthRpcMs, samples,
      visibleWindowFirstPaintMs: null, webkitProcessesOutsideTreeMeasured: false, notarization: 'not_run' };
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
}

async function main() {
  const [kind, runtime, artifact] = process.argv.slice(2);
  if (!['app', 'sidecar'].includes(kind) || !['node', 'bun'].includes(runtime) || !artifact) throw new Error('Usage: measure.mjs app|sidecar node|bun ARTIFACT');
  const executable = kind === 'app' ? join(artifact, 'Contents', 'MacOS', 'fulcrum-s7') : artifact;
  const result = await measure({ kind, runtime, executable, artifact });
  const output = join(ROOT, 'out', runtime, `${kind}-${process.arch}-${Date.now()}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${kind}/${runtime}: report saved under spikes/s7/out/${runtime}/\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Measurement failed; check artifact, runtime and local socket access.\n'); process.exitCode = 1; });
}
