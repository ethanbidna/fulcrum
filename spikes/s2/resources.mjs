import { execFileSync } from 'node:child_process';
import os from 'node:os';

const KIB = 1024;
const MIB = KIB * KIB;
function read(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

export function parseProcesses(text, benchmarkPid = process.pid) {
  const processes = text.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) return null;
    return { pid: Number(match[1]), parent: Number(match[2]), cpu: Number(match[3]), rss: Number(match[4]) * KIB, name: match[5].split('/').at(-1) };
  }).filter(Boolean);
  const included = new Set(processes.filter(row => /^ollama(?:-runner)?$/.test(row.name) || row.pid === benchmarkPid).map(row => row.pid));
  let size;
  do {
    size = included.size;
    for (const row of processes) if (included.has(row.parent)) included.add(row.pid);
  } while (size !== included.size);
  const selected = processes.filter(row => included.has(row.pid));
  if (!selected.length) return { rssBytes: null, cpuPercent: null };
  return { rssBytes: selected.reduce((sum, row) => sum + row.rss, 0), cpuPercent: selected.reduce((sum, row) => sum + row.cpu, 0) };
}

export function parsePower(text) {
  const percentage = text.match(/(\d+)%;/);
  return { batteryPercent: percentage ? Number(percentage[1]) : null, onBattery: text.includes("'Battery Power'") };
}

export function sampleResources() {
  const processes = parseProcesses(read('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,comm=']));
  if (os.platform() !== 'darwin') return { ...processes, swapUsedBytes: null, batteryPercent: null, onBattery: null, thermalState: null };
  const swap = read('sysctl', ['-n', 'vm.swapusage']).match(/used\s*=\s*([\d.]+)M/);
  return {
    ...processes, swapUsedBytes: swap ? Number(swap[1]) * MIB : null,
    ...parsePower(read('pmset', ['-g', 'batt'])),
    // pmset does not expose ProcessInfo.thermalState; the native probe supplies it.
    thermalState: null,
  };
}

export function hardwareSummary() {
  return { platform: os.platform(), architecture: os.arch(), memoryBytes: os.totalmem(), logicalCpus: os.cpus().length, osRelease: os.release() };
}
