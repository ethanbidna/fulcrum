import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdtemp, rename, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ACTIVEPIECES_VERSION, CONTAINER_NAME, CONTAINER_NAMESPACE, CONTAINER_MEMORY, DATA_VOLUME, VM_CPUS, GUEST_PORT, LIMA_VERSION, REQUIRED_FREE_DISK_BYTES, RUNTIME_RELEASES, VM_NAME, vmConfiguration, type RuntimeArchitecture } from './catalog.js';
import { binaryPath, downloadLima, fileDigest, privateDirectory, privateJson, runCommand, writePrivateJson, type RunCommand } from './io.js';
import type { ConnectorRuntime, RuntimeKeys, RuntimeKeyStore, RuntimeProgress } from './types.js';

const COMMAND_TIMEOUT_MS = 60_000;
const BOOT_TIMEOUT_MS = 12 * 60_000;
const PULL_TIMEOUT_MS = 15 * 60_000;
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 1000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_SOCKET_PATH_BYTES = 100;
const MAX_FLAGS_BYTES = 128 * 1024;
interface Installation { v: 1; architecture: RuntimeArchitecture; port: number; owner: string; keyDigest: string; binaryDigest: string }
interface Options { directory: string; stateDirectory: string; keys: RuntimeKeyStore; freeDiskBytes?: (directory: string) => Promise<number>; architecture?: RuntimeArchitecture; request?: typeof fetch; run?: RunCommand }
const digestKeys = (keys: RuntimeKeys) => createHash('sha256').update(keys.encryption + keys.jwt).digest('hex');
export function validRuntimeKeys(value: unknown): value is RuntimeKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = value as Record<string, unknown>;
  return Object.keys(keys).length === 2 && typeof keys.encryption === 'string' && /^[0-9a-f]{32}$/.test(keys.encryption)
    && typeof keys.jwt === 'string' && /^[0-9a-f]{64}$/.test(keys.jwt);
}
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function freeDiskBytes(directory: string): Promise<number> {
  const disk = await statfs(directory);
  return Number(disk.bavail) * Number(disk.bsize);
}
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('runtime_port_unavailable');
  return address.port;
}

export class LimaConnectorRuntime implements ConnectorRuntime {
  private readonly architecture: RuntimeArchitecture;
  private readonly request: typeof fetch;
  private readonly run: RunCommand;
  private busy = false;
  constructor(private readonly options: Options) {
    const architecture = options.architecture ?? process.arch;
    if (architecture !== 'x64' && architecture !== 'arm64') throw new Error('unsupported_runtime_architecture');
    this.architecture = architecture; this.request = options.request ?? fetch; this.run = options.run ?? runCommand;
  }
  private get markerFile() { return path.join(this.options.directory, 'installation.json'); }
  private get binary() { return binaryPath(this.options.directory, LIMA_VERSION); }
  private async record(): Promise<Installation | undefined> {
    const value = await privateJson(this.markerFile);
    if (value === undefined) return;
    const record = value as Installation;
    if (!record || Object.keys(record).length !== 6 || record.v !== 1 || record.architecture !== this.architecture
      || !Number.isInteger(record.port) || record.port < 1024 || record.port > 65535 || typeof record.owner !== 'string'
      || !/^[0-9a-f-]{36}$/.test(record.owner) || !/^[0-9a-f]{64}$/.test(record.keyDigest) || !/^[0-9a-f]{64}$/.test(record.binaryDigest)) throw new Error('invalid_runtime_installation');
    return record;
  }
  async installed(): Promise<boolean> { return !!await this.record(); }
  private command(args: string[], signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS, input?: string): Promise<string> {
    return this.run(this.binary, ['--log-level=error', ...args], { signal, timeoutMs,
      env: { ...process.env, LIMA_HOME: this.options.stateDirectory }, ...(input === undefined ? {} : { input }) });
  }
  private guest(args: string[], signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS, input?: string): Promise<string> {
    return this.command(['shell', VM_NAME, '--', ...args], signal, timeoutMs, input);
  }
  private nerdctl(args: string[], signal: AbortSignal, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    return this.guest(['nerdctl', '--namespace', CONTAINER_NAMESPACE, ...args], signal, timeoutMs);
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('runtime_operation_in_progress');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private async directories(): Promise<void> {
    if (Buffer.byteLength(path.join(this.options.stateDirectory, VM_NAME, 'ssh.sock')) > MAX_SOCKET_PATH_BYTES) throw new Error('runtime_profile_path_too_long');
    await privateDirectory(this.options.directory); await privateDirectory(this.options.stateDirectory);
  }
  private async ensureKeys(record?: Installation): Promise<RuntimeKeys> {
    let keys = await this.options.keys.read();
    if (!keys) {
      if (record) throw new Error('runtime_keys_missing');
      keys = { encryption: randomBytes(16).toString('hex'), jwt: randomBytes(32).toString('hex') };
      await this.options.keys.write(keys);
    }
    if (!validRuntimeKeys(keys) || record && digestKeys(keys) !== record.keyDigest) throw new Error('runtime_keys_mismatch');
    return keys;
  }
  private async installLima(signal: AbortSignal, progress: (value: RuntimeProgress) => void): Promise<void> {
    const installed = path.dirname(path.dirname(this.binary));
    if (await exists(installed)) return;
    const candidate = await mkdtemp(path.join(this.options.directory, 'candidate-'));
    try {
      const archive = path.join(candidate, 'lima.tar.gz');
      await downloadLima(archive, RUNTIME_RELEASES[this.architecture].lima, signal, progress, this.request);
      const unpacked = path.join(candidate, 'unpacked'); await privateDirectory(unpacked);
      await this.run('/usr/bin/tar', ['-xzf', archive, '-C', unpacked], { signal, timeoutMs: COMMAND_TIMEOUT_MS });
      await fileDigest(path.join(unpacked, 'bin', 'limactl'));
      await rename(unpacked, installed);
    } finally { await rm(candidate, { recursive: true, force: true }); }
  }
  async install(signal: AbortSignal, progress: (value: RuntimeProgress) => void): Promise<string> {
    return this.exclusive(async () => {
      await this.directories();
      const freeBytes = this.options.freeDiskBytes ? await this.options.freeDiskBytes(this.options.directory) : await freeDiskBytes(this.options.directory);
      if (freeBytes < REQUIRED_FREE_DISK_BYTES) throw new Error('runtime_disk_space');
      let record = await this.record();
      if (!record && await exists(path.join(this.options.stateDirectory, VM_NAME))) throw new Error('unowned_runtime_instance');
      const keys = await this.ensureKeys(record);
      await this.installLima(signal, progress); signal.throwIfAborted();
      if (!record) {
        record = { v: 1, architecture: this.architecture, port: await availablePort(), owner: randomUUID(), keyDigest: digestKeys(keys), binaryDigest: await fileDigest(this.binary) };
        await writePrivateJson(this.markerFile, record);
      }
      return this.startOwned(record, keys, signal, progress);
    });
  }
  async start(signal: AbortSignal, progress: (value: RuntimeProgress) => void): Promise<string> {
    return this.exclusive(async () => {
      await this.directories(); const record = await this.record();
      if (!record) throw new Error('runtime_not_installed');
      return this.startOwned(record, await this.ensureKeys(record), signal, progress);
    });
  }
  private async startOwned(record: Installation, keys: RuntimeKeys, signal: AbortSignal, progress: (value: RuntimeProgress) => void): Promise<string> {
    if (await fileDigest(this.binary) !== record.binaryDigest) throw new Error('runtime_binary_changed');
    const origin = `http://127.0.0.1:${record.port}`;
    try {
      progress({ message: 'Preparing the isolated Linux service…', completedBytes: null, totalBytes: null });
      const config = path.join(this.options.directory, 'vm.json');
      await writePrivateJson(config, JSON.parse(vmConfiguration(this.architecture, record.port)) as unknown);
      const present = await exists(path.join(this.options.stateDirectory, VM_NAME));
      await this.command(['start', '--tty=false', '--timeout=10m', ...(present ? [VM_NAME] : ['--name', VM_NAME, config])], signal, BOOT_TIMEOUT_MS);
      await this.ensureVolume(record, signal);
      const names = (await this.nerdctl(['ps', '-a', '--format', '{{.Names}}'], signal)).trim().split('\n');
      if (names.includes(CONTAINER_NAME)) {
        const labels = JSON.parse(await this.nerdctl(['inspect', '--format', '{{json .Config.Labels}}', CONTAINER_NAME], signal)) as Record<string, string>;
        if (labels['io.fulcrum.owner'] !== record.owner || labels['io.fulcrum.image'] !== RUNTIME_RELEASES[this.architecture].image) throw new Error('unowned_runtime_container');
        await this.nerdctl(['start', CONTAINER_NAME], signal);
      } else {
        progress({ message: 'Downloading and verifying the connection service image…', completedBytes: null, totalBytes: null });
        await this.nerdctl(['pull', '--quiet', RUNTIME_RELEASES[this.architecture].image], signal, PULL_TIMEOUT_MS);
        signal.throwIfAborted();
        await this.guest(['sh', '-s'], signal, COMMAND_TIMEOUT_MS, this.containerScript(record, keys));
      }
      progress({ message: 'Checking the local connection service…', completedBytes: null, totalBytes: null });
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (await this.healthy(origin)) { signal.throwIfAborted(); return origin; }
        await delay(HEALTH_POLL_MS, undefined, { signal });
      }
      throw new Error('runtime_health_timeout');
    } catch (error) { await this.stopOwned().catch(() => undefined); throw error; }
  }
  private async ensureVolume(record: Installation, signal: AbortSignal): Promise<void> {
    const names = (await this.nerdctl(['volume', 'ls', '--format', '{{.Name}}'], signal)).trim().split('\n');
    if (!names.includes(DATA_VOLUME)) {
      await this.nerdctl(['volume', 'create', '--label', `io.fulcrum.owner=${record.owner}`,
        '--label', `io.fulcrum.keys=${record.keyDigest}`, DATA_VOLUME], signal);
      return;
    }
    const labels = JSON.parse(await this.nerdctl(['volume', 'inspect', '--format', '{{json .Labels}}', DATA_VOLUME], signal)) as Record<string, string> | null;
    if (labels?.['io.fulcrum.owner'] !== record.owner || labels['io.fulcrum.keys'] !== record.keyDigest) throw new Error('unowned_runtime_volume');
  }
  private containerScript(record: Installation, keys: RuntimeKeys): string {
    return `set -eu\numask 077\nfile=$(mktemp)\ntrap 'rm -f "$file"' EXIT\ncat >"$file" <<'FULCRUM_ENV'\nAP_ENCRYPTION_KEY=${keys.encryption}\nAP_JWT_SECRET=${keys.jwt}\nAP_DB_TYPE=PGLITE\nAP_REDIS_TYPE=MEMORY\nAP_FRONTEND_URL=http://127.0.0.1:${record.port}\nAP_CLOUD_AUTH_ENABLED=true\nAP_TELEMETRY_ENABLED=false\nAP_WORKER_CONCURRENCY=1\nAP_PIECES_SYNC_MODE=OFFICIAL_AUTO\nFULCRUM_ENV\nnerdctl --namespace ${CONTAINER_NAMESPACE} run -d --name ${CONTAINER_NAME} --restart=no --cpus=${VM_CPUS} --memory=${CONTAINER_MEMORY} --label io.fulcrum.owner=${record.owner} --label io.fulcrum.image=${RUNTIME_RELEASES[this.architecture].image} -p 127.0.0.1:${GUEST_PORT}:80 -v ${DATA_VOLUME}:/root/.activepieces --env-file "$file" ${RUNTIME_RELEASES[this.architecture].image}\n`;
  }
  async healthy(origin: string): Promise<boolean> {
    const record = await this.record(); if (!record || origin !== `http://127.0.0.1:${record.port}`) return false;
    try {
      const response = await this.request(`${origin}/api/v1/flags`, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) return false;
      if (!response.body) return false;
      let bytes = 0; const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_FLAGS_BYTES) return false;
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const body = JSON.parse(text) as unknown;
      const flags = Array.isArray(body) ? Object.fromEntries(body.map(flag => [flag.id, flag.value])) : body as Record<string, unknown>;
      return flags?.CURRENT_VERSION === ACTIVEPIECES_VERSION && flags.EDITION === 'ce' && flags.CLOUD_AUTH_ENABLED === true;
    } catch { return false; }
  }
  private async stopOwned(): Promise<void> {
    const record = await this.record();
    if (!record || !await exists(path.join(this.options.stateDirectory, VM_NAME))) return;
    if (await fileDigest(this.binary) !== record.binaryDigest) throw new Error('runtime_binary_changed');
    const signal = new AbortController().signal;
    const state = JSON.parse(await this.command(['list', '--json', VM_NAME], signal)) as { name?: string; status?: string };
    if (state.name !== VM_NAME) throw new Error('invalid_runtime_state');
    if (state.status === 'Stopped') return;
    if (state.status !== 'Running') throw new Error('runtime_stop_unavailable');
    await this.command(['stop', VM_NAME], signal);
  }
  async stop(): Promise<void> { await this.exclusive(() => this.stopOwned()); }
}
