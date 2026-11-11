import { readFile } from 'node:fs/promises';
import { atomicFile, StoreError, UUID, uuid } from './files.js';
export interface DeviceIdentity { deviceId: string; label: string; lastSeqByWorkspace: Record<string, number> }
export async function loadIdentity(file: string, label: string): Promise<DeviceIdentity> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as DeviceIdentity;
    if (!UUID.test(value.deviceId) || typeof value.label !== 'string' || !value.lastSeqByWorkspace || Object.values(value.lastSeqByWorkspace).some(seq => !Number.isInteger(seq) || seq < 0)) throw new Error('invalid identity');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new StoreError('DEVICE_IDENTITY_INVALID', 'Local device identity could not be verified');
    const value = { deviceId: uuid(), label, lastSeqByWorkspace: {} };
    await saveIdentity(file, value); return value;
  }
}
export async function saveIdentity(file: string, value: DeviceIdentity) { await atomicFile(file, JSON.stringify(value)); }
