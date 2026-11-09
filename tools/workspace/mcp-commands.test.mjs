import { expect, test } from 'vitest';
import { mkdtemp, rm, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { CONVERSATIONAL_COMMANDS } from '../../packages/mcp/src/index.ts';
import { createCommandProxy } from '../../apps/core/src/mcp-proxy.ts';
import { openWorkspaceHost } from '../../apps/core/src/workspace.ts';
import { startCoreServer } from '../../apps/core/src/server.ts';
import { SocketClient } from '../../apps/core/src/socket-client.ts';
import { createMcpAccess, validateMcpAccess } from '../../apps/core/src/mcp-access.ts';
const INITIATIVE = '01000000-0000-7000-8000-000000000901';
const NODE = '02000000-0000-7000-8000-000000000901';
const ENABLED = { enabled: true, readOnly: false, sharingAcknowledged: true };
function pair() {
  const a = { start: async () => {}, close: async () => {}, send: async message => { queueMicrotask(() => b.onmessage?.(structuredClone(message))); } };
  const b = { start: async () => {}, close: async () => {}, send: async message => { queueMicrotask(() => a.onmessage?.(structuredClone(message))); } };
  return [a, b];
}
const payload = result => JSON.parse(result.content[0].text);
async function fixture(run, mcp = ENABLED) {
  const directory = await mkdtemp('/tmp/fmcp-'); let host; let server; let socket; let client; let protocol;
  try {
    const localDirectory = path.join(directory, 'local');
    host = await openWorkspaceHost({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory, userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true, ...(mcp ? { mcp } : {}) });
    await host.execute({ name: 'initiative.create', args: { record: { id: INITIATIVE, title: 'Synthetic planning' } } });
    await chmod(localDirectory, 0o700);
    server = await startCoreServer({ socketPath: path.join(localDirectory, 'core.sock'), host, secret: 'synthetic-mcp-secret-000000000000000000000' });
    socket = await SocketClient.connect(server.socketPath, 'synthetic-mcp-secret-000000000000000000000');
    protocol = createCommandProxy(socket);
    client = new Client({ name: 'synthetic-test', version: '1' }); const [a,b] = pair(); await protocol.connect(a); await client.connect(b);
    await run({ client, host, socket, localDirectory });
  } finally { await client?.close(); await protocol?.close(); socket?.close(); if (server) await server.close(); else await host?.close(); await rm(directory, { recursive: true, force: true }); }
}
const call = (client, name, args, key = name) => client.callTool({ name, arguments: { args, idempotencyKey: `synthetic:${key}` } });
test('every current manual domain action has a conversational tool', async () => {
  const files = ['flow-canvas.tsx', 'flow-model.ts', 'inspector.tsx', 'new-initiative.tsx', 'portfolio-model.ts'];
  for (const file of files) {
    const source = await readFile(new URL(`../../apps/desktop/src/ui/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/name: ['"]([\w.]+)['"]/g)) expect(CONVERSATIONAL_COMMANDS).toContain(match[1]);
  }
});
test('MCP protocol creates, reads, edits and undoes through the authenticated core', async () => fixture(async ({ client, host, socket, localDirectory }) => {
  const tools = await client.listTools(); expect(tools.tools.map(tool => tool.name)).toContain('node_create');
  const created = payload(await call(client, 'node_create', { record: { id: NODE, initiativeId: INITIATIVE, type: 'task', state: 'open', title: 'Draft synthetic brief' } })); expect(created.ok, JSON.stringify(created)).toBe(true);
  expect(payload(await call(client, 'node_create', { record: { id: NODE, initiativeId: INITIATIVE, type: 'task', state: 'open', title: 'Draft synthetic brief' } }))).toEqual(created);
  const updated = payload(await call(client, 'node_update', { id: NODE, patch: { title: 'Review synthetic brief' } })); expect(updated.ok).toBe(true);
  expect(await host.query('node.get', { id: NODE })).toMatchObject({ title: 'Review synthetic brief' });
  const graph = payload(await client.callTool({ name: 'read_workspace', arguments: { query: 'graph.get', args: { initiativeId: INITIATIVE } } })); expect(graph.nodes).toContainEqual(expect.objectContaining({ id: NODE }));
  expect(payload(await call(client, 'change_undo', { eventId: updated.eventId })).ok).toBe(true);
  expect(await host.query('node.get', { id: NODE })).toMatchObject({ title: 'Draft synthetic brief' });
  expect((await host.query('history.list', { target: { kind: 'node', id: NODE } })).every(event => event.actor === 'mcp')).toBe(true);
  await expect(socket.request('mcp.execute', { name: 'node.delete', args: { id: NODE }, actor: 'user', idempotencyKey: 'spoof' })).rejects.toThrow();
  const log = await readFile(path.join(localDirectory, 'mcp-access.log'), 'utf8'); expect(log).toContain('node.create'); expect(log).not.toContain('Draft synthetic brief');
}));
test('disabled and read-only MCP cannot write', async () => {
  for (const mcp of [undefined, { ...ENABLED, readOnly: true }]) await fixture(async ({ client, host }) => {
    expect((await call(client, 'node_create', { record: { id: NODE, initiativeId: INITIATIVE, type: 'task', state: 'open', title: 'Denied synthetic write' } })).isError).toBe(true);
    expect((await host.query('graph.get', { initiativeId: INITIATIVE })).nodes).toHaveLength(0);
  }, mcp ?? null);
});
test('access config requires disclosure acknowledgement; tools cannot widen permissions or obtain source excerpts', async () => {
  expect(() => validateMcpAccess({ enabled: true, readOnly: false, sharingAcknowledged: false })).toThrow();
  expect(() => validateMcpAccess({ ...ENABLED, sourceExcerpts: true })).toThrow();
  const directory = await mkdtemp('/tmp/fmcp-'); const calls = [];
  try {
    const access = createMcpAccess(ENABLED, { query: async (name,args) => { calls.push([name,args]); return []; }, execute: async value => value }, directory);
    await access.query('search', { text: 'synthetic', scope: { includeExcerpts: true } }); expect(calls[0][1].scope.includeExcerpts).toBe(false);
    await expect(access.execute({ name: 'settings.setDefaultCachePolicy', args: {}, idempotencyKey: 'synthetic' })).rejects.toThrow();
    await expect(access.query('context.forTarget', {})).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('MCP generates graph structure without assigning Tasks or completing parents', async () => fixture(async ({ client, host }) => {
  const child = '02000000-0000-7000-8000-000000000902'; const edge = '03000000-0000-7000-8000-000000000901';
  for (const [id,title] of [[NODE,'Synthetic parent'],[child,'Synthetic child']]) expect(payload(await call(client, 'node_create', { record: { id, initiativeId: INITIATIVE, type: 'task', state: 'open', title } }, id)).ok).toBe(true);
  expect(payload(await call(client, 'edge_create', { record: { id: edge, initiativeId: INITIATIVE, fromId: NODE, toId: child, type: 'contains' } })).ok).toBe(true);
  expect(payload(await call(client, 'node_setState', { id: child, state: 'done' })).ok).toBe(true);
  const focus = await host.query('graph.focus', { nodeId: NODE }); expect(focus.nodes.map(node => node.id)).toContain(child);
  expect(await host.query('node.get', { id: NODE })).toMatchObject({ state: 'open' });
  const invalid = await call(client, 'node_create', { record: { initiativeId: INITIATIVE, type: 'task', state: 'open', title: 'Synthetic assigned Task', responsibleEntityId: '08000000-0000-7000-8000-000000000001' } }, 'invalid-owner');
  expect(invalid.isError).toBe(true); expect((await host.query('graph.get', { initiativeId: INITIATIVE })).nodes).toHaveLength(2);
}));
