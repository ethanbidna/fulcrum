import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { SocketClient } from './socket-client.js';
import { rpcFailure } from './rpc-errors.js';
import { MAX_FRAME_BYTES } from './server.js';
const AUTH_TIMEOUT_MS = 5000;
const MAX_PENDING = 16;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
interface BridgeOptions { mode: 'development'; socketPath: string; secret: string; origin: string }
export async function startDevBridge(options: BridgeOptions) {
  if (options.mode !== 'development' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(options.origin)) throw new Error('DEVELOPMENT_ORIGIN_REQUIRED');
  const token = randomBytes(32).toString('hex');
  const server = http.createServer((_request, response) => { response.writeHead(404); response.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  let hostHeader = '';
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.origin !== options.origin || request.headers.host !== hostHeader || request.url !== '/') { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    let client: SocketClient | undefined; let authenticated = false; let pending = 0; let sequence = Promise.resolve();
    const timer = setTimeout(() => ws.terminate(), AUTH_TIMEOUT_MS);
    const send = (message: unknown) => {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { ws.terminate(); return; }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    ws.on('error', () => ws.terminate()); ws.on('close', () => { clearTimeout(timer); client?.close(); });
    ws.on('message', (data, binary) => {
      if (binary || ++pending > MAX_PENDING) { ws.terminate(); return; }
      sequence = sequence.then(async () => {
        let id: string | number | null = null;
        try {
          const message = JSON.parse(data.toString());
          if (message?.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof message.id) || typeof message.method !== 'string') throw new Error('INVALID_REQUEST');
          id = message.id;
          let result: unknown;
          if (!authenticated) {
            const provided = Buffer.from(String(message.params?.secret ?? '')); const expected = Buffer.from(token);
            if (message.method !== 'authenticate' || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new Error('UNAUTHORIZED');
            client = await SocketClient.connect(options.socketPath, options.secret);
            if (ws.readyState !== ws.OPEN) { client.close(); return; }
            client.subscribe(send); authenticated = true; clearTimeout(timer); result = { authenticated: true };
          } else {
            if (!['administration', 'query', 'execute', 'subscribe', 'unsubscribe', 'health', 'planCommand', 'commandPlanStatus', 'cancelCommandPlan', 'applyCommandPlan'].includes(message.method)) throw new Error('INVALID_REQUEST');
            result = await client!.request(message.method, message.params ?? {});
          }
          send({ jsonrpc: '2.0', id, result });
        } catch (error) { send(rpcFailure(id, error)); if (!authenticated) ws.close(); }
      }).finally(() => { pending--; });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('BRIDGE_START_FAILED');
  hostHeader = `127.0.0.1:${address.port}`;
  return { url: `ws://${hostHeader}/`, token, close: async () => {
    for (const ws of sockets.clients) ws.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
