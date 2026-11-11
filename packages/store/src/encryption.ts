import sodium from 'libsodium-wrappers-sumo';
import type { WorkspaceManifest } from '@fulcrum/schema';
import type { StoreValidators } from './validation.js';
import { SEGMENT_BYTES, StoreError, UUID, uuid } from './files.js';
import { strictJson } from './strict-json.js';

export const ENCRYPTED_VERSION = 2;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_CHECKPOINT_BYTES = 48 * 1024 * 1024;
const MAX_CHECKPOINT_PLAINTEXT_BYTES = 32 * 1024 * 1024;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const KDF_CONTEXT = 'FULCRUM2';
const SCHEME = 'xchacha20poly1305-ietf-v1';
const ENCODING = 'fulcrum-encrypted-v1';
const purpose = { event: 1, checkpoint: 2, manifest: 3 } as const;
type Purpose = keyof typeof purpose;
type RecordKind = Exclude<Purpose, 'manifest'>;
interface Sealed { nonce: string; ciphertext: string }
interface Envelope extends Sealed { encoding: typeof ENCODING; kind: RecordKind; keyId: string }
export interface EncryptedManifest extends WorkspaceManifest {
  schemaVersion: typeof ENCRYPTED_VERSION;
  minReaderVersion: typeof ENCRYPTED_VERSION;
  encryption: { scheme: typeof SCHEME; keyId: string; check: Sealed };
}

export async function generateWorkspaceKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(KEY_BYTES);
}

function bounds(kind: Purpose) {
  if (kind === 'event') return SEGMENT_BYTES;
  if (kind === 'checkpoint') return MAX_CHECKPOINT_BYTES;
  return MAX_MANIFEST_BYTES;
}
function plaintextLimit(kind: Purpose) {
  return kind === 'checkpoint' ? MAX_CHECKPOINT_PLAINTEXT_BYTES : bounds(kind);
}
function invalid() { return new StoreError('ENCRYPTION_FORMAT_INVALID', 'Invalid encrypted storage record'); }
function decode(text: string, maximum: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(maximum * 4 / 3)) throw invalid();
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.length > maximum || bytes.toString('base64url') !== text) throw invalid();
  return bytes;
}
function manifestPayload(manifest: EncryptedManifest) {
  return JSON.stringify([manifest.format, manifest.schemaVersion, manifest.workspaceId, manifest.createdAt,
    manifest.minReaderVersion, manifest.encryption.scheme, manifest.encryption.keyId]);
}
export class WorkspaceEncryption {
  private closed = false;
  private constructor(private readonly workspaceId: string, private readonly keyId: string,
    private readonly keys: Record<Purpose, Uint8Array>) {}

  private static async derive(workspaceId: string, keyId: string, master: Uint8Array) {
    if (!UUID.test(workspaceId) || !UUID.test(keyId) || master.length !== KEY_BYTES) throw invalid();
    await sodium.ready;
    const derive = (kind: Purpose) => sodium.crypto_kdf_derive_from_key(KEY_BYTES, purpose[kind], KDF_CONTEXT, master);
    return new WorkspaceEncryption(workspaceId, keyId, { event: derive('event'), checkpoint: derive('checkpoint'), manifest: derive('manifest') });
  }
  static async create(master: Uint8Array, now = new Date()) {
    const manifest: EncryptedManifest = {
      format: 'fulcrum-workspace', schemaVersion: ENCRYPTED_VERSION, minReaderVersion: ENCRYPTED_VERSION,
      workspaceId: uuid(), createdAt: now.toISOString(),
      encryption: { scheme: SCHEME, keyId: uuid(), check: { nonce: '', ciphertext: '' } },
    };
    const session = await this.derive(manifest.workspaceId, manifest.encryption.keyId, master);
    try {
      manifest.encryption.check = session.seal('manifest', null, manifestPayload(manifest));
      return { manifest, session };
    } catch (error) { session.close(); throw error; }
  }
  static async unlock(manifest: EncryptedManifest, master: Uint8Array, validators: StoreValidators) {
    if (!validators.encryptedManifest(manifest)) throw invalid();
    const session = await this.derive(manifest.workspaceId, manifest.encryption.keyId, master);
    try { session.verify(manifest, validators); return session; }
    catch (error) { session.close(); throw error; }
  }
  verify(manifest: EncryptedManifest, validators: StoreValidators) {
    if (!validators.encryptedManifest(manifest) || manifest.workspaceId !== this.workspaceId ||
        manifest.encryption.keyId !== this.keyId ||
        this.open('manifest', null, manifest.encryption.check) !== manifestPayload(manifest)) throw invalid();
  }
  encode(kind: RecordKind, deviceId: string, text: string) {
    const encoded = JSON.stringify({ encoding: ENCODING, kind, keyId: this.keyId, ...this.seal(kind, deviceId, text) });
    if (Buffer.byteLength(encoded) + (kind === 'event' ? 1 : 0) > bounds(kind)) throw invalid();
    return encoded;
  }
  decode(kind: RecordKind, deviceId: string, encoded: string, validators: StoreValidators) {
    if (Buffer.byteLength(encoded) > bounds(kind)) throw invalid();
    const value = strictJson(encoded);
    if (!validators.envelope(value)) throw invalid();
    const envelope = value as Envelope;
    if (envelope.kind !== kind || envelope.keyId !== this.keyId) throw invalid();
    return this.open(kind, deviceId, envelope);
  }
  close() { this.closed = true; for (const key of Object.values(this.keys)) key.fill(0); }

  private associatedData(kind: Purpose, deviceId: string | null) {
    if (this.closed) throw new StoreError('WORKSPACE_LOCKED', 'Workspace encryption session is closed');
    if (deviceId !== null && !UUID.test(deviceId)) throw invalid();
    return Buffer.from(JSON.stringify(['Fulcrum', ENCRYPTED_VERSION, kind, this.workspaceId, this.keyId, deviceId]));
  }
  private seal(kind: Purpose, deviceId: string | null, text: string): Sealed {
    const associated = this.associatedData(kind, deviceId);
    if (Buffer.byteLength(text) > plaintextLimit(kind)) throw invalid();
    const plaintext = Buffer.from(text);
    try {
      const nonce = sodium.randombytes_buf(NONCE_BYTES);
      const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, associated, null, nonce, this.keys[kind]);
      return { nonce: Buffer.from(nonce).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') };
    } finally { plaintext.fill(0); }
  }
  private open(kind: Purpose, deviceId: string | null, sealed: Sealed) {
    const associated = this.associatedData(kind, deviceId);
    const nonce = decode(sealed.nonce, NONCE_BYTES);
    const ciphertext = decode(sealed.ciphertext, plaintextLimit(kind) + TAG_BYTES);
    if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw invalid();
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, associated, nonce, this.keys[kind]);
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
    } catch { throw new StoreError('WORKSPACE_AUTHENTICATION_FAILED', 'Encrypted storage authentication failed'); }
    finally { plaintext?.fill(0); }
  }
}
