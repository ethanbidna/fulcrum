import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectManifest, importWorkspaceRecovery, loadStoreValidators, StoreError, WorkspaceEncryption } from '@fulcrum/store';
import type { EncryptedManifest, WorkspaceKeyStore } from '@fulcrum/store';
import { bundledCredentialHelper } from './release-paths.js';

const KEY_BYTES = 32;
const MAX_FRAME = 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const RECOVERY_TIMEOUT_MS = 300_000;
type Operation = 'get' | 'add' | 'recover' | 'confirm';
type Request = (action: Operation, input: Uint8Array) => Promise<Buffer>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function denied() { return new StoreError('WORKSPACE_KEY_UNAVAILABLE', 'Workspace Keychain request unavailable'); }
export function nativeKeyRequest(action: Operation, input: Uint8Array): Promise<Buffer> {
  const helper = bundledCredentialHelper();
  if (process.platform !== 'darwin' || !helper || input.byteLength > MAX_FRAME) return Promise.reject(denied());
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ['--workspace-key-helper', action], { stdio: ['pipe', 'pipe', 'ignore'], env: {} });
    const output = Buffer.alloc(MAX_FRAME);
    let size = 0;
    let invalid = false;
    const timeout = setTimeout(() => { invalid = true; child.kill('SIGKILL'); }, action === 'confirm' || action === 'recover' ? RECOVERY_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    child.once('error', () => { invalid = true; });
    child.stdin.once('error', () => { invalid = true; });
    child.stdout.on('data', (chunk: Buffer) => {
      if (size + chunk.length > output.length) { invalid = true; child.kill('SIGKILL'); }
      else { chunk.copy(output, size); size += chunk.length; }
      chunk.fill(0);
    });
    child.once('close', code => {
      clearTimeout(timeout);
      if (invalid || code !== 0) {
        output.fill(0);
        reject(!invalid && code === 2 && action === 'get'
          ? new StoreError('WORKSPACE_KEY_MISSING', 'Import a saved recovery card to open this workspace')
          : denied());
      } else resolve(output.subarray(0, size));
    });
    child.stdin.end(input);
  });
}
function account(workspaceId: string, keyId: string) {
  if (!uuid.test(workspaceId) || !uuid.test(keyId)) throw denied();
  return Buffer.from(`${workspaceId}:${keyId}`, 'ascii');
}
export class NativeWorkspaceKeys implements WorkspaceKeyStore {
  constructor(private readonly request: Request = nativeKeyRequest) {}
  async get(workspaceId: string, keyId: string) {
    const result = await this.request('get', account(workspaceId, keyId));
    if (result.length === KEY_BYTES) return result;
    result.fill(0); throw denied();
  }
  async add(workspaceId: string, keyId: string, key: Uint8Array) {
    if (key.length !== KEY_BYTES) throw denied();
    const input = Buffer.concat([account(workspaceId, keyId), key]);
    try {
      const result = await this.request('add', input);
      if (result.length) { result.fill(0); throw denied(); }
    } finally { input.fill(0); }
  }
  async recoveryCard(workspaceId: string, keyId: string) { return this.card('recover', account(workspaceId, keyId)); }
  async confirmCard(card: string) { return this.card('confirm', Buffer.from(card)); }
  private async card(action: 'confirm' | 'recover', input: Buffer) {
    try {
      const result = await this.request(action, input);
      try {
        if (!result.length || result.length > MAX_FRAME) throw denied();
        return new TextDecoder('utf-8', { fatal: true }).decode(result);
      } finally { result.fill(0); }
    } finally { input.fill(0); }
  }
}
export async function unlockConfiguredWorkspace(workspaceDirectory: string, localDirectory: string, schemaDirectory: URL,
  recover: boolean, keys = new NativeWorkspaceKeys()) {
  const validators = await loadStoreValidators(schemaDirectory);
  const manifest = await inspectManifest(workspaceDirectory, validators);
  if (manifest.schemaVersion !== 2) return undefined;
  const encrypted = manifest as EncryptedManifest;
  try {
    await lstat(path.join(localDirectory, `locked-${encrypted.workspaceId}`));
    throw new StoreError('WORKSPACE_LOCKED', 'Unlock the workspace from the native app');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    const journal = JSON.parse(await readFile(path.join(localDirectory, `migration-${encrypted.workspaceId}.json`), 'utf8')) as { phase?: string };
    if (journal.phase !== 'verified') throw new StoreError('WORKSPACE_MIGRATION_INCOMPLETE', 'This encrypted copy did not finish verification');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let key;
  try { key = await keys.get(encrypted.workspaceId, encrypted.encryption.keyId); }
  catch (error) {
    if (!recover || !(error instanceof StoreError) || error.code !== 'WORKSPACE_KEY_MISSING') throw error;
    return importWorkspaceRecovery(encrypted, await keys.recoveryCard(encrypted.workspaceId, encrypted.encryption.keyId), keys, validators);
  }
  try { return await WorkspaceEncryption.unlock(encrypted, key, validators); }
  finally { key.fill(0); }
}
