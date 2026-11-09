import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCommandProxy } from './mcp-proxy.js';
import { SocketClient } from './socket-client.js';
import { KeychainSecretStore } from './secrets.js';
async function main() {
  const local = path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum');
  const client = await SocketClient.connect(path.join(local, 'core.sock'), await new KeychainSecretStore().getOrCreate());
  const stop = () => client.close(); process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdin.once('end', stop);
  serveStdio(() => createCommandProxy(client), { onerror: () => process.stderr.write('Fulcrum MCP protocol error\n') });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main().catch(() => { process.stderr.write('Fulcrum MCP unavailable: start the core and review MCP access configuration.\n'); process.exitCode = 1; });
