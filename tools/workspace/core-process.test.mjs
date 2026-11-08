import { expect, test } from 'vitest';
import { mkdtemp, rm, stat, access } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { startCoreServer } from '../../apps/core/src/server.ts';
import { SocketClient } from '../../apps/core/src/socket-client.ts';
import { openWorkspaceHost } from '../../apps/core/src/workspace.ts';
const SECRET = 'synthetic-local-client-secret-000000000000';
async function fixture(run, options = {}) {
  const directory = await mkdtemp('/tmp/fc6-'); let server;
  const listeners = new Set(); let writes = 0; let closed = false;
  const host = { query: async () => ({ synthetic: true }), execute: async command => {
    writes++; const event = { eventId: 'synthetic', actor: 'user', ops: [], raisedQuestionIds: [] };
    listeners.forEach(listener => listener(event)); return { ok: true, command };
  }, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, close: async () => { closed = true; }, ingestionActive: () => false };
  try {
    server = await startCoreServer({ socketPath: path.join(directory, 'core.sock'), secret: SECRET, host, idleMs: 1000, ...options });
    await run({ server, directory, host, writes: () => writes, closed: () => closed });
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }); }
}
test('socket is private; unauthenticated requests fail and do not write', async () => fixture(async f => {
  expect((await stat(f.server.socketPath)).mode & 0o777).toBe(0o600);
  const client = await SocketClient.connect(f.server.socketPath);
  await expect(client.request('query', { name: 'portfolio.list', args: {} })).rejects.toThrow();
  expect(f.writes()).toBe(0); client.close();
}));
test('authenticated clients query and execute through the same host', async () => fixture(async f => {
  const client = await SocketClient.connect(f.server.socketPath, SECRET);
  expect(await client.request('query', { name: 'portfolio.list', args: {} })).toEqual({ synthetic: true });
  expect(await client.request('execute', { name: 'initiative.create', args: { record: { title: 'Synthetic initiative' } } })).toMatchObject({ ok: true });
  await expect(client.request('execute', { name: 'node.delete', args: {}, actor: 'system' })).rejects.toThrow();
  expect(f.writes()).toBe(1); client.close();
}));
test('AppliedChange subscriptions reach every subscribed client once', async () => fixture(async f => {
  const first = await SocketClient.connect(f.server.socketPath, SECRET);
  const second = await SocketClient.connect(f.server.socketPath, SECRET);
  const notified = new Promise(resolve => second.subscribe(resolve));
  await second.request('subscribe', {});
  await first.request('execute', { name: 'node.setState', args: { id: 'synthetic', state: 'done' } });
  expect(await notified).toMatchObject({ method: 'AppliedChange' }); first.close(); second.close();
}));
test('oversized and malformed socket frames cannot execute a command', async () => fixture(async f => {
  const socket = connect(f.server.socketPath); socket.on('error', () => {});
  await new Promise(resolve => socket.once('connect', resolve));
  const ended = new Promise(resolve => socket.once('close', resolve));
  socket.write('x'.repeat(70 * 1024)); await ended; expect(f.writes()).toBe(0);
}));
test('idle core shuts down and removes its socket', async () => fixture(async f => {
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(f.closed()).toBe(true); await expect(access(f.server.socketPath)).rejects.toThrow();
}, { idleMs: 30 }));
test('real workspace host persists command state and holds the single-instance lock', async () => {
  const directory = await mkdtemp('/tmp/fc6-'); const workspaceDirectory = path.join(directory, 'workspace'); const localDirectory = path.join(directory, 'local');
  const options = { workspaceDirectory, localDirectory, userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true };
  let host;
  try {
    host = await openWorkspaceHost(options);
    await expect(openWorkspaceHost({ ...options, create: false })).rejects.toThrow();
    expect(await host.execute({ name: 'initiative.create', args: { record: { id: '01000000-0000-7000-8000-000000000001', title: 'Synthetic local work' } } })).toMatchObject({ ok: true });
    await host.close(); host = await openWorkspaceHost({ ...options, create: false });
    expect(await host.query('portfolio.list', {})).toMatchObject([{ initiative: { title: 'Synthetic local work' } }]);
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('split JSON-RPC frames are decoded and coalesced requests stay ordered', async () => fixture(async f => {
  const socket = connect(f.server.socketPath); socket.setEncoding('utf8'); socket.on('error', () => {});
  await new Promise(resolve => socket.once('connect', resolve)); let buffer = ''; const replies = [];
  const received = new Promise(resolve => socket.on('data', chunk => { buffer += chunk; while (buffer.includes('\n')) { const end = buffer.indexOf('\n'); replies.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); if (replies.length === 2) resolve(); } }));
  const auth = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'authenticate', params: { secret: SECRET } });
  socket.write(auth.slice(0, 15)); socket.write(auth.slice(15) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'health' }) + '\n');
  await received; expect(replies.map(reply => reply.id)).toEqual([1, 2]); expect(replies[1].result).toEqual({ ready: true }); socket.destroy();
}));
test('wrong secrets and unauthenticated slow connections are closed', async () => fixture(async f => {
  await expect(SocketClient.connect(f.server.socketPath, 'wrong-secret')).rejects.toThrow();
  const socket = connect(f.server.socketPath); socket.on('error', () => {});
  await new Promise(resolve => socket.once('close', resolve)); expect(f.writes()).toBe(0);
}, { authTimeoutMs: 30 }));
test('socket publication refuses an existing regular file', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  await fixture(async f => {
    const existing = path.join(f.directory, 'protected'); await writeFile(existing, 'synthetic sentinel');
    await expect(startCoreServer({ socketPath: existing, secret: SECRET, host: f.host })).rejects.toThrow();
    expect(await readFile(existing, 'utf8')).toBe('synthetic sentinel');
  });
});
test('Keychain driver reuses, creates and fails closed without a file fallback', async () => {
  const { KeychainSecretStore } = await import('../../apps/core/src/secrets.ts');
  const existing = 'a'.repeat(64); const calls = [];
  const read = async (command, args) => { calls.push([command, args]); return { stdout: existing }; };
  expect(await new KeychainSecretStore(read, 'darwin').getOrCreate()).toBe(existing); expect(calls).toHaveLength(1);
  const createCalls = [];
  const create = async (_command, args) => { createCalls.push(args); if (args[0] === 'find-generic-password') throw Object.assign(new Error('synthetic absent'), { code: 44 }); return { stdout: '' }; };
  expect(await new KeychainSecretStore(create, 'darwin').getOrCreate()).toMatch(/^[a-f0-9]{64}$/); expect(createCalls[1][0]).toBe('add-generic-password');
  await expect(new KeychainSecretStore(async () => { throw new Error('synthetic denied'); }, 'darwin').getOrCreate()).rejects.toThrow('KEYCHAIN_UNAVAILABLE');
  await expect(new KeychainSecretStore(read, 'linux').getOrCreate()).rejects.toThrow('KEYCHAIN_UNAVAILABLE');
});
test('credential failure releases the real workspace lock', async () => {
  const { startCore } = await import('../../apps/core/src/bootstrap.ts'); const directory = await mkdtemp('/tmp/fc6-');
  const options = { workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true };
  try {
    await expect(startCore(options, { getOrCreate: async () => { throw new Error('synthetic denied'); } })).rejects.toThrow('synthetic denied');
    const host = await openWorkspaceHost({ ...options, create: false }); await host.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('browser bridge authenticates separately, checks Origin, and forwards notifications', async () => fixture(async f => {
  const { createRequire } = await import('node:module'); const require = createRequire(new URL('../../apps/core/package.json', import.meta.url)); const WebSocket = require('ws');
  const { startDevBridge } = await import('../../apps/core/src/dev-bridge.ts'); const origin = 'http://127.0.0.1:5173';
  const bridge = await startDevBridge({ mode: 'development', socketPath: f.server.socketPath, secret: SECRET, origin });
  const clients = [];
  const opened = async incomingOrigin => { const ws = new WebSocket(bridge.url, { origin: incomingOrigin }); clients.push(ws); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return ws; };
  try {
    await expect(opened('https://untrusted.invalid')).rejects.toThrow();
    const ws = await opened(origin); const messages = []; const waiters = [];
    ws.on('message', data => { const message = JSON.parse(data.toString()); messages.push(message); waiters.splice(0).forEach(resolve => resolve()); });
    const waitFor = async predicate => { while (!messages.some(predicate)) await new Promise(resolve => waiters.push(resolve)); return messages.find(predicate); };
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'authenticate', params: { secret: bridge.token } }));
    expect((await waitFor(message => message.id === 1)).result.authenticated).toBe(true);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'subscribe' })); await waitFor(message => message.id === 2);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'execute', params: { name: 'node.setState', args: {} } }));
    expect(await waitFor(message => message.method === 'AppliedChange')).toHaveProperty('params.eventId', 'synthetic');
    expect(await waitFor(message => message.id === 3)).toHaveProperty('result.ok', true);
  } finally { clients.forEach(ws => ws.terminate()); await bridge.close(); }
}));
test('release build excludes the development bridge and includes canonical schemas', async () => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util'); const { readFile } = await import('node:fs/promises');
  await promisify(execFile)(process.execPath, ['apps/core/build.mjs']);
  const bundle = await readFile('apps/core/dist/core.mjs', 'utf8');
  expect(bundle).not.toContain('WebSocketServer'); expect(bundle).not.toContain('dev-session.json');
  expect(JSON.parse(await readFile('apps/core/dist/schemas/v1/workspace.schema.json', 'utf8')).title).toBe('workspace.json manifest');
});
test('UI CoreTransport works against the actual development bridge', async () => fixture(async f => {
  const { vi } = await import('vitest'); const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../apps/core/package.json', import.meta.url)); const WebSocket = require('ws');
  const origin = 'http://127.0.0.1:5173';
  const { startDevBridge } = await import('../../apps/core/src/dev-bridge.ts');
  const { DevelopmentWebSocketChannel } = await import('../../apps/desktop/dev/websocket-channel.ts');
  const { ShellCoreTransport } = await import('../../apps/desktop/src/core-transport.ts');
  const bridge = await startDevBridge({ mode: 'development', socketPath: f.server.socketPath, secret: SECRET, origin });
  vi.stubGlobal('WebSocket', class extends WebSocket { constructor(url) { super(url, { origin }); } });
  let transport;
  try {
    transport = new ShellCoreTransport(await DevelopmentWebSocketChannel.connect(bridge.url, bridge.token));
    expect(await transport.query('portfolio.list', {})).toEqual({ synthetic: true });
    const notified = new Promise(resolve => { void transport.subscribe(resolve); });
    await transport.execute({ name: 'node.setState', args: { id: 'synthetic', state: 'done' } });
    expect(await notified).toHaveProperty('eventId', 'synthetic');
  } finally { transport?.close(); vi.unstubAllGlobals(); await bridge.close(); }
}));
test('compiled core child process serves persisted commands and shuts down cleanly', async () => {
  const { spawn, execFile } = await import('node:child_process'); const { once } = await import('node:events');
  const { promisify } = await import('node:util'); const { writeFile } = await import('node:fs/promises');
  await promisify(execFile)(process.execPath, ['apps/core/build.mjs']);
  const directory = await mkdtemp('/tmp/fc6-'); let child; let client;
  const options = { workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true };
  try {
    const entry = new URL('../../apps/core/dist/core.mjs', import.meta.url).href;
    const bundle = path.join(directory, 'child.mjs');
    await writeFile(bundle, `import { startCore } from ${JSON.stringify(entry)}; const server = await startCore({ ...${JSON.stringify(options)}, schemaDirectory: new URL(${JSON.stringify(new URL('../../apps/core/dist/schemas/v1/', import.meta.url).href)}) }, { getOrCreate: async () => ${JSON.stringify(SECRET)} }); process.once('SIGTERM', () => { void server.close(); }); process.stdout.write('READY\\n');`);
    child = spawn(process.execPath, [bundle], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Synthetic child startup timeout: ' + stderr)), 5000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic child exited: ' + stderr)); }); });
    client = await SocketClient.connect(path.join(options.localDirectory, 'core.sock'), SECRET);
    expect(await client.request('execute', { name: 'initiative.create', args: { record: { id: '01000000-0000-7000-8000-000000000001', title: 'Synthetic process test' } } })).toMatchObject({ ok: true });
    expect(await client.request('query', { name: 'portfolio.list', args: {} })).toMatchObject([{ initiative: { title: 'Synthetic process test' } }]);
    client.close(); const exit = once(child, 'exit'); child.kill('SIGTERM'); expect((await exit)[0]).toBe(0);
    const host = await openWorkspaceHost({ ...options, create: false });
    try { expect(await host.query('portfolio.list', {})).toMatchObject([{ initiative: { title: 'Synthetic process test' } }]); } finally { await host.close(); }
  } finally { client?.close(); if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } await rm(directory, { recursive: true, force: true }); }
});
test('subscribing after startup does not replay the bootstrap registration as a new change', async () => {
  const directory = await mkdtemp('/tmp/fc6-');
  const { startCore } = await import('../../apps/core/src/bootstrap.ts'); let server; let client;
  try {
    server = await startCore({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true }, { getOrCreate: async () => SECRET });
    client = await SocketClient.connect(server.socketPath, SECRET); const changes = []; client.subscribe(message => changes.push(message));
    await client.request('subscribe', {});
    await client.request('execute', { name: 'initiative.create', args: { record: { id: '01000000-0000-7000-8000-000000000001', title: 'Synthetic notification test' } } });
    expect(changes.map(change => change.params.actor)).toEqual(['user']);
  } finally { client?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('external manifest changes fail closed before serving state', async () => {
  const { readFile, writeFile } = await import('node:fs/promises'); const directory = await mkdtemp('/tmp/fc6-'); let host;
  try {
    const workspaceDirectory = path.join(directory, 'workspace');
    host = await openWorkspaceHost({ workspaceDirectory, localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true });
    await host.query('portfolio.list', {});
    const file = path.join(workspaceDirectory, 'workspace.json'); const manifest = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...manifest, schemaVersion: 2, minReaderVersion: 2 }));
    await expect(host.query('portfolio.list', {})).rejects.toThrow();
    await writeFile(file, JSON.stringify(manifest)); expect(await host.query('portfolio.list', {})).toEqual([]);
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('bootstrap refuses a local profile inside the workspace without creating it', async () => {
  const { startCore } = await import('../../apps/core/src/bootstrap.ts'); const directory = await mkdtemp('/tmp/fc6-');
  const workspaceDirectory = path.join(directory, 'workspace'); const localDirectory = path.join(workspaceDirectory, 'local');
  try {
    await expect(startCore({ workspaceDirectory, localDirectory, userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true }, { getOrCreate: async () => SECRET })).rejects.toThrow();
    await expect(access(localDirectory)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
