import os from 'node:os';
import path from 'node:path';
import { LimaConnectorRuntime } from '@fulcrum/sources/runtime';
import { nativeRuntimeKeys } from './managed-runtime.js';

// Developer acceptance harness; never imported by either production entry point.
const [helper, profile = 'probe'] = process.argv.slice(2);
if (!helper || !path.isAbsolute(helper) || !/^[a-z][a-z0-9-]{0,15}$/.test(profile)) throw new Error('Expected an absolute native helper path and an optional short profile name');
if (process.platform !== 'darwin') throw new Error('Runtime probe requires macOS');
const base = path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum');
const runtime = new LimaConnectorRuntime({
  directory: path.join(base, `connector-runtime-${profile}`),
  stateDirectory: path.join(base, `lima-${profile}`),
  keys: nativeRuntimeKeys(helper),
});
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
let lastMessage = '';
try {
  const origin = await runtime.install(controller.signal, progress => {
    if (progress.message === lastMessage) return;
    lastMessage = progress.message; process.stdout.write(`${lastMessage}\n`);
  });
  if (!await runtime.healthy(origin)) throw new Error('Initial readiness check failed');
  await runtime.stop();
  const restored = await runtime.start(controller.signal, () => {});
  if (!await runtime.healthy(restored)) throw new Error('Restart readiness check failed');
  process.stdout.write(JSON.stringify({ installed: await runtime.installed(), initialHealthy: true, restartHealthy: true }) + '\n');
} catch {
  process.stderr.write('Runtime probe failed; saved files and keys were preserved.\n');
  process.exitCode = 1;
} finally {
  try { await runtime.stop(); }
  catch { process.stderr.write('Runtime stop failed; inspect the local VM before retrying.\n'); process.exitCode = 1; }
}
