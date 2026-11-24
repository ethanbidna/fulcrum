import { mkdtemp, rm, chmod, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPreferences } from '@fulcrum/store';
import { configuredManagedRuntime, KeychainManagedRuntimeSecrets, KeychainRuntimeKeys } from './managed-runtime.js';

const identity = { origin: 'http://127.0.0.1:18082', email: 'local@example.invalid', password: 'synthetic-password', provisioned: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function preferences() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-managed-runtime-'));
  directories.push(directory);
  return { directory, preferences: new LocalPreferences(directory) };
}

describe('managed runtime secure store', () => {
  it('distinguishes a missing credential from Keychain denial', async () => {
    const secrets = { getOptional: vi.fn(async (): Promise<string | null> => null), set: vi.fn(async () => {}) };
    const store = new KeychainManagedRuntimeSecrets(secrets);
    expect(await store.read()).toBeNull();
    secrets.getOptional.mockRejectedValueOnce(new Error('keychain_denied'));
    await expect(store.read()).rejects.toThrow('keychain_denied');
    expect(secrets.set).not.toHaveBeenCalled();
  });
  it('round-trips only the local runtime identity', async () => {
    let value: string | null = null;
    const store = new KeychainManagedRuntimeSecrets({ getOptional: async () => value, set: async next => { value = next; } });
    await store.write(identity);
    expect(await store.read()).toEqual(identity);
  });
  it.each(['{}', 'not-json', JSON.stringify({ ...identity, origin: 'http://example.invalid:18082' }), JSON.stringify({ ...identity, token: 'unexpected' })])('fails closed on malformed stored identity', async value => {
    const store = new KeychainManagedRuntimeSecrets({ getOptional: async () => value, set: async () => {} });
    await expect(store.read()).rejects.toThrow('invalid_runtime_identity');
  });
  it('validates before writing secrets', async () => {
    const set = vi.fn(async () => {});
    const store = new KeychainManagedRuntimeSecrets({ getOptional: async () => null, set });
    await expect(store.write({ ...identity, email: 'real@example.com' })).rejects.toThrow('invalid_runtime_identity');
    expect(set).not.toHaveBeenCalled();
  });
});

describe('managed runtime configuration', () => {
  it('stays unavailable when absent and accepts only a private loopback origin', async () => {
    const { directory, preferences: local } = await preferences();
    expect(await configuredManagedRuntime(local)).toBeUndefined();
    await local.write('managedRuntime', { origin: identity.origin });
    expect(await configuredManagedRuntime(local)).toEqual({ origin: identity.origin });
    expect(await readFile(path.join(directory, 'managed-runtime.json'), 'utf8')).not.toContain(identity.password);
    await chmod(path.join(directory, 'managed-runtime.json'), 0o644);
    expect(await configuredManagedRuntime(local)).toBeUndefined();
  });
  it.each(['http://localhost:18082', 'https://127.0.0.1:18082', 'http://127.0.0.1:18082/path', 'http://user@127.0.0.1:18082'])('rejects unsafe configuration %s', async origin => {
    const { preferences: local } = await preferences();
    await local.write('managedRuntime', { origin });
    expect(await configuredManagedRuntime(local)).toBeUndefined();
  });
});

describe('runtime encryption key storage', () => {
  it('round-trips valid keys through the secure store', async () => {
    let encoded: string | null = null;
    const store = new KeychainRuntimeKeys({ getOptional: async () => encoded, set: async value => { encoded = value; } });
    expect(await store.read()).toBeNull();
    const keys = { encryption: 'a'.repeat(32), jwt: 'b'.repeat(64) };
    await store.write(keys); expect(await store.read()).toEqual(keys);
    encoded = JSON.stringify({ ...keys, token: 'extra' });
    await expect(store.read()).rejects.toThrow('invalid_runtime_keys');
  });
  it('preserves denial and does not replace malformed keys', async () => {
    const set = vi.fn(async () => {});
    const store = new KeychainRuntimeKeys({ getOptional: async () => { throw new Error('denied'); }, set });
    await expect(store.read()).rejects.toThrow('denied');
    await expect(store.write({ encryption: 'short', jwt: 'short' })).rejects.toThrow('invalid_runtime_keys');
    expect(set).not.toHaveBeenCalled();
  });
});
