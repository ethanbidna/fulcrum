import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NativeProviderSecrets } from './provider-secrets.js';

const execute = promisify(execFile);
let directory: string;
let helper: string;
describe.skipIf(process.platform !== 'darwin')('native managed credential protocol', () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-keychain-test-'));
    helper = path.join(directory, 'helper');
    await execute('/usr/bin/clang', ['-fobjc-arc', '-fblocks',
      'apps/desktop/src-tauri/src/setup_native.m', 'apps/desktop/src-tauri/tests/provider_keychain_harness.m',
      '-framework', 'AppKit', '-framework', 'Foundation', '-framework', 'Security', '-o', helper]);
  }, 30_000);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('reports a missing machine-local runtime identity explicitly', async () => {
    vi.stubEnv('FULCRUM_TEST_KEYCHAIN_STATE', 'missing');
    expect(await new NativeProviderSecrets(helper, 'activepieces').getOptional()).toBeNull();
  });
  it('does not mistake Keychain denial for a missing identity', async () => {
    vi.stubEnv('FULCRUM_TEST_KEYCHAIN_STATE', 'denied');
    await expect(new NativeProviderSecrets(helper, 'activepieces').getOptional()).rejects.toThrow('Keychain approval failed');
  });
  it('uses the same runtime identity across workspaces', async () => {
    vi.stubEnv('FULCRUM_TEST_KEYCHAIN_STATE', 'present');
    const first = new NativeProviderSecrets(helper, 'activepieces', '01000000-0000-7000-8000-000000000001');
    const second = new NativeProviderSecrets(helper, 'activepieces', '01000000-0000-7000-8000-000000000002');
    expect(await first.getOptional()).toBe('synthetic-identity');
    expect(await second.getOptional()).toBe('synthetic-identity');
    await first.set('synthetic-value'); await second.remove();
  });
  it('does not expose that identity through the Gmail namespace', async () => {
    vi.stubEnv('FULCRUM_TEST_KEYCHAIN_STATE', 'present');
    await expect(new NativeProviderSecrets(helper, 'gmail', '01000000-0000-7000-8000-000000000001').get()).rejects.toThrow();
  });
});
