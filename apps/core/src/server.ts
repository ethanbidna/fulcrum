import net from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { rpcFailure } from './rpc-errors.js';
import type { CoreHost } from './host.js';
export const MAX_FRAME_BYTES = 64 * 1024;
const MAX_PENDING_REQUESTS = 16;
const MAX_CLIENTS = 16;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const AUTH_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
interface ServerOptions { socketPath: string; secret: string; host: CoreHost; idleMs?: number; authTimeoutMs?: number }
type Request = { jsonrpc: '2.0'; id: string | number; method: string; params?: Record<string, unknown> };
function equalSecret(input: unknown, expected: string): boolean {
  if (typeof input !== 'string') return false;
  const a = Buffer.from(input); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function parseRequest(line: string): Request {
  const request = JSON.parse(line);
  if (!request || request.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id)
    || (typeof request.id === 'number' && !Number.isFinite(request.id)) || typeof request.method !== 'string'
    || (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))) throw new Error('INVALID_REQUEST');
  return request;
}
function validateCommand(params: Record<string, unknown>) {
  if (Object.hasOwn(params, 'actor')) throw new Error('ACTOR_IS_AUTHENTICATED');
  return params;
}
export async function startCoreServer(options: ServerOptions) {
  const { socketPath, secret, host } = options;
  if (secret.length < 32 || !path.isAbsolute(socketPath)) throw new Error('INVALID_SERVER_CONFIGURATION');
  const parent = await lstat(path.dirname(socketPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid?.()) throw new Error('PRIVATE_SOCKET_DIRECTORY_REQUIRED');
  const clients = new Set<net.Socket>(); const pending = new Set<Promise<void>>();
  let stopping = false; let closePromise: Promise<void> | undefined; let idleTimer: NodeJS.Timeout | undefined;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  if (!Number.isFinite(idleMs) || idleMs <= 0) throw new Error('INVALID_IDLE_TIMEOUT');
  const scheduleIdle = () => {
    clearTimeout(idleTimer);
    if (!stopping && !clients.size) idleTimer = setTimeout(() => { if (host.ingestionActive()) scheduleIdle(); else void close(); }, idleMs);
  };
  const server = net.createServer(client => {
    if (stopping || clients.size >= MAX_CLIENTS) { client.destroy(); return; }
    clients.add(client); clearTimeout(idleTimer);
    let authenticated = false; let subscribed = false; let buffer = ''; let queued = 0;
    const planningJobs = new Set<string>();
    let sequence: Promise<void> = Promise.resolve();
    const authTimer = setTimeout(() => client.destroy(), options.authTimeoutMs ?? AUTH_TIMEOUT_MS);
    const send = (message: unknown) => {
      const encoded = JSON.stringify(message);
      if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES || client.writableLength > MAX_RESPONSE_BYTES) { client.destroy(); return; }
      if (!client.destroyed) client.write(`${encoded}\n`);
    };
    const unsubscribe = host.subscribe(change => { if (authenticated && subscribed) send({ jsonrpc: '2.0', method: 'AppliedChange', params: change }); });
    client.setEncoding('utf8'); client.on('error', () => client.destroy());
    client.on('close', () => { for (const id of planningJobs) host.cancelCommandPlan?.(id); clearTimeout(authTimer); unsubscribe(); clients.delete(client); scheduleIdle(); });
    const respond = async (line: string) => {
      let id: Request['id'] | null = null;
      try {
        const request = parseRequest(line); id = request.id;
        const params = request.params ?? {}; let result: unknown;
        if (!authenticated) {
          if (request.method !== 'authenticate' || !equalSecret(params.secret, secret)) throw new Error('UNAUTHORIZED');
          authenticated = true; clearTimeout(authTimer); result = { authenticated: true };
        } else switch (request.method) {
          case 'administration': if (!host.administer) throw new Error('ADMINISTRATION_UNAVAILABLE'); result = await host.administer(String(params.name), params.args); break;
          case 'system.observe': if (!host.observeSystem) throw new Error('SYSTEM_SIGNALS_UNAVAILABLE'); host.observeSystem(params); result = {}; break;
          case 'background.configure': if (!host.configureBackground) throw new Error('BACKGROUND_UNAVAILABLE'); result = host.configureBackground(params); break;
          case 'shutdown': result={closing:true};setImmediate(()=>{void close();});break;
          case 'health': result = { ready: true }; break;
          case 'query': result = await host.query(String(params.name), params.args); break;
          case 'execute': result = await host.execute(validateCommand(params)); break;
          case 'planCommand': if (!host.planCommand) throw new Error('COMMAND_PLANNER_UNAVAILABLE'); result = await host.planCommand(params); if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') planningJobs.add(result.id); break;
          case 'commandPlanStatus': if (!host.commandPlanStatus) throw new Error('COMMAND_PLANNER_UNAVAILABLE'); result = await host.commandPlanStatus(String(params.id)); break;
          case 'cancelCommandPlan': host.cancelCommandPlan?.(String(params.id)); result = {}; break;
          case 'applyCommandPlan': if (!host.applyCommandPlan) throw new Error('COMMAND_PLANNER_UNAVAILABLE'); result = await host.applyCommandPlan(String(params.id)); break;
          case 'mcp.query': if (!host.mcpQuery) throw new Error('MCP_DISABLED'); result = await host.mcpQuery(String(params.name), params.args); break;
          case 'mcp.execute': if (!host.mcpExecute) throw new Error('MCP_DISABLED'); result = await host.mcpExecute(validateCommand(params)); break;
          case 'subscribe': subscribed = true; result = {}; break;
          case 'unsubscribe': subscribed = false; result = {}; break;
          default: throw new Error('METHOD_NOT_FOUND');
        }
        send({ jsonrpc: '2.0', id, result });
      } catch (error) {
        send(rpcFailure(id, error));
        if (!authenticated) client.end();
      }
    };
    client.on('data', chunk => {
      if (stopping) return;
      buffer += chunk;
      while (buffer.includes('\n')) {
        const boundary = buffer.indexOf('\n'); const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES || ++queued > MAX_PENDING_REQUESTS) { client.destroy(); return; }
        const operation = sequence.then(() => respond(line)).finally(() => { queued--; pending.delete(operation); });
        sequence = operation; pending.add(operation);
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) client.destroy();
    });
  });
  const close = () => closePromise ??= (async () => {
    stopping = true; clearTimeout(idleTimer);
    await Promise.allSettled([...pending]);
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try { await host.close(); } finally { await unlink(socketPath).catch(() => undefined); }
  })();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
  } catch (error) { for (const client of clients) client.destroy(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
  server.on('error', () => { void close(); }); scheduleIdle();
  return { socketPath, close };
}
