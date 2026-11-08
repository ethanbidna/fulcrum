import type { AppliedChange, CommandEnvelope, CommandResult, QueryName, QueryArgs, QueryResults } from '@fulcrum/domain';
export interface CoreTransport {
  query<Q extends QueryName>(name: Q, args: QueryArgs[Q]): Promise<QueryResults[Q]>;
  execute(command: Omit<CommandEnvelope, 'actor'>): Promise<CommandResult>;
  subscribe(listener: (change: AppliedChange) => void): Promise<() => void>;
  close(): void;
}
export interface RpcChannel {
  request(method: string, params: unknown): Promise<unknown>;
  listen(listener: (message: { method: string; params: AppliedChange }) => void): () => void;
  close(): void;
}
// The shell channel authenticates natively; the webview never receives a Keychain secret.
export class ShellCoreTransport implements CoreTransport {
  constructor(private readonly channel: RpcChannel) {}
  async query<Q extends QueryName>(name: Q, args: QueryArgs[Q]): Promise<QueryResults[Q]> { return await this.channel.request('query', { name, args }) as QueryResults[Q]; }
  async execute(command: Omit<CommandEnvelope, 'actor'>): Promise<CommandResult> { return await this.channel.request('execute', command) as CommandResult; }
  async subscribe(listener: (change: AppliedChange) => void): Promise<() => void> {
    const stop = this.channel.listen(message => { if (message.method === 'AppliedChange') listener(message.params); });
    try { await this.channel.request('subscribe', {}); } catch (error) { stop(); throw error; }
    return stop;
  }
  close() { this.channel.close(); }
}
