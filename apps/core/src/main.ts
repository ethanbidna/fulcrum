import { parseCoreArguments } from './launch-arguments.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { startCore } from './bootstrap.js';
async function main() {
  const options=parseCoreArguments(process.argv.slice(2));
  const localDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'Fulcrum');
  const server = await startCore({...options,localDirectory,onIndexProgress:progress=>{process.stdout.write(`${JSON.stringify({type:'index-progress',...progress})}\n`);},schemaDirectory:new URL('./schemas/v1/',import.meta.url)});
  const stop = () => { void server.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop); process.stdout.write('READY\n');
}
export { startCore } from './bootstrap.js';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch(() => { process.stderr.write('Core startup failed\n'); process.exitCode = 1; });
}
