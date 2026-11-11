import { releaseSelfTest } from './release-self-test.js';
import { parseCoreArguments } from './launch-arguments.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { unlockConfiguredWorkspace } from './workspace-keys.js';
import { copyEncryptedWorkspace } from './workspace-copy-entry.js';
import { startCore } from './bootstrap.js';
const schemaDirectory = new URL('./schemas/v1/', import.meta.url);
const localDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum');
async function main() {
  const { recoverWorkspace, ...options } = parseCoreArguments(process.argv.slice(2));
  const encryption = options.create ? undefined : await unlockConfiguredWorkspace(options.workspaceDirectory, localDirectory, schemaDirectory, recoverWorkspace === true);
  const server = await startCore({ ...options, localDirectory, schemaDirectory,
    ...(encryption ? { encryption } : {}),
    onIndexProgress: progress => { process.stdout.write(`${JSON.stringify({type:'index-progress', ...progress})}\n`); },
  }).catch(error => { encryption?.close(); throw error; });
  const stop = () => { void server.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdout.write('READY\n');
}
export { startCore } from './bootstrap.js';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void (process.argv[2]==='--self-test'?releaseSelfTest(schemaDirectory):process.argv[2]==='--encrypt-copy'?copyEncryptedWorkspace(localDirectory,schemaDirectory):main()).catch(() => { process.stderr.write('Core startup failed\n'); process.exitCode = 1; });
}
