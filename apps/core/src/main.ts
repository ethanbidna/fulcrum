import { lstat, readFile } from 'node:fs/promises';
import { validateMcpAccess } from './mcp-access.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { startCore } from './bootstrap.js';
async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => { const index = args.indexOf(name); if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error('MISSING_CONFIGURATION'); return args[index + 1]!; };
  const localDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum');
  let mcp;
  try {
    const file = path.join(localDirectory, 'mcp-access.json'); const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || entry.uid !== process.getuid?.()) throw new Error('PRIVATE_MCP_CONFIGURATION_REQUIRED');
    mcp = validateMcpAccess(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const server = await startCore({ ...(mcp ? { mcp } : {}), localDirectory: path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum'), workspaceDirectory: value('--workspace'), userEntityId: value('--user-entity'), deviceLabel: 'Local Mac', onIndexProgress: progress => { process.stdout.write(`${JSON.stringify({ type: 'index-progress', ...progress })}\n`); }, create: args.includes('--create'), schemaDirectory: new URL('./schemas/v1/', import.meta.url) });
  const stop = () => { void server.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdout.write('READY\n');
}
export { startCore } from './bootstrap.js';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch(() => { process.stderr.write('Core startup failed\n'); process.exitCode = 1; });
}
