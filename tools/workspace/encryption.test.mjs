import { expect, test } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileWorkspaceStore } from '../../packages/store/src/store.ts';
import { WorkspaceEncryption, generateWorkspaceKey } from '../../packages/store/src/encryption.ts';
import { createRecoveryCard, parseRecoveryCard } from '../../packages/store/src/recovery.ts';
import { createEncryptedCopy } from '../../packages/store/src/encrypted-copy.ts';
import { inventory, readWorkspace } from '../../packages/store/src/reader.ts';
import { loadStoreValidators } from '../../packages/store/src/validation.ts';
import { WorkspaceArchives } from '../../packages/store/src/archive.ts';
import { fold, toStateDocument } from '../reference/fold.mjs';

const deviceId = '08000000-0000-7000-8000-000000000001';
const otherId = '08000000-0000-7000-8000-000000000002';
const eventId = '09000000-0000-7000-8000-000000000099';

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'fulcrum-p6-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'encrypted');
  const localDirectory = path.join(root, 'local');
  const memory = new Map();
  const keys = {
    async add(workspaceId, keyId, key) { memory.set(workspaceId + keyId, key.slice()); },
    async get(workspaceId, keyId) { return memory.get(workspaceId + keyId).slice(); },
  };
  try {
    await cp(new URL('../../fixtures/workspace-example/', import.meta.url), source, { recursive: true });
    await run({ root, source, destination, localDirectory, keys, confirmRecovery: async card => card });
  } finally {
    for (const key of memory.values()) key.fill(0);
    await rm(root, { recursive: true, force: true });
  }
}

test('purpose, directory and manifest are authenticated; ciphertext uses fresh nonces', async () => {
  const key = await generateWorkspaceKey();
  const validators = await loadStoreValidators();
  const { manifest, session } = await WorkspaceEncryption.create(key);
  try {
    const first = session.encode('event', deviceId, 'Synthetic');
    const second = session.encode('event', deviceId, 'Synthetic');
    expect(JSON.parse(first).nonce).not.toEqual(JSON.parse(second).nonce);
    expect(session.decode('event', deviceId, first, validators)).toBe('Synthetic');
    expect(() => session.decode('event', otherId, first, validators)).toThrow();
    expect(() => session.decode('checkpoint', deviceId, first.replace('"event"', '"checkpoint"'), validators)).toThrow();
    const flipped = JSON.parse(first); flipped.ciphertext = (flipped.ciphertext[0] === 'A' ? 'B' : 'A') + flipped.ciphertext.slice(1);
    expect(() => session.decode('event', deviceId, JSON.stringify(flipped), validators)).toThrow();
    expect(() => session.decode('event', deviceId, first.replace('{', '{"kind":"event",'), validators)).toThrow();
    expect(() => session.encode('event', deviceId, 'x'.repeat(1024 * 1024))).toThrow();
    await expect(WorkspaceEncryption.unlock({ ...manifest, createdAt: '2020-01-01T00:00:00.000Z' }, key, validators)).rejects.toThrow();
    await expect(WorkspaceEncryption.unlock(manifest, new Uint8Array(32), validators)).rejects.toThrow();
    const identity = { workspaceId: manifest.workspaceId, keyId: manifest.encryption.keyId };
    const card = createRecoveryCard(identity, key);
    expect([...parseRecoveryCard(card, identity)]).toEqual([...key]);
    expect(() => parseRecoveryCard(card.replace('{', '{"version":1,'), identity)).toThrow();
  } finally { key.fill(0); session.close(); }
  expect(() => session.encode('event', deviceId, 'closed')).toThrow();
});

test('copy preserves exact history, accepts authenticated duplicates and rejects complete corrupt records', () => fixture(async options => {
  const validators = await loadStoreValidators();
  const before = await readWorkspace(options.source, validators);
  const result = await createEncryptedCopy(options);
  expect(result.workspaceId).not.toBe(before.manifest.workspaceId);
  expect((await readWorkspace(options.source, validators)).eventBytes).toEqual(before.eventBytes);
  await expect(readWorkspace(options.destination, validators)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
  const manifest = JSON.parse(await readFile(path.join(options.destination, 'workspace.json'), 'utf8'));
  const key = await options.keys.get(manifest.workspaceId, manifest.encryption.keyId);
  const session = await WorkspaceEncryption.unlock(manifest, key, validators);
  key.fill(0);
  try {
    const copied = await readWorkspace(options.destination, validators, session);
    expect(copied.eventBytes).toEqual(before.eventBytes);
    const duplicate = path.join(options.destination, 'log', copied.events[0].deviceId, 'synthetic conflicted copy.jsonl');
    await writeFile(duplicate, session.encode('event', copied.events[0].deviceId, copied.eventBytes[0]) + '\ntruncated');
    const deduped = await readWorkspace(options.destination, validators, session);
    expect(deduped.eventBytes).toEqual(before.eventBytes);
    expect(deduped.diagnostics.map(item => item.code)).toContain('TORN_TAIL_IGNORED');
    const archive = await WorkspaceArchives.open({ ...options, workspaceDirectory: options.destination, encryption: session });
    const backup = await archive.backup();
    const checked = await archive.verify(backup.id);
    expect(checked.read.eventBytes).toEqual(before.eventBytes);
    await expect(archive.restore(backup.id)).rejects.toMatchObject({ code: 'ENCRYPTED_RESTORE_REQUIRED' });
    await writeFile(duplicate, copied.eventBytes[0] + '\n');
    await expect(readWorkspace(options.destination, validators, session)).rejects.toThrow();
  } finally { session.close(); }
}));

test('authenticated workspace can append and checkpoint without plaintext on disk', () => fixture(async options => {
  await createEncryptedCopy(options);
  const manifest = JSON.parse(await readFile(path.join(options.destination, 'workspace.json'), 'utf8'));
  const key = await options.keys.get(manifest.workspaceId, manifest.encryption.keyId);
  const session = await WorkspaceEncryption.unlock(manifest, key, await loadStoreValidators());
  key.fill(0);
  const store = new FileWorkspaceStore({ localDirectory: path.join(options.root, 'second'), deviceLabel: 'Synthetic', encryption: session });
  try {
    const opened = await store.open(options.destination);
    const categoryId = '0c000000-0000-7000-8000-000000000099';
    const record = { id: categoryId, label: 'Synthetic confidential value' };
    await store.commit([{ v: 1, deviceId: opened.deviceId, eventId, actor: 'user', at: '2026-11-10T12:00:00.000Z', command: { name: 'category.create', args: { record } }, ops: [{ op: 'create', kind: 'category', id: categoryId, record }] }]);
    const { events } = await store.read();
    const replay = fold(events);
    const checkpoint = { v: 1, workspaceId: manifest.workspaceId, frontier: replay.frontier, maxHlc: events.at(-1).hlc, state: toStateDocument(replay.state) };
    await store.writeCheckpoint(checkpoint);
    expect(await store.latestUsableCheckpoint()).toEqual(checkpoint);
    for (const file of (await inventory(options.destination)).files) {
      expect(await readFile(path.join(options.destination, file), 'utf8')).not.toContain(record.label);
    }
  } finally { await store.close(); }
}));

test('invalid recovery and interrupted copy cannot publish a workspace', () => fixture(async options => {
  await expect(createEncryptedCopy({ ...options, confirmRecovery: async () => '{}' })).rejects.toThrow();
  await expect(readdir(options.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(createEncryptedCopy({ ...options, fault: async phase => {
    if (phase === 'before-manifest') throw new Error('Synthetic interruption');
  } })).rejects.toThrow('Synthetic interruption');
  await expect(readFile(path.join(options.destination, 'workspace.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(options.destination)).toEqual(['log']);
}));

test('restore rotates both identities and recovery import verifies before storing a key', () => fixture(async options => {
  const validators = await loadStoreValidators();
  await createEncryptedCopy(options);
  const manifest = JSON.parse(await readFile(path.join(options.destination, 'workspace.json'), 'utf8'));
  const identity = { workspaceId: manifest.workspaceId, keyId: manifest.encryption.keyId };
  const key = await options.keys.get(identity.workspaceId, identity.keyId);
  const { importWorkspaceRecovery, restoreEncryptedCopy } = await import('../../packages/store/src/encrypted-copy.ts');
  let additions = 0;
  const keys = { ...options.keys, async add(...args) { additions++; await options.keys.add(...args); } };
  await expect(importWorkspaceRecovery(manifest, createRecoveryCard(identity, new Uint8Array(32)), keys, validators)).rejects.toThrow();
  expect(additions).toBe(0);
  const session = await importWorkspaceRecovery(manifest, createRecoveryCard(identity, key), keys, validators);
  key.fill(0);
  try {
    const archive = await WorkspaceArchives.open({ ...options, workspaceDirectory: options.destination, encryption: session });
    const backup = await archive.backup();
    const restored = await restoreEncryptedCopy({ ...options, source: options.destination,
      destination: path.join(options.root, 'restored'), backupId: backup.id, encryption: session });
    const newManifest = JSON.parse(await readFile(path.join(restored.directory, 'workspace.json'), 'utf8'));
    expect(newManifest.workspaceId).not.toBe(manifest.workspaceId);
    expect(newManifest.encryption.keyId).not.toBe(manifest.encryption.keyId);
    const newKey = await options.keys.get(newManifest.workspaceId, newManifest.encryption.keyId);
    const newSession = await WorkspaceEncryption.unlock(newManifest, newKey, validators);
    newKey.fill(0);
    try {
      expect((await readWorkspace(restored.directory, validators, newSession)).eventBytes).toEqual((await archive.verify(backup.id)).read.eventBytes);
    } finally { newSession.close(); }
  } finally { session.close(); }
}));

test('codec opens an independent native libsodium 1.0.20 KDF and AEAD vector', async () => {
  const vector = JSON.parse(await readFile(new URL('../../fixtures/scenarios/encryption-vector.json', import.meta.url), 'utf8'));
  const key = Uint8Array.from({ length: 32 }, (_, position) => position);
  const validators = await loadStoreValidators();
  const session = await WorkspaceEncryption.unlock(vector.manifest, key, validators);
  key.fill(0);
  try { expect(session.decode('event', vector.deviceId, JSON.stringify(vector.event), validators)).toBe('Synthetic interoperability vector'); }
  finally { session.close(); }
});

test('source changes after backup leave the candidate unpublished', () => fixture(async options => {
  const manifest = path.join(options.source, 'workspace.json');
  await expect(createEncryptedCopy({ ...options, fault: async phase => {
    if (phase === 'before-manifest') await writeFile(manifest, await readFile(manifest, 'utf8') + '\n');
  } })).rejects.toMatchObject({ code: 'ENCRYPTION_SOURCE_CHANGED' });
  await expect(readFile(path.join(options.destination, 'workspace.json'))).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('trusted core composition replays v2, executes domain commands and fails closed without its session', () => fixture(async options => {
  await createEncryptedCopy(options);
  const manifest = JSON.parse(await readFile(path.join(options.destination, 'workspace.json'), 'utf8'));
  const key = await options.keys.get(manifest.workspaceId, manifest.encryption.keyId);
  const session = await WorkspaceEncryption.unlock(manifest, key, await loadStoreValidators());
  key.fill(0);
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts');
  const config = { workspaceDirectory: options.destination, localDirectory: options.localDirectory,
    userEntityId: otherId, deviceLabel: 'Synthetic second device' };
  await expect(openWorkspaceHost(config)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
  const host = await openWorkspaceHost({ ...config, encryption: session });
  try {
    const label = 'Synthetic domain command';
    const id = '0c000000-0000-7000-8000-000000000099';
    expect(await host.execute({ name: 'category.create', args: { record: { id, label } } })).toMatchObject({ ok: true });
    expect(await host.administer('mcp.status', {})).toMatchObject({ access: { enabled: false } });
    for (const file of (await inventory(options.destination)).files) {
      expect(await readFile(path.join(options.destination, file), 'utf8')).not.toContain(label);
    }
  } finally { await host.close(); }
}));
