import path from 'node:path';
import { prepareBackgroundProcess } from './background-priority.js';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { openWorkspaceHost } from './workspace.js';
import type { WorkspaceOptions } from './workspace.js';
import { KeychainSecretStore } from './secrets.js';
import type { SecretStore } from './secrets.js';
import { startCoreServer } from './server.js';
export async function startCore(options: WorkspaceOptions & { idleMs?: number }, secrets: SecretStore = new KeychainSecretStore()) {
  if (!path.isAbsolute(options.localDirectory) || !path.isAbsolute(options.workspaceDirectory)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.userEntityId)) throw new Error('INVALID_CONFIGURATION');
  try {
    const local = await lstat(options.localDirectory);
    if (local.isSymbolicLink() || !local.isDirectory() || local.uid !== process.getuid?.()) throw new Error('LOCAL_DIRECTORY_UNSAFE');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let backgroundUnavailableReason = options.backgroundUnavailableReason;
  if (options.ingestion) {
    backgroundUnavailableReason ??= await prepareBackgroundProcess() ?? undefined;
  }
  const host = await openWorkspaceHost({ ...options, ...(backgroundUnavailableReason ? { backgroundUnavailableReason } : {}) });
  try {
    await chmod(options.localDirectory, 0o700);
    const secret = await secrets.getOrCreate();
    const socketPath = path.join(options.localDirectory, 'core.sock');
    // The profile's exclusive store lock is held before removing a crash-left socket.
    try { const entry = await lstat(socketPath); if (!entry.isSocket() || entry.uid !== process.getuid?.()) throw new Error('SOCKET_PATH_UNSAFE'); await unlink(socketPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return await startCoreServer({ socketPath, secret, host, ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }) });
  } catch (error) { await host.close(); throw error; }
}
