import net from 'node:net';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export class SocketClient {
  private nextId = 0;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<(message: unknown) => void>();
  private constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.receive(String(chunk)));
    socket.on('error', () => this.close()); socket.on('close', () => this.close());
  }
  static async connect(socketPath: string, secret?: string): Promise<SocketClient> {
    const socket = net.connect(socketPath); const client = new SocketClient(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('CONNECT_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.once('error', error => { clearTimeout(timer); reject(error); });
      });
      if (secret) await client.request('authenticate', { secret }); return client;
    } catch (error) { client.close(); throw error; }
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.socket.destroyed) return Promise.reject(new Error('CONNECTION_CLOSED'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('REQUEST_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  subscribe(listener: (message: unknown) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private receive(chunk: string) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const boundary = this.buffer.indexOf('\n'); const line = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 1);
      if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) { this.close(); return; }
      try {
        const message = JSON.parse(line);
        if (message.method) { for (const listener of this.listeners) { try { listener(message); } catch { continue; } } continue; }
        const entry = this.pending.get(message.id); if (!entry) continue;
        clearTimeout(entry.timer); this.pending.delete(message.id);
        if (message.error) entry.reject(Object.assign(new Error(message.error.message), { code: message.error.data?.code })); else entry.resolve(message.result);
      } catch { this.close(); return; }
    }
    if (Buffer.byteLength(this.buffer) > MAX_RESPONSE_BYTES) this.close();
  }
  close() {
    this.socket.destroy();
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CONNECTION_CLOSED')); }
    this.pending.clear(); this.listeners.clear();
  }
}
