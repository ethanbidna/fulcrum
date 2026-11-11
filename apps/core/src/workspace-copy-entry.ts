import { createEncryptedCopy, restoreEncryptedCopy, rotateEncryptedCopy } from '@fulcrum/store';
import { NativeWorkspaceKeys, unlockConfiguredWorkspace } from './workspace-keys.js';
import { bundledCredentialHelper } from './release-paths.js';
import path from 'node:path';

const REQUEST_BYTES = 16 * 1024;
export async function copyEncryptedWorkspace(localDirectory: string, schemaDirectory: URL) {
  if (!bundledCredentialHelper() || process.stdin.isTTY || process.stdout.isTTY) throw new Error('NATIVE_SETUP_REQUIRED');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > REQUEST_BYTES) throw new Error('INVALID_COPY_REQUEST');
    chunks.push(chunk);
  }
  const request: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['source', 'destination', 'operation', 'backupId'].includes(key)) || !('source' in request) || !('destination' in request) ||
      typeof request.source !== 'string' || typeof request.destination !== 'string' ||
      !path.isAbsolute(request.source) || !path.isAbsolute(request.destination)) throw new Error('INVALID_COPY_REQUEST');
  const operation = 'operation' in request ? request.operation : 'copy';
  const backupId = 'backupId' in request ? request.backupId : undefined;
  if (typeof operation !== 'string' || !['copy', 'rotate', 'restore'].includes(operation) ||
      (operation === 'restore' ? typeof backupId !== 'string' : backupId !== undefined)) throw new Error('INVALID_COPY_REQUEST');
  const keys = new NativeWorkspaceKeys();
  const options = { source: request.source, destination: request.destination,
    localDirectory, schemaDirectory, keys, confirmRecovery: (card: string) => keys.confirmCard(card) };
  if (operation === 'copy') { await createEncryptedCopy(options); return; }
  const encryption = await unlockConfiguredWorkspace(request.source, localDirectory, schemaDirectory, false, keys);
  if (!encryption) throw new Error('ENCRYPTED_SOURCE_REQUIRED');
  try {
    if (operation === 'restore' && typeof backupId === 'string') await restoreEncryptedCopy({ ...options, encryption, backupId });
    else await rotateEncryptedCopy({ ...options, encryption });
  } finally { encryption.close(); }
}
