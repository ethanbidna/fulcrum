import { BackgroundPolicy } from '@fulcrum/ingest';
import type { BackgroundSettings } from '@fulcrum/ingest';
import { openIngestion } from './ingestion.js';
import type { WorkspaceIngestion } from './ingestion.js';
import { CommandPlanner, CommandJobs } from './command-planner.js';
import { OllamaJsonRuntime } from '@fulcrum/llm';
import type { JsonModelRuntime } from '@fulcrum/llm';
import { createMcpAccess, validateMcpAccess } from './mcp-access.js';
import type { McpAccess } from './mcp-access.js';
import { randomUUID } from 'node:crypto';
import { Domain } from '@fulcrum/domain';
import type { CommandEnvelope, CommandResult, AppliedChange, QueryName, QueryArgs } from '@fulcrum/domain';
import { SqliteContextIndex, snapshotEpisodes } from '@fulcrum/context';
import { SqliteReadIndex } from '@fulcrum/index';
import type { IndexProgress } from '@fulcrum/index';
import { FileWorkspaceStore, loadStoreValidators, questionId } from '@fulcrum/store';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CoreHost } from './host.js';

export interface WorkspaceOptions {
  workspaceDirectory: string; localDirectory: string; userEntityId: string;
  onIndexProgress?: (progress: IndexProgress) => void;
  commandRuntime?: JsonModelRuntime;
  ingestion?: WorkspaceIngestion;
  background?: Partial<BackgroundSettings>;
  backgroundUnavailableReason?: string;
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
  const background = new BackgroundPolicy(options.background, options.backgroundUnavailableReason);
  const opened = await store.open(options.workspaceDirectory);
  const listeners = new Set<(change: AppliedChange) => void>();
  let index: SqliteReadIndex | undefined;
  let context: SqliteContextIndex | undefined;
  let domain: Domain; let unsubscribe: (() => void) | undefined; let fingerprint = ''; let manifestFingerprint = ''; let unavailable = false; let closing = false;
  let writable = !opened.readOnly;
  let knownEventIds = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('CORE_CLOSING'));
    const result = tail.then(operation); tail = result.catch(() => undefined); return result;
  };
  const maintainQuestions = async () => {
    const changes: Extract<CommandResult, { ok: true }>[] = [];
    if (!writable) return changes;
    for (const command of domain.questionMaintenance(questionId)) {
      const result = await domain.execute(command);
      if (!result.ok) throw new Error(`QUESTION_MAINTENANCE_FAILED:${result.error.code}`);
      changes.push(result);
    }
    return changes;
  };
  const reload = async () => {
    try {
      const read = await store.read(); const next = JSON.stringify(read.events.map(event => event.eventId));
      if (read.manifest.encryption || (read.manifest.minReaderVersion ?? 1) > 1) throw new Error('WORKSPACE_VERSION_UNSUPPORTED');
      const nextManifest = JSON.stringify(read.manifest);
      if (domain && next === fingerprint && nextManifest === manifestFingerprint && !unavailable) return;
      writable = !opened.readOnly && read.manifest.schemaVersion === 1;
      const previousDomain = domain;
      const validators = await loadStoreValidators(options.schemaDirectory);
      domain = new Domain(emptyState(read.manifest.workspaceId), read.events, {
        newId: randomUUID, questionId, now: () => new Date().toISOString(), deviceId: opened.deviceId, userEntityId: options.userEntityId,
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
      if (previousDomain && read.manifest.schemaVersion === 1) await maintainQuestions();
      if (index) await index.rebuild(domain.getSnapshot()).catch(() => undefined);
      await refreshContext();
      fingerprint = JSON.stringify(domain.history().map(event => event.eventId)); manifestFingerprint = nextManifest; unavailable = false;
      const incoming = read.events.filter(event => !knownEventIds.has(event.eventId));
      knownEventIds = new Set(domain.history().map(event => event.eventId));
      if (previousDomain) for (const event of incoming) for (const listener of listeners) {
        try { listener({ eventId: event.eventId, actor: event.actor, ops: structuredClone(event.ops), raisedQuestionIds: event.ops.filter(op => op.kind === 'question' && op.op === 'create').map(op => op.id) }); } catch { continue; }
      }
    } catch (error) { unavailable = true; throw error; }
  };
  const refreshContext = async () => {
    if (!context) return;
    try { await context.rebuild(snapshotEpisodes(domain.getSnapshot())); }
    catch { const unavailableContext = context; context = undefined; await unavailableContext.close().catch(() => undefined); }
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
    await maintainQuestions();
    knownEventIds = new Set(domain!.history().map(event => event.eventId));
    fingerprint = JSON.stringify([...knownEventIds]);
    try {
      index = await SqliteReadIndex.open({ localDirectory: options.localDirectory, workspaceDirectory: options.workspaceDirectory,
        getSnapshot: () => domain.getSnapshot(), ...(options.onIndexProgress ? { onProgress: options.onIndexProgress } : {}) });
    } catch { index = undefined; }
    try {
      context = await SqliteContextIndex.open({ localDirectory: options.localDirectory, workspaceDirectory: options.workspaceDirectory, workspaceId: domain!.getSnapshot().workspaceId });
      await refreshContext();
    } catch { await context?.close(); context = undefined; }
    store.setCheckpointProvider(async () => domain.getSnapshot());
    stopWatching = store.watch(() => { void enqueue(reload).catch(() => { unavailable = true; }); });
  } catch (error) { await context?.close(); await index?.close(); await store.close(); throw error; }
  const requireAvailable = async () => {
    await reload();
    if (unavailable) throw new Error('WORKSPACE_UNAVAILABLE');
    const changes = await maintainQuestions();
    if (!changes.length) return;
    if (index) for (const change of changes) await index.apply({ eventId: change.eventId, ops: change.ops }).catch(() => undefined);
    await refreshContext();
    knownEventIds = new Set(domain.history().map(event => event.eventId));
    fingerprint = JSON.stringify([...knownEventIds]);
  };
  let closePromise: Promise<void> | undefined;
  const executeCurrent = async (command: unknown, actor: 'user' | 'mcp') => {
      const result = await domain.execute({ ...(command as Omit<CommandEnvelope, 'actor'>), actor });
      if (result.ok) {
        const changes = [result, ...await maintainQuestions()];
        if (index) for (const change of changes) await index.apply({ eventId: change.eventId, ops: change.ops }).catch(() => undefined);
      }
      if (result.ok) await refreshContext();
      knownEventIds = new Set(domain.history().map(event => event.eventId));
      fingerprint = JSON.stringify([...knownEventIds]); return result;
  };
  const executeAs = (command: unknown, actor: 'user' | 'mcp') => enqueue(async () => { await requireAvailable(); return executeCurrent(command, actor); });
  const planner = new CommandPlanner(() => domain, options.commandRuntime ?? new OllamaJsonRuntime());
  const jobs = new CommandJobs(planner);
  let ingestion: Awaited<ReturnType<typeof openIngestion>> | undefined;
  try {
    if (options.ingestion) ingestion = await openIngestion({ configuration: options.ingestion, policy: background, localDirectory: options.localDirectory, workspaceDirectory: options.workspaceDirectory, deviceId: opened.deviceId, userEntityId: options.userEntityId, snapshot: () => domain.getSnapshot() });
  } catch (error) { stopWatching?.(); unsubscribe?.(); await context?.close(); await index?.close(); await store.close(); throw error; }
  const query = (name: string, args: unknown) => enqueue(async () => { await requireAvailable();
    if (name === 'status.background') {
      if (!args || typeof args !== 'object' || Object.keys(args).length) throw new Error('INVALID_BACKGROUND_QUERY');
      return background.status(Date.now());
    }
    if (name === 'status.freshness') {
      if (!args || typeof args !== 'object' || Object.keys(args).length) throw new Error('INVALID_FRESHNESS_QUERY');
      return ingestion?.scheduler.status() ?? { state: 'disabled', pending: 0, failed: 0, checkedAt: null, label: 'No source scopes enabled' };
    }
    return domain.query(name as QueryName, args as QueryArgs[QueryName]); });
  const mcp = createMcpAccess(options.mcp, { query, execute: command => executeAs(command, 'mcp') }, options.localDirectory);
  return {
    observeSystem: sample => { background.observe(sample as import('@fulcrum/ingest').SystemSample, Date.now()); if (background.reason(Date.now(), 'sources')) ingestion?.scheduler.interrupt(); },
    configureBackground: settings => { background.configure(settings as Partial<BackgroundSettings>); if (background.reason(Date.now(), 'sources')) ingestion?.scheduler.interrupt(); return background.status(Date.now()); },
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
    ingestionActive: () => ingestion?.scheduler.enabled() ?? false,
    close: () => {
      closing = true; jobs.close(); stopWatching?.();
      return closePromise ??= (async () => { await ingestion?.close(); await tail; unsubscribe?.(); try { await store.close(); } finally { await context?.close(); await index?.close(); listeners.clear(); } })();
    },
  };
}
