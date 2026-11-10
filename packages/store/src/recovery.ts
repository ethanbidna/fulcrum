import { createHash } from 'node:crypto';
import { StoreError, UUID } from './files.js';
import { strictJson } from './strict-json.js';

const FORMAT = 'fulcrum-recovery';
const VERSION = 1;
const KEY_BYTES = 32;
const CARD_BYTES = 1024;
const fields = ['format', 'version', 'workspaceId', 'keyId', 'encodedKey', 'checksum'];
type KeyIdentity = { workspaceId: string; keyId: string };
function invalid() { return new StoreError('RECOVERY_CARD_INVALID', 'Invalid recovery card'); }
function checksum(identity: KeyIdentity, encodedKey: string) {
  return createHash('sha256').update(JSON.stringify([FORMAT, VERSION, identity.workspaceId, identity.keyId, encodedKey])).digest('hex');
}
export function createRecoveryCard(identity: KeyIdentity, key: Uint8Array) {
  if (!UUID.test(identity.workspaceId) || !UUID.test(identity.keyId) || key.length !== KEY_BYTES) throw invalid();
  const encodedKey = Buffer.from(key).toString('base64url');
  return JSON.stringify({ format: FORMAT, version: VERSION, workspaceId: identity.workspaceId, keyId: identity.keyId, encodedKey, checksum: checksum(identity, encodedKey) });
}
export function parseRecoveryCard(text: string, identity: KeyIdentity): Uint8Array {
  if (Buffer.byteLength(text) > CARD_BYTES) throw invalid();
  const value = strictJson(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const card = value as Record<string, unknown>;
  if (Object.keys(card).length !== fields.length || !fields.every(field => Object.hasOwn(card, field)) ||
      !UUID.test(identity.workspaceId) || !UUID.test(identity.keyId) || card.format !== FORMAT || card.version !== VERSION ||
      card.workspaceId !== identity.workspaceId || card.keyId !== identity.keyId ||
      typeof card.encodedKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(card.encodedKey) ||
      card.checksum !== checksum(identity, card.encodedKey)) throw invalid();
  const key = Buffer.from(card.encodedKey, 'base64url');
  if (key.length === KEY_BYTES && key.toString('base64url') === card.encodedKey) return key;
  key.fill(0); throw invalid();
}
