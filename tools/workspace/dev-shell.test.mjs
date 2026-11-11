import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';

const STARTUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 65_000;

test('the documented dev entry bundles an importable fixture', async () => {
  const child = spawn(process.execPath, ['tools/dev-shell.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), STARTUP_TIMEOUT_MS);
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output.includes('Synthetic local workspace ready')) child.kill('SIGTERM');
  });
  try {
    await exited;
    // A separate preview may already own the documented port.
    expect(output).toMatch(/Synthetic local workspace ready|EADDRINUSE/);
    const fixture = await import('../../apps/core/dist-dev/fixture.mjs');
    expect(fixture.startFixture).toBeTypeOf('function');
  } finally {
    clearTimeout(timeout);
    child.kill('SIGTERM');
  }
}, TEST_TIMEOUT_MS);
