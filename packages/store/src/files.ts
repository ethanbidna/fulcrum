import { open, mkdir, rename, unlink, realpath, lstat, link } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const SEGMENT_BYTES = 1024 * 1024;
export const CHECKPOINT_LIMIT = 3;
export const WATCH_INTERVAL_MS = 500;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PRIVATE_FILE_MODE = 0o600;
export class StoreError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export function uuid(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6]! & 15) | 0x70; bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function durableFile(file: string, content: string | Uint8Array) {
  const handle = await open(file, 'wx', PRIVATE_FILE_MODE);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
}
export async function atomicFile(file: string, content: string, beforePublish?: () => Promise<void>) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.tmp-${uuid()}`);
  try {
    await durableFile(temporary, content);
    await beforePublish?.();
    await rename(temporary, file);
    await syncDirectory(directory);
  } finally { await unlink(temporary).catch(() => undefined); }
}
export async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true });
  await syncDirectory(path.dirname(directory));
}
export async function requireRealDirectory(directory: string) {
  if ((await lstat(directory)).isSymbolicLink()) throw new StoreError('WORKSPACE_PATH_UNSAFE', 'Workspace children cannot be symbolic links');
  return realpath(directory);
}
export function nextHlc(latest: string, milliseconds: number): string {
  const [previousMs = 0, previousCounter = 0] = latest.split('-').map(Number);
  const MAX_COUNTER = 9999;
  if (milliseconds > previousMs) return `${String(milliseconds).padStart(13, '0')}-0000`;
  if (previousCounter === MAX_COUNTER) return `${String(previousMs + 1).padStart(13, '0')}-0000`;
  return `${String(previousMs).padStart(13, '0')}-${String(previousCounter + 1).padStart(4, '0')}`;
}

export async function atomicCreate(file: string, content: string, beforePublish?: () => Promise<void>) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.tmp-${uuid()}`);
  try {
    await durableFile(temporary, content); await beforePublish?.();
    try { await link(temporary, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StoreError('SEGMENT_COLLISION', 'Refusing to replace an incoming segment');
      throw error;
    }
    await syncDirectory(directory);
  } finally { await unlink(temporary).catch(() => undefined); }
}
export async function resolvedLocation(directory: string): Promise<string> {
  let current = path.resolve(directory); const missing: string[] = [];
  while (true) {
    try { return path.join(await realpath(current), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current)); current = parent;
    }
  }
}
