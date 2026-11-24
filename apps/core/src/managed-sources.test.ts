import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalPreferences } from '@fulcrum/store';
import type { ManagedConnection, ManagedSourceId } from '@fulcrum/sources';
import { ManagedSourceSettings } from './managed-sources.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const receipt = (source: ManagedSourceId = 'gmail'): ManagedConnection => ({ id: `synthetic-${source}`, source, ingestion: 'blocked' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-managed-settings-'));
  directories.push(directory);
  const preferences = new LocalPreferences(directory);
  let designated = true;
  let now = 0;
  const client = {
    lookup: vi.fn<(source: ManagedSourceId) => Promise<{ connection: ManagedConnection; active: boolean } | null>>(async () => null),
    begin: vi.fn<(source: ManagedSourceId) => Promise<{ attemptId: string; authorizationUrl: string }>>(async () => ({ attemptId: 'synthetic-attempt', authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' })),
    complete: vi.fn(async () => receipt()), connectGranola: vi.fn(async () => receipt('granola')),
    disconnect: vi.fn(async () => {}), cancel: vi.fn(),
  };
  const open = () => new ManagedSourceSettings({ preferences, client, designated: () => designated, now: () => now });
  const settings = open();
  const phase = (source: ManagedSourceId = 'gmail') => settings.status().find(status => status.source === source)!.phase;
  return { settings, open, directory, preferences, client, phase, move: () => { designated = false; }, expire: () => { now += 5 * 60_000; } };
}

describe('managed source settings', () => {
  it('shows all six sources without network requests or automatic ingestion', async () => {
    const test = await fixture();
    expect(test.settings.status()).toHaveLength(6);
    expect(test.settings.status().every(status => status.phase === 'disconnected' && status.ingestion === 'blocked')).toBe(true);
    expect(test.client.lookup).not.toHaveBeenCalled();
    const unavailable = new ManagedSourceSettings({ preferences: test.preferences, designated: () => true });
    expect(unavailable.status().every(status => status.phase === 'unavailable')).toBe(true);
  });
  it('requires explicit acknowledgement and the designated device before touching runtime or files', async () => {
    const test = await fixture();
    await expect(test.settings.begin('gmail', false)).rejects.toThrow('NOT_ALLOWED');
    test.move();
    await expect(test.settings.begin('gmail', true)).rejects.toThrow('NOT_ALLOWED');
    expect(test.client.lookup).not.toHaveBeenCalled();
    expect(await test.preferences.read('managedSources')).toBeUndefined();
  });
  it('saves a pending marker before OAuth and only a credential-free receipt afterward', async () => {
    const test = await fixture();
    test.client.begin.mockImplementationOnce(async () => {
      expect(await test.preferences.read('managedSources')).toEqual({ connections: [], pending: ['gmail'] });
      return { attemptId: 'synthetic-attempt', authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' };
    });
    expect(await test.settings.begin('gmail', true)).toMatchObject({ phase: 'authorization' });
    expect(test.phase()).toBe('connecting');
    await test.settings.complete('synthetic-attempt', 'synthetic-secret-code');
    expect(test.phase()).toBe('connected');
    expect(await test.preferences.read('managedSources')).toEqual({ connections: [receipt()], pending: [] });
    expect(await readFile(path.join(test.directory, 'managed-sources.json'), 'utf8')).not.toContain('synthetic-secret-code');
  });
  it('restores as saved and rechecks the runtime only on explicit verification', async () => {
    const test = await fixture();
    await test.preferences.write('managedSources', { connections: [receipt()], pending: [] });
    await test.settings.restore();
    expect(test.phase()).toBe('saved');
    expect(test.client.lookup).not.toHaveBeenCalled();
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: true });
    await test.settings.verify('gmail');
    expect(test.phase()).toBe('connected');
  });
  it('recovers an interrupted remote save without requesting another grant', async () => {
    const test = await fixture();
    await test.preferences.write('managedSources', { connections: [], pending: ['gmail'] });
    await test.settings.restore(); expect(test.phase()).toBe('failed');
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: true });
    expect(await test.settings.begin('gmail', true)).toEqual({ phase: 'connected' });
    expect(test.client.begin).not.toHaveBeenCalled();
    expect(await test.preferences.read('managedSources')).toEqual({ connections: [receipt()], pending: [] });
  });
  it('does not describe inactive or missing runtime connections as connected', async () => {
    const test = await fixture();
    await test.preferences.write('managedSources', { connections: [receipt()], pending: [] }); await test.settings.restore();
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: false });
    await test.settings.verify('gmail'); expect(test.phase()).toBe('failed');
    await test.settings.verify('gmail'); expect(test.phase()).toBe('disconnected');
  });
  it('keeps an offline disconnect retryable and hides provider error details', async () => {
    const test = await fixture();
    await test.preferences.write('managedSources', { connections: [receipt()], pending: [] }); await test.settings.restore();
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: true });
    test.client.disconnect.mockRejectedValueOnce(new Error('provider secret must not escape'));
    await expect(test.settings.disconnect('gmail')).rejects.toThrow('MANAGED_SOURCE_OPERATION_FAILED');
    expect(test.phase()).toBe('failed');
    expect(await test.preferences.read('managedSources')).toEqual({ connections: [receipt()], pending: [] });
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: true });
    await test.settings.disconnect('gmail'); expect(test.phase()).toBe('disconnected');
  });
  it('rejects unknown sources, unmatched replies, and Granola through the OAuth path', async () => {
    const test = await fixture();
    await expect(test.settings.begin('unknown', true)).rejects.toThrow('INVALID_MANAGED_SOURCE');
    await expect(test.settings.begin('granola', true)).rejects.toThrow('NOT_ALLOWED');
    await expect(test.settings.complete('unknown', 'code')).rejects.toThrow('INVALID_MANAGED_AUTHORIZATION');
    expect(test.client.lookup).not.toHaveBeenCalled();
  });
  it('cancels a pending authorization and rejects its late reply', async () => {
    const test = await fixture();
    await test.settings.begin('gmail', true); await test.settings.cancel('gmail');
    expect(test.client.cancel).toHaveBeenCalledWith('synthetic-attempt');
    expect(test.phase()).toBe('disconnected');
    await expect(test.settings.complete('synthetic-attempt', 'code')).rejects.toThrow('INVALID_MANAGED_AUTHORIZATION');
  });
  it('invalidates a late URL when cancellation happens during begin', async () => {
    const test = await fixture(); const waiting = deferred<{ attemptId: string; authorizationUrl: string }>();
    test.client.begin.mockReturnValueOnce(waiting.promise);
    const beginning = test.settings.begin('gmail', true);
    await vi.waitFor(() => expect(test.client.begin).toHaveBeenCalled());
    await test.settings.cancel('gmail');
    waiting.resolve({ attemptId: 'late-attempt', authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' });
    await expect(beginning).rejects.toThrow('MANAGED_SOURCE_OPERATION_FAILED');
    expect(test.client.cancel).toHaveBeenCalledWith('late-attempt');
    expect(test.phase()).toBe('disconnected');
  });
  it('removes a grant returned after cancellation during its exchange', async () => {
    const test = await fixture(); await test.settings.begin('gmail', true);
    const waiting = deferred<ManagedConnection>(); test.client.complete.mockReturnValueOnce(waiting.promise);
    const completing = test.settings.complete('synthetic-attempt', 'code');
    await vi.waitFor(() => expect(test.client.complete).toHaveBeenCalled());
    await test.settings.cancel('gmail'); waiting.resolve(receipt()); await completing;
    expect(test.client.disconnect).toHaveBeenCalledWith('gmail', receipt().id);
    expect(test.phase()).toBe('disconnected');
    expect(await test.preferences.read('managedSources')).toEqual({ connections: [], pending: [] });
  });
  it('expires the pending attempt without network or credential access', async () => {
    const test = await fixture(); await test.settings.begin('gmail', true); test.expire();
    expect(test.phase()).toBe('failed');
    expect(test.client.cancel).toHaveBeenCalledWith('synthetic-attempt');
    await expect(test.settings.complete('synthetic-attempt', 'code')).rejects.toThrow('INVALID_MANAGED_AUTHORIZATION');
    expect(test.client.complete).not.toHaveBeenCalled();
  });
  it('does not send a key until acknowledgement and pending storage succeed', async () => {
    const test = await fixture();
    await expect(test.settings.granola('synthetic-key', false)).rejects.toThrow('NOT_ALLOWED');
    vi.spyOn(test.preferences, 'write').mockRejectedValueOnce(new Error('private_storage_denied'));
    await expect(test.settings.granola('synthetic-key', true)).rejects.toThrow('MANAGED_SOURCE_OPERATION_FAILED');
    expect(test.client.lookup).not.toHaveBeenCalled(); expect(test.client.connectGranola).not.toHaveBeenCalled();
  });
  it('never stores a Granola key in settings', async () => {
    const test = await fixture(); await test.settings.granola('synthetic-key', true);
    expect(test.phase('granola')).toBe('connected');
    expect(await readFile(path.join(test.directory, 'managed-sources.json'), 'utf8')).not.toContain('synthetic-key');
    expect(test.client.connectGranola).toHaveBeenCalledWith('synthetic-key');
  });
  it('recovers a receipt after its final local write failed', async () => {
    const test = await fixture(); await test.settings.begin('gmail', true);
    vi.spyOn(test.preferences, 'write').mockRejectedValueOnce(new Error('disk_full'));
    await expect(test.settings.complete('synthetic-attempt', 'code')).rejects.toThrow('MANAGED_SOURCE_OPERATION_FAILED');
    const restarted = test.open(); await restarted.restore();
    test.client.lookup.mockResolvedValueOnce({ connection: receipt(), active: true });
    await restarted.verify('gmail');
    expect(restarted.status().find(status => status.source === 'gmail')?.phase).toBe('connected');
  });
  it('waits for in-flight exchange cleanup on close and prevents new requests', async () => {
    const test = await fixture(); await test.settings.begin('gmail', true);
    const waiting = deferred<ManagedConnection>(); test.client.complete.mockReturnValueOnce(waiting.promise);
    const completing = test.settings.complete('synthetic-attempt', 'code');
    await vi.waitFor(() => expect(test.client.complete).toHaveBeenCalled());
    const closing = test.settings.close(); waiting.resolve(receipt());
    await Promise.all([closing, completing]);
    expect(test.client.disconnect).toHaveBeenCalledWith('gmail', receipt().id);
    expect(test.settings.status().every(status => status.phase === 'unavailable')).toBe(true);
    await expect(test.settings.begin('gmail', true)).rejects.toThrow();
  });
  it('does not start provisioning when close precedes the queued operation', async () => {
    const test = await fixture();
    const beginning = test.settings.begin('gmail', true);
    const closing = test.settings.close();
    await expect(beginning).rejects.toThrow(); await closing;
    expect(test.client.lookup).not.toHaveBeenCalled();
    expect(test.client.begin).not.toHaveBeenCalled();
  });
  it('clears an unclaimed authorization on graceful close', async () => {
    const test = await fixture(); await test.settings.begin('gmail', true);
    await test.settings.close();
    expect(await test.preferences.read('managedSources')).toEqual({ connections: [], pending: [] });
  });
  it('refuses credentials or unknown fields in persisted receipts', async () => {
    const test = await fixture();
    await test.preferences.write('managedSources', { connections: [{ ...receipt(), token: 'unexpected' }], pending: [] });
    await expect(test.settings.restore()).rejects.toThrow('INVALID_MANAGED_SETTINGS');
  });
});
