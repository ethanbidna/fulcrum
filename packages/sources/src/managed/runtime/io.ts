import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeProgress } from './types.js';

const KILL_GRACE_MS = 2000;
const MAX_COMMAND_BYTES = 256 * 1024;
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 120_000;
export interface CommandOptions { signal: AbortSignal; timeoutMs: number; input?: string; env?: NodeJS.ProcessEnv }
export type RunCommand = (binary: string, args: string[], options: CommandOptions) => Promise<string>;
export const runCommand: RunCommand = (binary, args, options) => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env,
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]) });
  let output = ''; let bytes = 0; let failed = false; let killTimer: NodeJS.Timeout | undefined;
  const fail = () => {
    if (failed) return;
    failed = true; child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS); killTimer.unref();
  };
  child.on('error', fail); child.stdin.on('error', () => undefined);
  child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_COMMAND_BYTES) fail(); });
  child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_COMMAND_BYTES) { fail(); return; } output += chunk.toString('utf8'); });
  child.on('close', code => {
    clearTimeout(killTimer);
    if (failed || code !== 0) { reject(new Error('runtime_command_failed')); return; }
    resolve(output);
  });
  child.stdin.end(options.input ?? '');
});

export async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('unsafe_runtime_directory');
}
export async function privateJson(file: string): Promise<unknown | undefined> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_COMMAND_BYTES) throw new Error('unsafe_runtime_record');
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await privateJson(file);
  const temporary = `${file}.${randomUUID()}.candidate`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function downloadLima(file: string, release: { url: string; digest: string; bytes: number }, signal: AbortSignal,
  progress: (progress: RuntimeProgress) => void, request: typeof fetch = fetch): Promise<void> {
  let url = new URL(release.url); let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (url.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(url.hostname) || url.username || url.password) throw new Error('untrusted_runtime_download');
    response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]), redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location) throw new Error('invalid_runtime_redirect');
    url = new URL(location, url);
  }
  if (!response?.ok || !response.body) throw new Error('runtime_download_failed');
  const hash = createHash('sha256'); let bytes = 0;
  const output = await open(file, 'wx', 0o600);
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted(); bytes += chunk.byteLength;
      if (bytes > release.bytes) throw new Error('runtime_download_size');
      hash.update(chunk); await output.write(chunk);
      progress({ message: 'Downloading the local runtime…', completedBytes: bytes, totalBytes: release.bytes });
    }
    await output.sync();
  } finally { await output.close(); }
  if (bytes !== release.bytes || hash.digest('hex') !== release.digest) throw new Error('runtime_download_digest');
}
export async function fileDigest(file: string): Promise<string> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error('unsafe_runtime_binary');
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
export const binaryPath = (directory: string, version: string) => path.join(directory, `lima-${version}`, 'bin', 'limactl');
