import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const executable = process.env.FULCRUM_NATIVE_TEST_BINARY;
const STARTUP_MS = 10_000;
const SECOND_INSTANCE_EXIT_MS = 5_000;
const TEST_TIMEOUT_MS = 30_000;

test.skipIf(!executable)('a second native launch exits while the first shell remains alive', async () => {
  if (!executable.includes(`${path.sep}debug${path.sep}`)) throw new Error('Use a debug binary so the test profile stays isolated.');
  const profile = await mkdtemp(path.join(tmpdir(), 'fulcrum-instance-'));
  const children = [];
  const launch = () => {
    const child = spawn(executable, [], { env: { ...process.env, FULCRUM_DEV_PROFILE: profile }, stdio: 'ignore' });
    children.push(child);
    return child;
  };
  try {
    const first = launch();
    await delay(STARTUP_MS);
    expect(first.exitCode).toBeNull();
    const second = launch();
    const exited = await Promise.race([
      once(second, 'exit').then(([code]) => ({ code })),
      delay(SECOND_INSTANCE_EXIT_MS).then(() => null),
    ]);
    expect(exited, 'A duplicate shell must exit before it starts another system observer.').toEqual({ code: 0 });
    expect(first.exitCode).toBeNull();
  } finally {
    await Promise.all(children.filter(child => child.exitCode === null).map(async child => {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }));
    await rm(profile, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);
