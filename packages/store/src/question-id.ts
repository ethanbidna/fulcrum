import { createHash } from 'node:crypto';

// Fixed across devices and versions; changing it would duplicate derived records.
export const QUESTION_NAMESPACE = 'a1774be0-3f7b-5dc6-a7e3-28574b6df571';
const UUID_BYTES = 16;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const UUID_V5 = 0x50;
const RFC_VARIANT = 0x80;
const VERSION_MASK = 0x0f;
const VARIANT_MASK = 0x3f;
export function questionId(dedupeKey: string): string {
  const namespace = Buffer.from(QUESTION_NAMESPACE.replaceAll('-', ''), 'hex');
  const bytes = createHash('sha1').update(namespace).update(dedupeKey, 'utf8').digest().subarray(0, UUID_BYTES);
  bytes[VERSION_BYTE] = (bytes[VERSION_BYTE]! & VERSION_MASK) | UUID_V5;
  bytes[VARIANT_BYTE] = (bytes[VARIANT_BYTE]! & VARIANT_MASK) | RFC_VARIANT;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
