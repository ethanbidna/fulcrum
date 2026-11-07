import fs from 'node:fs';
import path from 'node:path';
import { append, atomicJson, checkpoint, nextHlc, readJson, requireComplete, uuid, validate } from './store.mjs';
import { compareEvents } from '../../tools/reference/fold.mjs';

const MOSCOW = ['must_do', 'should_do', 'could_do', 'wont_do'];
export class Domain {
  constructor(directory, localDirectory, fault = () => {}) {
    this.directory = directory;
    this.localFile = path.join(localDirectory, 'device.json');
    this.fault = fault;
  }
  identity() {
    return readJson(this.localFile);
  }
  register(label) {
    if (!label?.trim()) throw new Error('A synthetic device label is required');
    const snapshot = this.writableSnapshot();
    let identity = fs.existsSync(this.localFile) ? this.identity() : { deviceId: uuid(), workspaces: {} };
    const workspaceId = snapshot.manifest.workspaceId;
    const lastWritten = identity.workspaces[workspaceId] ?? 0;
    const observed = Math.max(0, ...snapshot.events.filter(event => event.deviceId === identity.deviceId).map(event => event.seq));
    const cloned = observed > lastWritten;
    if (cloned) identity = { deviceId: uuid(), workspaces: {} };
    atomicJson(this.localFile, identity);
    if (!snapshot.state.devices.some(device => device.id === identity.deviceId)) this.execute('device.register', { label });
    return { ...this.identity(), cloned };
  }
  writableSnapshot() {
    const snapshot = requireComplete(this.directory);
    if (snapshot.manifest.schemaVersion !== 1 || (snapshot.manifest.minReaderVersion ?? 1) > 1) throw new Error('Unsupported workspace version');
    return snapshot;
  }
  checkpoint() {
    const snapshot = this.writableSnapshot();
    this.assertWriter(snapshot, this.identity());
    return checkpoint(this.directory, this.identity().deviceId);
  }
  assertWriter(snapshot, identity) {
    const observed = Math.max(0, ...snapshot.events.filter(event => event.deviceId === identity.deviceId).map(event => event.seq));
    const lastWritten = identity.workspaces[snapshot.manifest.workspaceId] ?? 0;
    if (observed > lastWritten) throw new Error('Clone detected; run device to register a new identity');
    if (observed < lastWritten) throw new Error('Local acknowledged events missing; wait for download');
    return observed;
  }
  execute(name, args = {}) {
    const snapshot = this.writableSnapshot();
    const identity = this.identity();
    const workspaceId = snapshot.manifest.workspaceId;
    const observed = this.assertWriter(snapshot, identity);
    const event = { v: 1, eventId: uuid(), deviceId: identity.deviceId, seq: observed + 1,
      hlc: nextHlc(snapshot.events), at: new Date().toISOString(), actor: 'user', command: { name, args }, ops: [] };
    event.ops = this.operations(name, args, event, snapshot);
    append(this.directory, event, this.fault);
    identity.workspaces[workspaceId] = event.seq;
    atomicJson(this.localFile, identity);
    return event;
  }
  operations(name, args, event, snapshot) {
    if (name === 'device.register') return [{ op: 'create', kind: 'device', id: event.deviceId, record: { id: event.deviceId, label: args.label } }];
    if (name === 'initiative.create') {
      const record = { id: uuid(), title: 'Synthetic S1 initiative', lifecycle: 'active', moscow: 'should_do', categoryIds: [], protectedFields: ['moscow'], createdAt: event.at, updatedAt: event.at };
      validate('initiative', record);
      return [{ op: 'create', kind: 'initiative', id: record.id, record }];
    }
    if (name !== 'initiative.setMoscow') throw new Error('Unsupported spike command');
    const initiative = snapshot.state.initiatives.find(item => item.id === args.id);
    if (!initiative) throw new Error('Unknown initiative');
    const previous = [...snapshot.events].sort(compareEvents).filter(item => item.ops.some(op => op.kind === 'initiative' && op.id === args.id && (op.op === 'create' || op.field === 'moscow'))).at(-1);
    const value = MOSCOW[(MOSCOW.indexOf(initiative.moscow) + 1) % MOSCOW.length];
    return [{ op: 'set', kind: 'initiative', id: args.id, field: 'moscow', value, baseEventId: previous?.eventId ?? null }];
  }
}

export function withLocalLock(directory, action) {
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, 'writer.lock');
  const descriptor = fs.openSync(lock, 'wx');
  try { return action(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
