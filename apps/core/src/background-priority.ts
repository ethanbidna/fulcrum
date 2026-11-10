import { setPriority, constants } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const PRIORITY_TIMEOUT_MS = 5000;
const UNAVAILABLE = 'Local ingestion paused — background priority unavailable';
interface PriorityDriver { platform: string; reducePriority(): void; backgroundQoS(): Promise<unknown> }
const driver: PriorityDriver = {
  platform: process.platform,
  reducePriority: () => setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL),
  backgroundQoS: () => promisify(execFile)('/usr/sbin/taskpolicy', ['-b', '-p', String(process.pid)], { timeout: PRIORITY_TIMEOUT_MS }),
};
export async function prepareBackgroundProcess(priority: PriorityDriver = driver): Promise<string | null> {
  try {
    priority.reducePriority();
    if (priority.platform === 'darwin') await priority.backgroundQoS();
    return null;
  } catch { return UNAVAILABLE; }
}
