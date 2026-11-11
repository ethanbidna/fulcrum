import { readdir, readFile, open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeEvent } from '@fulcrum/schema';
import { atomicCreate, ensureDirectory, SEGMENT_BYTES, StoreError, PRIVATE_FILE_MODE } from './files.js';
import type { WorkspaceEncryption } from './encryption.js';
import type { StoreOptions } from './interfaces.js';

export async function writeEvents(directory: string, events: ChangeEvent[], fault: StoreOptions['fault'], encryption?: WorkspaceEncryption) {
  const first = events[0]!;
  const folder = path.join(directory, 'log', first.deviceId);
  const lines: string[] = [];
  let size = 0;
  for (const event of events) {
    const raw = JSON.stringify(event);
    const line = (encryption ? encryption.encode('event', event.deviceId, raw) : raw) + '\n';
    size += Buffer.byteLength(line);
    if (size > SEGMENT_BYTES) throw new StoreError('TRANSACTION_TOO_LARGE', 'A transaction must fit in one 1 MiB segment');
    lines.push(line);
  }
  const content = lines.join('');
  const bytes = Buffer.from(content);
  await ensureDirectory(path.join(directory, 'log')); await ensureDirectory(folder);
  const day = first.at.slice(0, 10);
  const file = path.join(folder, `${day}-${String(first.seq).padStart(6, '0')}.jsonl`);
  if (events.length > 1) {
    await mustNotExist(file);
    await atomicCreate(file, content, async () => { await fault?.('batch-before-publish'); });
    return;
  }
  const candidates = (await readdir(folder)).filter(name => /^\d{4}-\d{2}-\d{2}-\d+\.jsonl$/.test(name)).sort();
  const last = candidates.at(-1);
  const appendTarget = last && path.join(folder, last);
  const previous = appendTarget ? await readFile(appendTarget) : null;
  if (!appendTarget || !last?.startsWith(day) || !previous?.length || previous.at(-1) !== 10 || previous.length + bytes.length > SEGMENT_BYTES) {
    await mustNotExist(file);
    await atomicCreate(file, content); return;
  }
  const handle = await open(appendTarget, 'a', PRIVATE_FILE_MODE);
  try {
    if (fault) {
      const split = Math.floor(bytes.length / 2);
      await handle.writeFile(bytes.subarray(0, split)); await fault('append-half'); await handle.writeFile(bytes.subarray(split));
    } else await handle.writeFile(bytes);
    await handle.sync(); await fault?.('append-fsync');
  } finally { await handle.close(); }
}
async function mustNotExist(file: string) {
  try { await stat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new StoreError('SEGMENT_COLLISION', 'Refusing to replace an existing event segment');
}
