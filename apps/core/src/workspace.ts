import { CommandPlanner, CommandJobs } from './command-planner.js';
import { OllamaJsonRuntime } from '@fulcrum/llm';
import type { JsonModelRuntime } from '@fulcrum/llm';
import { createMcpAccess, validateMcpAccess } from './mcp-access.js';
import type { McpAccess } from './mcp-access.js';
import { randomUUID } from 'node:crypto';
import { Domain } from '@fulcrum/domain';
import type { CommandEnvelope, AppliedChange, QueryName, QueryArgs } from '@fulcrum/domain';
import { SqliteReadIndex } from '@fulcrum/index';
import type { IndexProgress } from '@fulcrum/index';
import { FileWorkspaceStore, loadStoreValidators } from '@fulcrum/store';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CoreHost } from './host.js';

export interface WorkspaceOptions {
  workspaceDirectory: string; localDirectory: string; userEntityId: string;
  onIndexProgress?: (progress: IndexProgress) => void;
  commandRuntime?: JsonModelRuntime;
  mcp?: McpAccess;
  deviceLabel: string; create?: boolean; schemaDirectory?: URL;
}
function emptyState(workspaceId: string): WorkspaceStateDoc {
  return { v: 1, workspaceId, frontier: {}, state: { initiatives: [], categories: [], nodes: [], edges: [], groups: [], objectives: [], entities: [], sources: [], assertions: [], questions: [], rejections: [], devices: [], settings: {} } };
}
export async function openWorkspaceHost(options: WorkspaceOptions): Promise<CoreHost> {
  if (options.mcp) validateMcpAccess(options.mcp);
  const schema = options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {};
  if (options.create) await FileWorkspaceStore.create(options.workspaceDirectory, new Date(), schema);
  const store = new FileWorkspaceStore({ localDirectory: options.localDirectory, deviceLabel: options.deviceLabel, ...schema });
  const opened = await store.open(options.workspaceDirectory);
  const listeners = new Set<(change: AppliedChange) => void>();
  let index: SqliteReadIndex | undefined;
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
        readIndex: {
          search: async (text, scope) => {
            if (!index) throw new Error('INDEX_UNAVAILABLE');
            if (index.status().phase !== 'ready') await index.rebuild(domain.getSnapshot());
            return index.search(text, scope);
          },
          status: () => index?.status() ?? { phase: 'unavailable', completed: 0, total: 0 },
        },
        ...(options.mcp ? { mcp: options.mcp } : {}),
        readOnly: opened.readOnly || read.manifest.schemaVersion > 1, commit: drafts => store.commit(drafts),
        validateState: value => validators.checkpoint(value) ? [] : validators.checkpoint.errors ?? [],
        validateEvent: value => validators.event(value) ? [] : validators.event.errors ?? [],
      });
      unsubscribe?.(); unsubscribe = domain.subscribe(change => {
        for (const listener of listeners) { try { listener(structuredClone(change)); } catch { continue; } }
      });
      if (index) await index.rebuild(domain.getSnapshot()).catch(() => undefined);
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
    try {
      index = await SqliteReadIndex.open({ localDirectory: options.localDirectory, workspaceDirectory: options.workspaceDirectory,
        getSnapshot: () => domain.getSnapshot(), ...(options.onIndexProgress ? { onProgress: options.onIndexProgress } : {}) });
    } catch { index = undefined; }
    store.setCheckpointProvider(async () => domain.getSnapshot());
    stopWatching = store.watch(() => { void enqueue(reload).catch(() => { unavailable = true; }); });
  } catch (error) { await index?.close(); await store.close(); throw error; }
  const requireAvailable = async () => { await reload(); if (unavailable) throw new Error('WORKSPACE_UNAVAILABLE'); };
  let closePromise: Promise<void> | undefined;
  const executeCurrent = async (command: unknown, actor: 'user' | 'mcp') => {
      const result = await domain.execute({ ...(command as Omit<CommandEnvelope, 'actor'>), actor });
      if (result.ok && index) await index.apply({ eventId: result.eventId, ops: result.ops }).catch(() => undefined);
      knownEventIds = new Set(domain.history().map(event => event.eventId));
      fingerprint = JSON.stringify([...knownEventIds]); return result;
  };
  const executeAs = (command: unknown, actor: 'user' | 'mcp') => enqueue(async () => { await requireAvailable(); return executeCurrent(command, actor); });
  const planner = new CommandPlanner(() => domain, options.commandRuntime ?? new OllamaJsonRuntime());
  const jobs = new CommandJobs(planner);
  const query = (name: string, args: unknown) => enqueue(async () => { await requireAvailable(); return domain.query(name as QueryName, args as QueryArgs[QueryName]); });
  const mcp = createMcpAccess(options.mcp, { query, execute: command => executeAs(command, 'mcp') }, options.localDirectory);
  return {
    planCommand: request => enqueue(async () => { await requireAvailable(); return jobs.start(request); }),
    commandPlanStatus: id => jobs.status(id), cancelCommandPlan: id => jobs.cancel(id),
    applyCommandPlan: id => enqueue(async () => {
      await requireAvailable();
      let command;
      try { const previous = planner.result(id); if (previous) return previous; command = planner.approved(id); }
      catch { return { ok: false, error: { code: 'STALE_BASE', message: 'Your workspace changed or this plan expired. Review a fresh plan before applying.' } }; }
      const result = await executeCurrent(command, 'user'); planner.remember(id, result); return result;
    }),
    mcpQuery: mcp.query, mcpExecute: mcp.execute,
    query,
    execute: command => executeAs(command, 'user'),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    ingestionActive: () => false,
    close: () => {
      closing = true; jobs.close(); stopWatching?.();
      return closePromise ??= (async () => { await tail; unsubscribe?.(); try { await store.close(); } finally { await index?.close(); listeners.clear(); } })();
    },
  };
}
