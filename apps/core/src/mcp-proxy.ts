import { createCommandServer } from '@fulcrum/mcp';
export interface McpChannel { request(method: string, params: unknown): Promise<unknown> }
export function createCommandProxy(channel: McpChannel) {
  return createCommandServer({ query: (name, args) => channel.request('mcp.query', { name, args }), execute: command => channel.request('mcp.execute', command) });
}
