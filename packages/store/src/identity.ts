import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, StoreError, UUID, uuid } from './files.js';
export interface DeviceIdentity { deviceId: string; label: string; lastSeqByWorkspace: Record<string, number> }
export async function loadIdentity(localDirectory: string, label: string): Promise<DeviceIdentity> {
  try {
    const value = JSON.parse(await readFile(path.join(localDirectory, 'device.json'), 'utf8')) as DeviceIdentity;
    if (!UUID.test(value.deviceId) || typeof value.label !== 'string' || !value.lastSeqByWorkspace || Object.values(value.lastSeqByWorkspace).some(seq => !Number.isInteger(seq) || seq < 0)) throw new Error('invalid identity');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new StoreError('DEVICE_IDENTITY_INVALID', 'Local device identity could not be verified');
    const value = { deviceId: uuid(), label, lastSeqByWorkspace: {} };
    await saveIdentity(localDirectory, value); return value;
  }
}
export async function saveIdentity(localDirectory: string, value: DeviceIdentity) { await atomicFile(path.join(localDirectory, 'device.json'), JSON.stringify(value)); }
