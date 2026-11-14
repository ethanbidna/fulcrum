import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GmailClient } from '@fulcrum/sources';

const MAX_CLIENT_BYTES = 8192;
const valid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,512}$/.test(value);

export async function configuredGmailClient(directory: string): Promise<GmailClient | undefined> {
  const file = path.join(directory, 'gmail-oauth-client.json');
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_CLIENT_BYTES) return;
    const { installed } = JSON.parse(await readFile(file, 'utf8')) as { installed?: Partial<GmailClient> };
    if (valid(installed?.client_id) && valid(installed?.client_secret)) {
      return { client_id: installed.client_id, client_secret: installed.client_secret };
    }
  } catch { return; }
}
