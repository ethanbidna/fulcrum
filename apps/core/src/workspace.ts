import path from 'node:path';
import { AiSetup } from './ai-setup.js';
import { openAdministration } from './administration.js';
import { BackgroundPolicy } from '@fulcrum/ingest';
import type { BackgroundSettings } from '@fulcrum/ingest';
import { openIngestion } from './ingestion.js';
import type { WorkspaceIngestion } from './ingestion.js';
import { CommandPlanner, CommandJobs } from './command-planner.js';

import type { JsonModelRuntime } from '@fulcrum/llm';
import { LocalPreferences, LocalMcpActivity } from '@fulcrum/store';
import { createMcpAccess, validateMcpAccess, MCP_DEFAULTS } from './mcp-access.js';
import type { McpAccess } from './mcp-access.js';
import { randomUUID } from 'node:crypto';
import { Domain } from '@fulcrum/domain';
import type { CommandEnvelope, CommandResult, AppliedChange, QueryName, QueryArgs } from '@fulcrum/domain';
import { SqliteContextIndex, snapshotEpisodes } from '@fulcrum/context';
import { SqliteReadIndex } from '@fulcrum/index';
import type { IndexProgress } from '@fulcrum/index';
import { FileWorkspaceStore, loadStoreValidators, questionId } from '@fulcrum/store';
import type { WorkspaceEncryption } from '@fulcrum/store';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CoreHost } from './host.js';

export interface WorkspaceOptions {
  workspaceDirectory: string; localDirectory: string; userEntityId: string;
  onIndexProgress?: (progress: IndexProgress) => void;
  commandRuntime?: JsonModelRuntime;
  credentialHelper?:string;
  encryption?: WorkspaceEncryption;
  aiSetup?:AiSetup;
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
  const preferences = new LocalPreferences(options.localDirectory);
  const mcpAccess = validateMcpAccess(options.encryption ? MCP_DEFAULTS : options.mcp ?? await preferences.read('mcp') ?? MCP_DEFAULTS);
  options = {...options, mcp:mcpAccess};
  const schema = options.schemaDirectory ? { schemaDirectory: options.schemaDirectory } : {};
  if (options.encryption && (options.create || options.ingestion)) throw new Error('ENCRYPTED_WORKSPACE_SETUP_REQUIRED');
  if (options.create) await FileWorkspaceStore.create(options.workspaceDirectory, new Date(), schema);
  const store = new FileWorkspaceStore({ localDirectory: options.localDirectory, deviceLabel: options.deviceLabel, ...schema, ...(options.encryption ? { encryption: options.encryption } : {}) });
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
      const nextManifest = JSON.stringify(read.manifest);
      if (domain && next === fingerprint && nextManifest === manifestFingerprint && !unavailable) return;
      writable = !opened.readOnly;
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
        readOnly: opened.readOnly, commit: drafts => store.commit(drafts),
        validateState: value => validators.checkpoint(value) ? [] : validators.checkpoint.errors ?? [],
        validateEvent: value => validators.event(value) ? [] : validators.event.errors ?? [],
      });
      unsubscribe?.(); unsubscribe = domain.subscribe(change => {
        for (const listener of listeners) { try { listener(structuredClone(change)); } catch { continue; } }
      });
      if (previousDomain && writable) await maintainQuestions();
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
  const aiProfile = options.encryption ? path.join(options.localDirectory, `ai-${opened.manifest.workspaceId}`) : options.localDirectory;
  const aiSetup = options.aiSetup ?? new AiSetup(aiProfile, options.credentialHelper);
  const planner = new CommandPlanner(() => domain, options.commandRuntime ?? aiSetup.runtime, Date.now, options.commandRuntime?async snapshot=>snapshot:(snapshot,request)=>aiSetup.context(snapshot,request));
  const jobs = new CommandJobs(planner);
  let ingestion: Awaited<ReturnType<typeof openIngestion>> | undefined;
  try {
    if (options.ingestion) ingestion = await openIngestion({ configuration: options.ingestion, policy: background, localDirectory: options.localDirectory, workspaceDirectory: options.workspaceDirectory, deviceId: opened.deviceId, userEntityId: options.userEntityId, snapshot: () => domain.getSnapshot() });
  } catch (error) { stopWatching?.(); unsubscribe?.(); await context?.close(); await index?.close(); await store.close(); throw error; }
  let administration: Awaited<ReturnType<typeof openAdministration>>;
  try { administration = await openAdministration(options, opened.deviceId, () => domain, background, () => ingestion?.scheduler.enabled() ?? false, {
    status:()=>({access:structuredClone(mcpAccess),initiatives:domain.getSnapshot().state.initiatives.map(({id,title})=>({id,title})),categories:domain.getSnapshot().state.categories.map(({id,label})=>({id,name:label}))}),
    configure:async input=>{const next=validateMcpAccess(input);await preferences.write('mcp',next);for(const key of Object.keys(mcpAccess))delete (mcpAccess as unknown as Record<string,unknown>)[key];Object.assign(mcpAccess,next);return structuredClone(mcpAccess);},
    activity:()=>new LocalMcpActivity(options.localDirectory).recent(),
  },aiSetup,async(userEntityId,label)=>{jobs.close();await store.renameDevice(label);options.userEntityId=userEntityId;options.deviceLabel=label;fingerprint='';await reload();await preferences.write('activeWorkspace',{workspaceDirectory:options.workspaceDirectory,userEntityId,deviceLabel:label,workspaceId:domain.getSnapshot().workspaceId});}); }
  catch (error) { jobs.close(); aiSetup.close(); stopWatching?.(); unsubscribe?.(); await ingestion?.close(); await context?.close(); await index?.close(); await store.close(); throw error; }
  const BACKUP_CHECK_INTERVAL_MS = 60_000;
  const backupTimer = setInterval(() => { void enqueue(() => administration.tick()).catch(() => undefined); }, BACKUP_CHECK_INTERVAL_MS);
  backupTimer.unref();
  void enqueue(() => administration.tick()).catch(() => undefined);
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
  const mcp = createMcpAccess(mcpAccess, { query: (name,args)=>enqueue(async()=>{await requireAvailable();return domain.queryMcp(name as QueryName,args as QueryArgs[QueryName],mcpAccess);}), execute: command => executeAs(command, 'mcp') }, options.localDirectory);
  return {
    administer: (name, args) => enqueue(async () => { await requireAvailable(); return administration.request(name as import('@fulcrum/domain').AdministrationName, args as never); }),
    observeSystem: sample => { background.observe(sample as import('@fulcrum/ingest').SystemSample, Date.now()); if (background.reason(Date.now(), 'sources')) ingestion?.scheduler.interrupt(); },
    configureBackground: settings => { background.configure(settings as Partial<BackgroundSettings>); if (background.reason(Date.now(), 'sources')) ingestion?.scheduler.interrupt(); return background.status(Date.now()); },
    planCommand: request => enqueue(async () => { await requireAvailable(); return jobs.start(request); }),
    commandPlanStatus: id => options.encryption ? enqueue(async () => { await requireAvailable(); return jobs.status(id); }) : jobs.status(id), cancelCommandPlan: id => jobs.cancel(id),
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
      closing = true; clearInterval(backupTimer); jobs.close(); aiSetup.close(); stopWatching?.();
      return closePromise ??= (async () => { await ingestion?.close(); await tail; unsubscribe?.(); try { await store.close(); } finally { await context?.close(); await index?.close(); listeners.clear(); } })();
    },
  };
}
