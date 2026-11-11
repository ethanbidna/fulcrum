import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileImage, WorkspaceArchives } from './archive.js';
import { atomicCreate, atomicFile, ensureDirectory, StoreError, syncDirectory, resolvedLocation } from './files.js';
import { acquireCoreLock } from './lock.js';
import { readWorkspace } from './reader.js';
import { generateWorkspaceKey, WorkspaceEncryption } from './encryption.js';
import type { EncryptedManifest } from './encryption.js';
import { createRecoveryCard, parseRecoveryCard } from './recovery.js';
import { strictJson } from './strict-json.js';
import { loadStoreValidators } from './validation.js';

export interface WorkspaceKeyStore {
  get(workspaceId: string, keyId: string): Promise<Uint8Array>;
  add(workspaceId: string, keyId: string, key: Uint8Array): Promise<void>;
}
interface DestinationOptions {
  destination: string;
  localDirectory: string;
  keys: WorkspaceKeyStore;
  confirmRecovery: (card: string) => Promise<string>;
  schemaDirectory?: URL;
  fault?: (phase: 'after-key' | 'before-manifest' | 'after-manifest') => Promise<void>;
}
interface CopyOptions extends DestinationOptions { source: string }
interface EncryptedSource { backupId?: string; encryption: WorkspaceEncryption }
type RestoreOptions = CopyOptions & EncryptedSource & { backupId: string };

export async function importWorkspaceRecovery(manifest: EncryptedManifest, card: string, keys: WorkspaceKeyStore,
  validators: Awaited<ReturnType<typeof loadStoreValidators>>) {
  if (!validators.encryptedManifest(manifest)) throw new StoreError('ENCRYPTION_FORMAT_INVALID', 'Invalid encrypted workspace manifest');
  const identity = { workspaceId: manifest.workspaceId, keyId: manifest.encryption.keyId };
  const key = parseRecoveryCard(card, identity);
  try {
    (await WorkspaceEncryption.unlock(manifest, key, validators)).close();
    await keys.add(identity.workspaceId, identity.keyId, key);
    const saved = await keys.get(identity.workspaceId, identity.keyId);
    try { return await WorkspaceEncryption.unlock(manifest, saved, validators); }
    finally { saved.fill(0); }
  } finally { key.fill(0); }
}
function disjoint(left: string, right: string) {
  return left !== right && !left.startsWith(right + path.sep) && !right.startsWith(left + path.sep);
}
function sourceChanged(): never {
  throw new StoreError('ENCRYPTION_SOURCE_CHANGED', 'Source changed during migration; keep it and prepare another copy');
}
async function verifySavedKey(options: DestinationOptions, manifest: EncryptedManifest, validators: Awaited<ReturnType<typeof loadStoreValidators>>) {
  const key = await options.keys.get(manifest.workspaceId, manifest.encryption.keyId);
  try { return await WorkspaceEncryption.unlock(manifest, key, validators); }
  finally { key.fill(0); }
}
async function prepare(options: DestinationOptions, validators: Awaited<ReturnType<typeof loadStoreValidators>>) {
  const key = await generateWorkspaceKey();
  try {
    const { manifest, session } = await WorkspaceEncryption.create(key);
    session.close();
    const identity = { workspaceId: manifest.workspaceId, keyId: manifest.encryption.keyId };
    await options.keys.add(identity.workspaceId, identity.keyId, key);
    (await verifySavedKey(options, manifest, validators)).close();
    await options.fault?.('after-key');
    const reentered = parseRecoveryCard(await options.confirmRecovery(createRecoveryCard(identity, key)), identity);
    try { (await WorkspaceEncryption.unlock(manifest, reentered, validators)).close(); }
    finally { reentered.fill(0); }
    return manifest;
  } finally { key.fill(0); }
}
async function publishEvents(destination: string, snapshot: Awaited<ReturnType<typeof readWorkspace>>, session: WorkspaceEncryption) {
  for (const [index, event] of snapshot.events.entries()) {
    const folder = path.join(destination, 'log', event.deviceId);
    await ensureDirectory(path.dirname(folder));
    await ensureDirectory(folder);
    const file = path.join(folder, `${event.at.slice(0, 10)}-${String(event.seq).padStart(6, '0')}.jsonl`);
    await atomicCreate(file, session.encode('event', event.deviceId, snapshot.eventBytes[index]!) + '\n');
  }
}
type Snapshot = Awaited<ReturnType<typeof readWorkspace>>;
type Validators = Awaited<ReturnType<typeof loadStoreValidators>>;

async function copyVerifiedHistory(options: DestinationOptions, validators: Validators, snapshot: Snapshot,
  sourceDigest: string, verifySource: () => Promise<void>, assertLock: () => Promise<void>) {
  for (const event of snapshot.eventBytes) strictJson(event);
  const manifest = await prepare(options, validators);
  const journal = path.join(options.localDirectory, `migration-${manifest.workspaceId}.json`);
  const record = { sourceWorkspaceId: snapshot.manifest.workspaceId, destinationWorkspaceId: manifest.workspaceId,
    sourceDigest, eventCount: snapshot.events.length, lastHlc: snapshot.events.at(-1)?.hlc ?? null };
  await atomicCreate(journal, JSON.stringify({ ...record, phase: 'copying' }));
  const session = await verifySavedKey(options, manifest, validators);
  try {
    await mkdir(options.destination, { mode: 0o700 });
    await syncDirectory(path.dirname(options.destination));
    await publishEvents(options.destination, snapshot, session);
    await options.fault?.('before-manifest');
    await assertLock();
    await verifySource();
    await atomicCreate(path.join(options.destination, 'workspace.json'), JSON.stringify(manifest));
    await options.fault?.('after-manifest');
  } finally { session.close(); }
  const fresh = await verifySavedKey(options, manifest, validators);
  try {
    const verified = await readWorkspace(options.destination, validators, fresh);
    await verifySource();
    if (JSON.stringify(verified.eventBytes) !== JSON.stringify(snapshot.eventBytes)) {
      throw new StoreError('ENCRYPTED_COPY_INVALID', 'Encrypted copy history does not match the backup');
    }
  } finally { fresh.close(); }
  await atomicFile(journal, JSON.stringify({ ...record, phase: 'verified' }));
  return { directory: options.destination, workspaceId: manifest.workspaceId };
}
async function lockedCopy(options: CopyOptions, encryptedSource?: EncryptedSource) {
  const source = await realpath(options.source);
  const local = await resolvedLocation(options.localDirectory);
  const requested = path.resolve(options.destination);
  const parent = await realpath(path.dirname(requested));
  const destination = path.join(parent, path.basename(requested));
  if (!disjoint(source, destination) || !disjoint(local, destination) || !disjoint(source, local)) {
    throw new StoreError('ENCRYPTION_PATH_OVERLAP', 'Choose separate source, destination and local profile directories');
  }
  const archive = await WorkspaceArchives.open({ workspaceDirectory: source, localDirectory: local,
    ...(encryptedSource ? { encryption: encryptedSource.encryption } : {}),
    ...(options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {}) });
  const lock = await acquireCoreLock(local);
  try {
    const validators = await loadStoreValidators(options.schemaDirectory);
    const backupId = encryptedSource?.backupId ?? (await archive.backup()).id;
    const { directory, read } = await archive.verify(backupId);
    const expected = await fileImage(directory);
    const verifySource = async () => {
      if ((await fileImage(encryptedSource?.backupId ? directory : source)).digest !== expected.digest) sourceChanged();
    };
    await verifySource();
    const result = await copyVerifiedHistory({ ...options, localDirectory: local, destination }, validators, read, expected.digest, verifySource, () => lock.assertOwned());
    return { ...result, backupId };
  } finally { await lock.release(); }
}

export function createEncryptedCopy(options: CopyOptions) { return lockedCopy(options); }
export function restoreEncryptedCopy(options: RestoreOptions) { return lockedCopy(options, options); }

export function rotateEncryptedCopy(options: CopyOptions & EncryptedSource) { return lockedCopy(options, options); }
