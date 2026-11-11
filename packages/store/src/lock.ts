import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import lockfile from 'proper-lockfile';
import { atomicFile, StoreError, uuid, PRIVATE_FILE_MODE } from './files.js';

const DEFAULT_STALE_MS = 30_000;
const MINIMUM_UPDATE_MS = 1000;
export async function acquireCoreLock(localDirectory: string, staleMs = DEFAULT_STALE_MS) {
  await mkdir(localDirectory, { recursive: true });
  const ownerFile = path.join(localDirectory, 'core-owner.json');
  const owner = await readOwner(ownerFile);
  // A paused live core must not lose its lock merely because its heartbeat aged.
  if (owner && alive(owner.pid)) throw new StoreError('CORE_LOCKED', 'Another core is using this local profile');
  const target = path.join(localDirectory, 'core');
  const handle = await open(target, 'a', PRIVATE_FILE_MODE); await handle.close();
  let compromised = false;
  let release;
  try {
    release = await lockfile.lock(target, { stale: staleMs, update: Math.max(MINIMUM_UPDATE_MS, Math.floor(staleMs / 2)), retries: 0, lockfilePath: path.join(localDirectory, 'core.lock'), onCompromised: () => { compromised = true; } });
  } catch { throw new StoreError('CORE_LOCKED', 'Another core holds the local workspace lock'); }
  const token = uuid();
  try { await atomicFile(ownerFile, JSON.stringify({ pid: process.pid, token })); }
  catch (error) { await release(); throw error; }
  return {
    async assertOwned() {
      const current = await readOwner(ownerFile);
      if (compromised || current?.token !== token) throw new StoreError('CORE_LOCK_LOST', 'Core lock ownership was lost');
    },
    async release() {
      const current = await readOwner(ownerFile);
      if (current?.token === token) await unlink(ownerFile);
      await release();
    },
  };
}
async function readOwner(file: string): Promise<{ pid: number; token: string } | null> {
  try {
    const owner = JSON.parse(await readFile(file, 'utf8')) as { pid: number; token: string };
    if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') throw new Error('invalid lock owner');
    return owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new StoreError('CORE_LOCKED', 'Local lock owner could not be verified');
  }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
