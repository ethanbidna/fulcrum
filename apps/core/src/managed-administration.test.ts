import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { LocalPreferences } from '@fulcrum/store';
import { openWorkspaceHost } from './workspace.js';
import { ManagedSourceSettings } from './managed-sources.js';

const USER_ID = '01000000-0000-7000-8000-000000000099';

test('native core serves typed connection controls without blocking workspace reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-managed-admin-'));
  const localDirectory = path.join(root, 'local');
  let finishLookup!: () => void;
  const blocked = new Promise<void>(resolve => { finishLookup = resolve; });
  const client = {
    lookup: vi.fn(async () => { await blocked; return null; }),
    begin: vi.fn(async () => ({ attemptId: 'synthetic-attempt', authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' })),
    complete: vi.fn(async () => ({ id: 'synthetic-connection', source: 'gmail' as const, ingestion: 'blocked' as const })),
    connectGranola: vi.fn(async () => ({ id: 'synthetic-granola', source: 'granola' as const, ingestion: 'blocked' as const })),
    disconnect: vi.fn(async () => {}), cancel: vi.fn(),
  };
  const managedSources = new ManagedSourceSettings({ preferences: new LocalPreferences(path.join(localDirectory, 'managed-test')), client, designated: () => true });
  const host = await openWorkspaceHost({ workspaceDirectory: path.join(root, 'workspace'), localDirectory,
    userEntityId: USER_ID, deviceLabel: 'Synthetic Mac', create: true, managedSources });
  try {
    await expect(host.administer!('sources.begin', { source: 'gmail', acknowledged: false })).rejects.toThrow();
    await expect(host.administer!('sources.begin', { source: 'gmail', acknowledged: true, origin: 'http://example.invalid' })).rejects.toThrow('INVALID_ADMINISTRATION_REQUEST');
    const beginning = host.administer!('sources.begin', { source: 'gmail', acknowledged: true });
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalled());
    expect(await host.query('portfolio.list', {})).toEqual([]);
    expect(await host.administer!('sources.status', {})).toContainEqual({ source: 'gmail', phase: 'connecting', ingestion: 'blocked' });
    finishLookup();
    expect(await beginning).toMatchObject({ phase: 'authorization' });
    await host.administer!('sources.complete', { attemptId: 'synthetic-attempt', code: 'synthetic-code' });
    expect(await host.administer!('sources.status', {})).toContainEqual({ source: 'gmail', phase: 'connected', ingestion: 'blocked' });
    expect(host.ingestionActive!()).toBe(false);
    await expect(host.administer!('sources.activate', {})).rejects.toThrow('INVALID_ADMINISTRATION_REQUEST');
  } finally { finishLookup(); await host.close(); await rm(root, { recursive: true, force: true }); }
}, 15_000);

test('missing runtime leaves the app usable and never provisions a connector account', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-managed-unavailable-'));
  const host = await openWorkspaceHost({ workspaceDirectory: path.join(root, 'workspace'), localDirectory: path.join(root, 'local'),
    userEntityId: USER_ID, deviceLabel: 'Synthetic Mac', create: true });
  try {
    const statuses = await host.administer!('sources.status', {}) as { phase: string }[];
    expect(statuses).toHaveLength(6);
    expect(statuses.every(status => status.phase === 'unavailable')).toBe(true);
    expect(await host.query('portfolio.list', {})).toEqual([]);
    expect(host.ingestionActive!()).toBe(false);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
}, 15_000);

test('runtime setup is asynchronous, strictly typed and leaves canonical reads available', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fulcrum-runtime-admin-'));
  let finish!: () => void;
  const runtime = { installed: vi.fn(async () => false), install: vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'http://127.0.0.1:18089'; }), start: vi.fn(), stop: vi.fn(async () => {}), healthy: vi.fn(async () => true) };
  const connect = vi.fn();
  const host = await openWorkspaceHost({ workspaceDirectory: path.join(root, 'workspace'), localDirectory: path.join(root, 'local'), userEntityId: USER_ID,
    deviceLabel: 'Synthetic Mac', create: true, connectorRuntime: runtime, managedConnectionClient: connect });
  try {
    const status = await host.administer!('status', {}) as { deviceId: string };
    await host.execute({ name: 'settings.setIngestionDevice', args: { ingestionDeviceId: status.deviceId }, actor: 'user' });
    await expect(host.administer!('sources.runtime.start', { acknowledged: false })).rejects.toThrow();
    await expect(host.administer!('sources.runtime.start', { acknowledged: true, origin: 'http://example.invalid' })).rejects.toThrow('INVALID_ADMINISTRATION_REQUEST');
    expect(await host.administer!('sources.runtime.start', { acknowledged: true })).toEqual({});
    await vi.waitFor(() => expect(runtime.install).toHaveBeenCalled());
    expect(await host.query('portfolio.list', {})).toEqual([]);
    expect(await host.administer!('sources.runtime.status', {})).toMatchObject({ phase: 'installing' });
    await host.administer!('sources.runtime.stop', {}); finish();
    await vi.waitFor(async () => expect(await host.administer!('sources.runtime.status', {})).toMatchObject({ phase: 'not_installed' }));
    expect(connect).not.toHaveBeenCalled(); expect(host.ingestionActive!()).toBe(false);
  } finally { finish?.(); await host.close(); await rm(root, { recursive: true, force: true }); }
}, 15_000);
