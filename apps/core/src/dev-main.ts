import { writeFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startDevBridge } from './dev-bridge.js';
import { KeychainSecretStore } from './secrets.js';
async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error('CONFIGURATION_REQUIRED'); return args[index + 1]!; };
  const local = value('--local'); const origin = value('--origin');
  const entry = await lstat(local);
  if (!path.isAbsolute(local) || entry.isSymbolicLink() || !entry.isDirectory() || (entry.mode & 0o777) !== 0o700 || entry.uid !== process.getuid?.()) throw new Error('PRIVATE_LOCAL_DIRECTORY_REQUIRED');
  const bridge = await startDevBridge({ mode: 'development', socketPath: path.join(local, 'core.sock'), secret: await new KeychainSecretStore().getOrCreate(), origin });
  try { await writeFile(path.join(local, 'dev-session.json'), JSON.stringify({ url: bridge.url, token: bridge.token }), { mode: 0o600, flag: 'wx' }); }
  catch (error) { await bridge.close(); throw error; }
  const stop = () => { void bridge.close().finally(() => unlink(path.join(local, 'dev-session.json')).catch(() => undefined)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdout.write('DEVELOPMENT_BRIDGE_READY\n');
}
void main().catch(() => { process.stderr.write('Development bridge startup failed\n'); process.exitCode = 1; });
