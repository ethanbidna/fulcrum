import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import { seedPortfolio } from './seed.js';
import { startCore } from '../src/bootstrap.js';
import { startDevBridge } from '../src/dev-bridge.js';
export async function startFixture(directory: string, schemaDirectory: URL, snapshot?: WorkspaceStateDoc) {
  const localDirectory = path.join(directory, 'local');
  await mkdir(localDirectory, { mode: 0o700 });
  const secret = randomBytes(32).toString('hex');
  const core = await startCore({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory,
    userEntityId: '08000000-0000-7000-8000-000000000002', deviceLabel: 'Synthetic browser review', create: true, schemaDirectory }, { getOrCreate: async () => secret });
  try {
    if (snapshot) await seedPortfolio(path.join(localDirectory, 'core.sock'), secret, snapshot);
    const bridge = await startDevBridge({ mode: 'development', socketPath: path.join(localDirectory, 'core.sock'), secret, origin: 'http://127.0.0.1:5173' });
    const sessionFile = path.join(localDirectory, 'dev-session.json');
    try { await writeFile(sessionFile, JSON.stringify({ url: bridge.url, token: bridge.token }), { mode: 0o600, flag: 'wx' }); }
    catch (error) { await bridge.close(); throw error; }
    return { sessionFile, close: async () => { await bridge.close(); await core.close(); } };
  } catch (error) { await core.close(); throw error; }
}
