import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LimaConnectorRuntime, validRuntimeKeys } from './lima.js';
import { ACTIVEPIECES_VERSION, LIMA_VERSION, RUNTIME_RELEASES, vmConfiguration } from './catalog.js';
import { downloadLima, runCommand, privateJson, writePrivateJson, type RunCommand } from './io.js';

const directories: string[] = [];
const keys = { encryption: 'a'.repeat(32), jwt: 'b'.repeat(64) };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fc-'));
  directories.push(directory);
  const stateDirectory = path.join(directory, 'state');
  const binaryDirectory = path.join(directory, `lima-${LIMA_VERSION}`, 'bin');
  await mkdir(binaryDirectory, { recursive: true }); await mkdir(stateDirectory, { mode: 0o700 });
  await writeFile(path.join(binaryDirectory, 'limactl'), 'synthetic-binary');
  const record = { v: 1, architecture: 'x64', port: 18089, owner: '01000000-0000-7000-8000-000000000001', keyDigest: digest(keys.encryption + keys.jwt), binaryDigest: digest('synthetic-binary') };
  await writePrivateJson(path.join(directory, 'installation.json'), record);
  const store = { read: vi.fn(async () => keys), write: vi.fn(async () => {}) };
  const run = vi.fn<RunCommand>(async () => '');
  const request = vi.fn<typeof fetch>(async () => Response.json({ CURRENT_VERSION: ACTIVEPIECES_VERSION, EDITION: 'ce', CLOUD_AUTH_ENABLED: true }));
  const runtime = new LimaConnectorRuntime({ directory, stateDirectory, keys: store, architecture: 'x64', run, request });
  return { directory, stateDirectory, record, store, run, request, runtime };
}

describe('owned connector runtime', () => {
  it.each(['x64', 'arm64'] as const)('pins %s artifacts and exposes only the connection port', architecture => {
    const config = JSON.parse(vmConfiguration(architecture, 18089));
    expect(config.mounts).toEqual([]);
    expect(config.images).toEqual([RUNTIME_RELEASES[architecture].guest]);
    expect(config.containerd.archives).toEqual([RUNTIME_RELEASES[architecture].containerd]);
    expect(config.portForwards).toEqual([
      { guestIP: '127.0.0.1', guestPort: 8080, hostIP: '127.0.0.1', hostPort: 18089 },
      { guestIP: '0.0.0.0', guestPortRange: [1, 65535], proto: 'any', ignore: true },
    ]);
    expect(config.ssh).toEqual({ loadDotSSHPubKeys: false, forwardAgent: false });
    expect(config.networkOpts.hostLoopback).toBe(false);
    expect(RUNTIME_RELEASES[architecture].image).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(() => vmConfiguration(architecture, 80)).toThrow();
  });
  it('starts without host mounts or secret process arguments and reuses its installation', async () => {
    const { runtime, run, directory } = await fixture();
    expect(await runtime.installed()).toBe(true);
    expect(await runtime.start(new AbortController().signal, () => {})).toBe('http://127.0.0.1:18089');
    const calls = run.mock.calls;
    expect(calls.some(([, args]) => args.includes('pull') && args.includes(RUNTIME_RELEASES.x64.image))).toBe(true);
    expect(JSON.stringify(calls.map(([binary, args, options]) => ({ binary, args, env: options.env })))).not.toContain(keys.jwt);
    const script = calls.find(([, , options]) => options.input)?.[2].input;
    expect(script).toContain('AP_ENCRYPTION_KEY=' + keys.encryption);
    expect(script).toContain('AP_TELEMETRY_ENABLED=false');
    expect(script).toContain('-p 127.0.0.1:8080:80');
    expect(script).toContain('trap');
    expect(await readFile(path.join(directory, 'installation.json'), 'utf8')).not.toContain(keys.encryption);
  });
  it('refuses missing keys without generating replacements or starting a VM', async () => {
    const { runtime, store, run } = await fixture();
    store.read.mockResolvedValueOnce(null as never);
    await expect(runtime.start(new AbortController().signal, () => {})).rejects.toThrow('runtime_keys_missing');
    expect(store.write).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('refuses mismatched keys and a modified executable', async () => {
    const { runtime, store, run, directory } = await fixture();
    store.read.mockResolvedValueOnce({ ...keys, jwt: 'c'.repeat(64) });
    await expect(runtime.start(new AbortController().signal, () => {})).rejects.toThrow('runtime_keys_mismatch');
    await writeFile(path.join(directory, `lima-${LIMA_VERSION}`, 'bin', 'limactl'), 'modified');
    await expect(runtime.start(new AbortController().signal, () => {})).rejects.toThrow('runtime_binary_changed');
    expect(run).not.toHaveBeenCalled();
  });
  it('does not adopt or overwrite an existing VM without its ownership record', async () => {
    const { runtime, directory, stateDirectory, store, run } = await fixture();
    await rm(path.join(directory, 'installation.json')); await mkdir(path.join(stateDirectory, 'v'));
    await expect(runtime.install(new AbortController().signal, () => {})).rejects.toThrow('unowned_runtime_instance');
    expect(store.read).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('refuses a foreign container and stops the VM after startup fails', async () => {
    const { runtime, run, stateDirectory } = await fixture();
    await mkdir(path.join(stateDirectory, 'v'));
    run.mockImplementation(async (_binary, args) => args.includes('ps') ? 'fulcrum-connections\n' : args.includes('inspect') ? '{}' : '');
    await expect(runtime.start(new AbortController().signal, () => {})).rejects.toThrow('unowned_runtime_container');
    expect(run.mock.calls.at(-1)?.[1]).toEqual(['--log-level=error', 'stop', 'v']);
    expect(run.mock.calls.some(([, args]) => args.includes('run') || args.includes('rm'))).toBe(false);
  });
  it('refuses a data volume without matching ownership and key labels', async () => {
    const { runtime, run, stateDirectory } = await fixture(); await mkdir(path.join(stateDirectory, 'v'));
    run.mockImplementation(async (_binary, args) => args.includes('volume') && args.includes('ls') ? 'fulcrum-data\n' : args.includes('inspect') ? '{}' : '');
    await expect(runtime.start(new AbortController().signal, () => {})).rejects.toThrow('unowned_runtime_volume');
    expect(run.mock.calls.some(([, args]) => args.includes('pull'))).toBe(false);
  });
  it('stops the owned VM when startup is cancelled', async () => {
    const { runtime, run, stateDirectory } = await fixture(); await mkdir(path.join(stateDirectory, 'v'));
    const controller = new AbortController();
    run.mockImplementation(async (_binary, args) => { if (args.includes('pull')) controller.abort(); return ''; });
    await expect(runtime.start(controller.signal, () => {})).rejects.toThrow();
    expect(run.mock.calls.at(-1)?.[1]).toContain('stop');
  });
  it('does not report ready if cancellation arrives during the health request', async () => {
    const { runtime, request, run, stateDirectory } = await fixture(); await mkdir(path.join(stateDirectory, 'v'));
    const controller = new AbortController();
    request.mockImplementationOnce(async () => { controller.abort(); return Response.json({ CURRENT_VERSION: ACTIVEPIECES_VERSION, EDITION: 'ce', CLOUD_AUTH_ENABLED: true }); });
    await expect(runtime.start(controller.signal, () => {})).rejects.toThrow();
    expect(run.mock.calls.at(-1)?.[1]).toContain('stop');
  });
  it('checks exact version, edition, cloud auth, origin and response bounds', async () => {
    const { runtime, request } = await fixture();
    expect(await runtime.healthy('http://127.0.0.1:18090')).toBe(false); expect(request).not.toHaveBeenCalled();
    for (const flags of [{ CURRENT_VERSION: 'other', EDITION: 'ce', CLOUD_AUTH_ENABLED: true }, {}, { CURRENT_VERSION: ACTIVEPIECES_VERSION, EDITION: 'ee', CLOUD_AUTH_ENABLED: true }]) {
      request.mockResolvedValueOnce(Response.json(flags)); expect(await runtime.healthy('http://127.0.0.1:18089')).toBe(false);
    }
    request.mockResolvedValueOnce(new Response('x'.repeat(129 * 1024))); expect(await runtime.healthy('http://127.0.0.1:18089')).toBe(false);
    expect(await runtime.healthy('http://127.0.0.1:18089')).toBe(true);
  });
  it('validates exact key sizes and rejects extra fields', () => {
    expect(validRuntimeKeys(keys)).toBe(true);
    for (const value of [null, {}, { ...keys, jwt: 'short' }, { ...keys, extra: true }]) expect(validRuntimeKeys(value)).toBe(false);
  });
});

describe('private runtime files and downloads', () => {
  it('writes private records atomically and refuses symlink targets', async () => {
    const { directory } = await fixture(); const file = path.join(directory, 'record.json');
    await writePrivateJson(file, { v: 1 }); expect(await privateJson(file)).toEqual({ v: 1 });
    await writePrivateJson(file, { v: 2 }); expect(await privateJson(file)).toEqual({ v: 2 });
    const link = path.join(directory, 'link'); await symlink(file, link);
    await expect(writePrivateJson(link, {})).rejects.toThrow('unsafe_runtime_record');
    expect(await privateJson(file)).toEqual({ v: 2 });
  });
  it('verifies download size and digest and rejects redirects to other hosts', async () => {
    const { directory } = await fixture(); const release = { url: 'https://github.com/fixture', bytes: 4, digest: digest('test') };
    await downloadLima(path.join(directory, 'valid'), release, new AbortController().signal, () => {}, vi.fn(async () => new Response('test')));
    await expect(downloadLima(path.join(directory, 'invalid'), release, new AbortController().signal, () => {}, vi.fn(async () => new Response('evil')))).rejects.toThrow('runtime_download_digest');
    const request = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/payload' } }));
    await expect(downloadLima(path.join(directory, 'redirect'), release, new AbortController().signal, () => {}, request)).rejects.toThrow('untrusted_runtime_download');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('runtime subprocess bounds', () => {
  it('waits for cancellation cleanup and returns a sanitized error', async () => {
    const controller = new AbortController();
    const running = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(running).rejects.toThrow(/^runtime_command_failed$/);
  });
  it('bounds subprocess output without exposing it in errors', async () => {
    await expect(runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)"],
      { signal: new AbortController().signal, timeoutMs: 10_000 })).rejects.toThrow(/^runtime_command_failed$/);
  });
});
