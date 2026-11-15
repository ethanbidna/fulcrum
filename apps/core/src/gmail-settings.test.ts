import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalPreferences } from '@fulcrum/store';
import { test, vi } from 'vitest';
import { GmailConnection } from './gmail-connection.js';
import { GmailSettings } from './gmail-settings.js';
import type { WorkspaceIngestion } from './ingestion.js';

test('Gmail activates only the explicitly chosen label and restores it on restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-gmail-settings-'));
  const preferences = new LocalPreferences(directory);
  const label = { id: 'Label_fixture', label: 'Synthetic mail' };
  const account = 'fixture@example.invalid';
  const client = { client_id: 'fixture-client', client_secret: 'fixture-secret' };
  const apply = vi.fn<(configuration?: WorkspaceIngestion) => Promise<void>>(async () => {});
  let designated = false;
  const disconnect = vi.fn(async () => {});
  const create = () => {
    const connection = new GmailConnection({ client, account, credentials: {
      get: async () => { throw new Error('Unexpected refresh'); }, set: async () => {}, remove: disconnect,
    } });
    vi.spyOn(connection, 'connect').mockResolvedValue({ account, labels: [label] });
    return connection;
  };
  const open = () => new GmailSettings(preferences, client, 'fixture', 'fixture-workspace', () => designated, apply, create);
  const settings = open();
  try {
    assert.throws(() => settings.start(account, true), /GMAIL_CONNECTION_NOT_ALLOWED/);
    designated = true;
    assert.throws(() => settings.start(account, false), /GMAIL_CONNECTION_NOT_ALLOWED/);
    settings.start(account, true);
    await vi.waitFor(() => assert.equal(settings.status().phase, 'select'));
    assert.equal(apply.mock.calls.length, 0);
    await assert.rejects(settings.select('Other_label'), /INVALID_GMAIL_LABEL/);
    await settings.select(label.id);
    assert.deepEqual(settings.status(), { phase: 'active', account, label });
    const [adapter] = apply.mock.calls[0]?.[0]?.adapters ?? [];
    assert.ok(adapter);
    assert.deepEqual(apply.mock.calls[0]?.[0]?.scopes.gmail, (await adapter.scopes()).map(scope => scope.id));

    const restarted = open();
    await restarted.restore();
    assert.deepEqual(restarted.status(), settings.status());
    assert.deepEqual(apply.mock.calls[1]?.[0]?.scopes, apply.mock.calls[0]?.[0]?.scopes);
    await restarted.disconnect();
    assert.equal(restarted.status().phase, 'disconnected');
    assert.deepEqual(apply.mock.calls[2], []);
    assert.equal(disconnect.mock.calls.length, 1);
    assert.equal(await preferences.read('gmail'), null);
  } finally {
    await settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('connecting needs no address and records the account Google reports', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-gmail-settings-'));
  const preferences = new LocalPreferences(directory);
  const client = { client_id: 'fixture-client', client_secret: 'fixture-secret' };
  const reported = 'reported@example.invalid';
  const create = () => {
    const connection = new GmailConnection({ client, credentials: { get: async () => 'x', set: async () => {}, remove: async () => {} } });
    vi.spyOn(connection, 'connect').mockResolvedValue({ account: reported, labels: [{ id: 'L', label: 'Synthetic mail' }] });
    return connection;
  };
  const settings = new GmailSettings(preferences, client, 'fixture', 'fixture-workspace', () => true, async () => {}, create);
  try {
    settings.start(undefined, true);
    await vi.waitFor(() => assert.equal(settings.status().phase, 'select'));
    assert.deepEqual(settings.status(), { phase: 'select', account: reported, labels: [{ id: 'L', label: 'Synthetic mail' }] });
    assert.throws(() => new GmailSettings(preferences, client, 'fixture', 'w', () => true, async () => {}, create).start(undefined, false), /GMAIL_CONNECTION_NOT_ALLOWED/);
    assert.throws(() => new GmailSettings(preferences, client, 'fixture', 'w', () => true, async () => {}, create).start('not an address', true), /GMAIL_CONNECTION_NOT_ALLOWED/);
  } finally {
    await settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a sign-in interrupted before Google answered is cleaned up on restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-gmail-settings-'));
  const preferences = new LocalPreferences(directory);
  const client = { client_id: 'fixture-client', client_secret: 'fixture-secret' };
  await preferences.write('gmail', { account: null, clientId: client.client_id, label: null });
  const remove = vi.fn(async () => {});
  const create = () => new GmailConnection({ client, credentials: { get: async () => 'x', set: async () => {}, remove } });
  const settings = new GmailSettings(preferences, client, 'fixture', 'fixture-workspace', () => true, async () => {}, create);
  try {
    await settings.restore();
    assert.equal(settings.status().phase, 'disconnected');
    assert.equal(remove.mock.calls.length, 1);
    assert.equal(await preferences.read('gmail'), null);
  } finally {
    await settings.close();
    await rm(directory, { recursive: true, force: true });
  }
});
