// Reference reader for the portable workspace format (docs/WORKSPACE_FORMAT.md).
// Executable specification for tests, not production code: the real store driver
// lives in the core package and must pass the same scenarios.
import fs from 'node:fs';
import path from 'node:path';

const SEGMENT_EXTENSION = '.jsonl';

export function readWorkspace(workspaceDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'workspace.json'), 'utf8'));
  const { events, diagnostics } = readEventLogs(path.join(workspaceDir, 'log'));
  const checkpoints = readCheckpoints(path.join(workspaceDir, 'checkpoints'));
  return { manifest, events, checkpoints, diagnostics };
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}

// Reads every segment, including sync-client "conflicted copy" files, and dedupes by eventId.
function readEventLogs(logDir) {
  const byId = new Map();
  const diagnostics = [];
  for (const deviceId of listDirs(logDir)) {
    const deviceDir = path.join(logDir, deviceId);
    const segments = fs.readdirSync(deviceDir).filter(f => f.endsWith(SEGMENT_EXTENSION)).sort();
    for (const segment of segments) {
      const text = fs.readFileSync(path.join(deviceDir, segment), 'utf8');
      const { lines, tornTail } = splitCompleteLines(text);
      if (tornTail) diagnostics.push({ code: 'TORN_TAIL_IGNORED', file: `${deviceId}/${segment}` });
      for (const raw of lines) {
        const event = JSON.parse(raw);
        if (event.deviceId !== deviceId) {
          diagnostics.push({ code: 'EVENT_IN_WRONG_DEVICE_DIR', eventId: event.eventId });
          continue;
        }
        const existing = byId.get(event.eventId);
        if (!existing) { byId.set(event.eventId, { event, raw }); continue; }
        if (existing.raw !== raw) diagnostics.push({ code: 'EVENT_ID_COLLISION', eventId: event.eventId });
        else diagnostics.push({ code: 'DUPLICATE_EVENT_IGNORED', eventId: event.eventId, file: `${deviceId}/${segment}` });
      }
    }
  }
  return { events: [...byId.values()].map(v => v.event), diagnostics };
}

function splitCompleteLines(text) {
  const parts = text.split('\n');
  const tail = parts.pop();
  return { lines: parts.filter(l => l.trim() !== ''), tornTail: tail.trim() !== '' };
}

function readCheckpoints(checkpointDir) {
  const result = [];
  for (const deviceId of listDirs(checkpointDir)) {
    const dir = path.join(checkpointDir, deviceId);
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      result.push({ deviceId, file, body: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) });
    }
  }
  return result;
}
