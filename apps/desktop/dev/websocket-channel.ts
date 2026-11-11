import type { RpcChannel } from '../src/core-transport.js';
import type { AppliedChange } from '@fulcrum/domain';
const REQUEST_TIMEOUT_MS = 10_000;
export class DevelopmentWebSocketChannel implements RpcChannel {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(message: { method: string; params: AppliedChange }) => void>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.method) { for (const listener of this.listeners) { try { listener(message); } catch { continue; } } return; }
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.data?.code })); else pending.resolve(message.result);
      } catch { this.close(); }
    });
    socket.addEventListener('close', () => this.rejectPending());
    socket.addEventListener('error', () => this.close());
  }
  static async connect(url: string, token: string): Promise<DevelopmentWebSocketChannel> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') throw new Error('LOCAL_DEVELOPMENT_BRIDGE_REQUIRED');
    const socket = new WebSocket(url); const channel = new DevelopmentWebSocketChannel(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('CONNECT_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CONNECTION_FAILED')); }, { once: true });
      });
      await channel.request('authenticate', { secret: token }); return channel;
    } catch (error) { channel.close(); throw error; }
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CONNECTION_CLOSED'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('REQUEST_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
  listen(listener: (message: { method: string; params: AppliedChange }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private rejectPending() { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('CONNECTION_CLOSED')); } this.pending.clear(); this.listeners.clear(); }
  close() { this.socket.close(); this.rejectPending(); }
}
