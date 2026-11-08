import { randomUUID } from 'node:crypto';
import { Domain } from '@fulcrum/domain';
import type { CommandEnvelope, AppliedChange, QueryName, QueryArgs } from '@fulcrum/domain';
import { FileWorkspaceStore, loadStoreValidators } from '@fulcrum/store';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CoreHost } from './host.js';

export interface WorkspaceOptions {
  workspaceDirectory: string; localDirectory: string; userEntityId: string;
  deviceLabel: string; create?: boolean; schemaDirectory?: URL;
}
function emptyState(workspaceId: string): WorkspaceStateDoc {
  return { v: 1, workspaceId, frontier: {}, state: { initiatives: [], categories: [], nodes: [], edges: [], groups: [], objectives: [], entities: [], sources: [], assertions: [], questions: [], rejections: [], devices: [], settings: {} } };
}
export async function openWorkspaceHost(options: WorkspaceOptions): Promise<CoreHost> {
  const schema = options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {};
  if (options.create) await FileWorkspaceStore.create(options.workspaceDirectory, new Date(), schema);
  const store = new FileWorkspaceStore({ localDirectory: options.localDirectory, deviceLabel: options.deviceLabel, ...schema });
  const opened = await store.open(options.workspaceDirectory);
  const listeners = new Set<(change: AppliedChange) => void>();
  let domain: Domain; let unsubscribe: (() => void) | undefined; let fingerprint = ''; let manifestFingerprint = ''; let unavailable = false; let closing = false;
  let knownEventIds = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('CORE_CLOSING'));
    const result = tail.then(operation); tail = result.catch(() => undefined); return result;
  };
  const reload = async () => {
    try {
      const read = await store.read(); const next = JSON.stringify(read.events.map(event => event.eventId));
      if (read.manifest.encryption || (read.manifest.minReaderVersion ?? 1) > 1) throw new Error('WORKSPACE_VERSION_UNSUPPORTED');
      const nextManifest = JSON.stringify(read.manifest);
      if (domain && next === fingerprint && nextManifest === manifestFingerprint && !unavailable) return;
      const previousDomain = domain;
      const validators = await loadStoreValidators(options.schemaDirectory);
      domain = new Domain(emptyState(read.manifest.workspaceId), read.events, {
        newId: randomUUID, now: () => new Date().toISOString(), deviceId: opened.deviceId, userEntityId: options.userEntityId,
        readOnly: opened.readOnly || read.manifest.schemaVersion > 1, commit: drafts => store.commit(drafts),
        validateState: value => validators.checkpoint(value) ? [] : validators.checkpoint.errors ?? [],
        validateEvent: value => validators.event(value) ? [] : validators.event.errors ?? [],
      });
      unsubscribe?.(); unsubscribe = domain.subscribe(change => {
        for (const listener of listeners) { try { listener(structuredClone(change)); } catch { continue; } }
      });
      fingerprint = next; manifestFingerprint = nextManifest; unavailable = false;
      const incoming = read.events.filter(event => !knownEventIds.has(event.eventId));
      knownEventIds = new Set(read.events.map(event => event.eventId));
      if (previousDomain) for (const event of incoming) for (const listener of listeners) {
        try { listener({ eventId: event.eventId, actor: event.actor, ops: structuredClone(event.ops), raisedQuestionIds: event.ops.filter(op => op.kind === 'question' && op.op === 'create').map(op => op.id) }); } catch { continue; }
      }
    } catch (error) { unavailable = true; throw error; }
  };
  let stopWatching: (() => void) | undefined;
  try {
    await reload();
    if (opened.registrationRequired && !opened.readOnly) {
      const result = await domain!.execute({ name: 'device.register', args: { record: { id: opened.deviceId, label: options.deviceLabel } }, actor: 'system' });
      if (!result.ok) throw new Error('DEVICE_REGISTRATION_FAILED');
      knownEventIds = new Set(domain!.history().map(event => event.eventId));
      fingerprint = JSON.stringify([...knownEventIds]);
    }
    store.setCheckpointProvider(async () => domain.getSnapshot());
    stopWatching = store.watch(() => { void enqueue(reload).catch(() => { unavailable = true; }); });
  } catch (error) { await store.close(); throw error; }
  const requireAvailable = async () => { await reload(); if (unavailable) throw new Error('WORKSPACE_UNAVAILABLE'); };
  let closePromise: Promise<void> | undefined;
  return {
    query: (name, args) => enqueue(async () => { await requireAvailable(); return domain.query(name as QueryName, args as QueryArgs[QueryName]); }),
    execute: command => enqueue(async () => {
      await requireAvailable();
      const result = await domain.execute({ ...(command as Omit<CommandEnvelope, 'actor'>), actor: 'user' });
      knownEventIds = new Set(domain.history().map(event => event.eventId));
      fingerprint = JSON.stringify([...knownEventIds]); return result;
    }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    ingestionActive: () => false,
    close: () => {
      closing = true; stopWatching?.();
      return closePromise ??= (async () => { await tail; unsubscribe?.(); await store.close(); listeners.clear(); })();
    },
  };
}
