import { fileURLToPath } from 'node:url';
import { parseOptions } from './server.mjs';

const args = process.argv.slice(2);
try {
  parseOptions(args);
  process.stdout.write(`${JSON.stringify({ mcpServers: { 'fulcrum-s6': {
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url)), ...args],
  } } }, null, 2)}\n`);
} catch { process.stderr.write('Use --excerpts and/or --initiative UUID only\n'); process.exitCode = 1; }
