import { mkdir, realpath, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { watch as watchFiles } from 'node:fs';
import { setImmediate, clearImmediate } from 'node:timers';
import type { ChangeEvent, WorkspaceManifest, WorkspaceStateDoc } from '@fulcrum/schema';
import type { WorkspaceStore, WorkspaceRead, StoreOptions, OpenedWorkspace, EventDraft } from './interfaces.js';
import { atomicFile, CHECKPOINT_LIMIT, durableFile, ensureDirectory, nextHlc, SCHEMA_VERSION, StoreError, syncDirectory, resolvedLocation, uuid, WATCH_INTERVAL_MS } from './files.js';
import { loadStoreValidators, validate } from './validation.js';
import type { StoreValidators } from './validation.js';
import { acquireCoreLock } from './lock.js';
import { loadIdentity, saveIdentity } from './identity.js';
import type { DeviceIdentity } from './identity.js';
import { readWorkspace } from './reader.js';
import { writeEvents } from './writer.js';

const CHECKPOINT_INTERVAL = 500;
export class FileWorkspaceStore implements WorkspaceStore {
  private directory = '';
  private localDirectory = '';
  private opened: OpenedWorkspace | undefined;
  private identity: DeviceIdentity | undefined;
  private validators!: StoreValidators;
  private lock: Awaited<ReturnType<typeof acquireCoreLock>> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private failed = false;
  private checkpointEvents = 0;
  private checkpointTimer: NodeJS.Immediate | undefined;
  private maintenanceFailed = false;
  private checkpointProvider: (() => Promise<WorkspaceStateDoc>) | undefined;
  private readonly watchers = new Set<() => void>();
  constructor(private readonly options: StoreOptions) {}
  static async create(directory: string, now = new Date(), options: { schemaDirectory?: URL } = {}): Promise<WorkspaceManifest> {
    await mkdir(directory, { recursive: true });
    const manifest: WorkspaceManifest = { format: 'fulcrum-workspace', schemaVersion: SCHEMA_VERSION, workspaceId: uuid(), createdAt: now.toISOString() };
    const validators = await loadStoreValidators(options.schemaDirectory);
    try { await durableFile(path.join(directory, 'workspace.json'), JSON.stringify(manifest)); await syncDirectory(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const existing = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8')) as WorkspaceManifest;
    validate(validators.manifest, existing); return existing;
  }
  async open(directory: string): Promise<OpenedWorkspace> {
    if (this.opened || this.stopped) throw new StoreError('STORE_ALREADY_OPEN', 'Use one store instance per open workspace');
    this.directory = await realpath(directory);
    this.localDirectory = await resolvedLocation(this.options.localDirectory);
    const relative = path.relative(this.directory, this.localDirectory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new StoreError('LOCAL_DIRECTORY_IN_WORKSPACE', 'Local state must be outside the workspace');
    await mkdir(this.localDirectory, { recursive: true });
    this.validators = await loadStoreValidators(this.options.schemaDirectory);
    this.lock = await acquireCoreLock(this.localDirectory, this.options.lockStaleMs);
    try {
      const read = await readWorkspace(this.directory, this.validators);
      const supported = this.options.readerVersion ?? SCHEMA_VERSION;
      if ((read.manifest.minReaderVersion ?? 1) > supported || read.manifest.encryption) throw new StoreError('WORKSPACE_VERSION_UNSUPPORTED', 'This reader cannot interpret the workspace');
      const identity = await loadIdentity(this.localDirectory, this.options.deviceLabel);
      const saved = identity.lastSeqByWorkspace[read.manifest.workspaceId] ?? 0;
      const maximum = maxSeq(read.events, identity.deviceId);
      const diagnostics = [...read.diagnostics];
      if (maximum > saved) {
        identity.deviceId = uuid(); identity.lastSeqByWorkspace = {};
        diagnostics.push({ code: 'CLONED_DEVICE_ROTATED' }); await saveIdentity(this.localDirectory, identity);
      } else if (maximum < saved) throw new StoreError('WORKSPACE_NOT_FULLY_DOWNLOADED', 'Local acknowledged events are missing from the workspace');
      this.identity = identity;
      const registered = read.events.some(event => event.ops.some(op => op.kind === 'device' && op.op === 'create' && op.id === identity.deviceId));
      this.opened = { manifest: read.manifest, deviceId: identity.deviceId, readOnly: read.manifest.schemaVersion > supported, registrationRequired: !registered, diagnostics };
      return structuredClone(this.opened);
    } catch (error) { await this.lock.release(); this.lock = undefined; throw error; }
  }
  async read(): Promise<WorkspaceRead> {
    this.requireOpen(); const read = await readWorkspace(this.directory, this.validators);
    if (this.maintenanceFailed) read.diagnostics.push({ code: 'CHECKPOINT_WRITE_FAILED' });
    return read;
  }
  async *readAll(): AsyncIterable<ChangeEvent> { for (const event of (await this.read()).events) yield event; }
  commit(drafts: EventDraft[]): Promise<ChangeEvent[]> {
    const submitted = structuredClone(drafts);
    return this.serialize(async () => {
      const read = await this.requireWritable();
      const deviceId = this.identity!.deviceId;
      let seq = maxSeq(read.events, deviceId);
      let hlc = read.events.at(-1)?.hlc ?? '0000000000000-0000';
      const events = submitted.map(draft => {
        if (draft.deviceId !== deviceId) throw new StoreError('WRONG_WRITER', 'A device may append only its own events');
        hlc = nextHlc(hlc, this.now().getTime());
        return { ...draft, seq: ++seq, hlc };
      });
      await this.write(events, read); return structuredClone(events);
    });
  }
  renameDevice(label:string):Promise<void>{
    return this.serialize(async()=>{if(!this.identity)throw new StoreError('STORE_NOT_OPEN','Open a workspace first');const identity={...this.identity,label};await saveIdentity(this.localDirectory,identity);this.identity=identity;});
  }
  append(events: ChangeEvent[]): Promise<void> {
    const submitted = structuredClone(events);
    return this.serialize(async () => { const read = await this.requireWritable(); await this.write(submitted, read); });
  }
  private async write(events: ChangeEvent[], read: WorkspaceRead) {
    if (!events.length) throw new StoreError('EMPTY_TRANSACTION', 'Cannot append an empty transaction');
    const deviceId = this.identity!.deviceId;
    let seq = maxSeq(read.events, deviceId);
    let hlc = read.events.at(-1)?.hlc ?? '0000000000000-0000';
    const ids = new Set(read.events.map(event => event.eventId));
    for (const event of events) {
      validate(this.validators.event, event);
      if (event.v !== SCHEMA_VERSION || event.deviceId !== deviceId || event.seq !== ++seq || event.hlc <= hlc || ids.has(event.eventId)) throw new StoreError('INVALID_APPEND', 'Append does not extend this device causally');
      ids.add(event.eventId); hlc = event.hlc;
    }
    try {
      await this.lock!.assertOwned();
      await writeEvents(this.directory, events, this.options.fault);
      await this.options.fault?.('identity-before-save');
      this.identity!.lastSeqByWorkspace[read.manifest.workspaceId] = seq;
      await saveIdentity(this.localDirectory, this.identity!);
      this.checkpointEvents += events.length;
      this.scheduleCheckpoint();
    } catch (error) { this.failed = true; throw error; }
  }
  private scheduleCheckpoint() {
    if (this.closing || !this.checkpointDue || !this.checkpointProvider || this.checkpointTimer) return;
    this.checkpointTimer = setImmediate(() => {
      this.checkpointTimer = undefined;
      void this.serialize(async () => {
        if (!this.checkpointDue || !this.checkpointProvider) return;
        const checkpoint = await this.checkpointProvider();
        await this.checkpoint(checkpoint, await this.requireWritable());
      }).catch(() => { this.maintenanceFailed = true; });
    });
  }
  get checkpointDue(): boolean { return this.checkpointEvents >= CHECKPOINT_INTERVAL; }
  setCheckpointProvider(provider: () => Promise<WorkspaceStateDoc>) { this.checkpointProvider = provider; }
  writeCheckpoint(checkpoint: WorkspaceStateDoc): Promise<void> {
    const submitted = structuredClone(checkpoint);
    return this.serialize(async () => { const read = await this.requireWritable(); await this.checkpoint(submitted, read); });
  }
  private async checkpoint(checkpoint: WorkspaceStateDoc, read: WorkspaceRead) {
    validate(this.validators.checkpoint, checkpoint);
    if (checkpoint.workspaceId !== read.manifest.workspaceId || checkpoint.v !== SCHEMA_VERSION || !checkpoint.maxHlc) throw new StoreError('CHECKPOINT_INVALID', 'Checkpoint identity/version/clock is invalid');
    for (const [deviceId, seq] of Object.entries(checkpoint.frontier)) {
      const sequences = new Set(read.events.filter(event => event.deviceId === deviceId).map(event => event.seq));
      if (seq > maxSeq(read.events, deviceId)) throw new StoreError('CHECKPOINT_INVALID', 'Checkpoint covers a missing event');
      for (let expected = 1; expected <= seq; expected++) if (!sequences.has(expected)) throw new StoreError('CHECKPOINT_INVALID', 'Checkpoint covers a missing event');
    }
    const covered = read.events.filter(event => event.seq <= (checkpoint.frontier[event.deviceId] ?? 0));
    if (covered.at(-1)?.hlc !== checkpoint.maxHlc) throw new StoreError('CHECKPOINT_INVALID', 'Checkpoint clock does not match covered events');
    const folder = path.join(this.directory, 'checkpoints', this.identity!.deviceId);
    await ensureDirectory(path.join(this.directory, 'checkpoints')); await ensureDirectory(folder);
    const file = path.join(folder, `${checkpoint.maxHlc}.json`);
    // Checkpoints are caches, but an immutable name must never change underneath sync.
    try { await readFile(file); throw new StoreError('CHECKPOINT_EXISTS', 'Checkpoint already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await atomicFile(file, JSON.stringify(checkpoint), async () => { await this.options.fault?.('checkpoint-before-rename'); });
    const names = (await readdir(folder)).filter(name => /^\d{13}-\d{4}\.json$/.test(name)).sort().reverse();
    for (const name of names.slice(CHECKPOINT_LIMIT)) await unlink(path.join(folder, name));
    await syncDirectory(folder); this.checkpointEvents = 0; this.maintenanceFailed = false;
  }
  async latestUsableCheckpoint(): Promise<WorkspaceStateDoc | null> {
    const read = await this.read();
    const candidates = read.checkpoints.filter(({ body }) => body.maxHlc && Object.entries(body.frontier).every(([deviceId, seq]) => seq <= maxSeq(read.events, deviceId)) && read.events.filter(event => event.seq <= (body.frontier[event.deviceId] ?? 0)).at(-1)?.hlc === body.maxHlc && read.events.every(event => event.seq <= (body.frontier[event.deviceId] ?? 0) || event.hlc > body.maxHlc!));
    candidates.sort((a, b) => b.body.maxHlc!.localeCompare(a.body.maxHlc!));
    return structuredClone(candidates[0]?.body ?? null);
  }
  watch(listener: () => void): () => void {
    this.requireOpen(); let fingerprint = ''; let busy = false; let closed = false;
    const notify = () => { try { listener(); } catch { return; } };
    const check = async () => {
      if (busy || closed) return; busy = true;
      try {
        const read = await this.read();
        const next = JSON.stringify([read.events.map(event => event.eventId), read.diagnostics]);
        if (fingerprint && next !== fingerprint) notify(); fingerprint = next;
      } catch { notify(); }
      finally { busy = false; }
    };
    let watcher: ReturnType<typeof watchFiles> | undefined;
    try { watcher = watchFiles(this.directory, { recursive: true }, () => { void check(); }); watcher.on('error', () => { void check(); }); }
    catch { /* Polling still observes changes when native watching is unavailable. */ }
    const timer = setInterval(() => { void check(); }, WATCH_INTERVAL_MS); timer.unref(); void check();
    const stop = () => { closed = true; clearInterval(timer); watcher?.close(); this.watchers.delete(stop); };
    this.watchers.add(stop); return stop;
  }
  close(): Promise<void> {
    this.closing = true;
    if (this.checkpointTimer) { clearImmediate(this.checkpointTimer); this.checkpointTimer = undefined; }
    return this.closePromise ??= this.finishClose();
  }
  private async finishClose(): Promise<void> {
    if (this.stopped) return;
    await this.tail;
    try {
      if (this.checkpointProvider && !this.failed && !this.opened?.readOnly) {
        const checkpoint = await this.checkpointProvider();
        if (checkpoint.maxHlc) {
          const latest = await this.latestUsableCheckpoint();
          if (latest?.maxHlc !== checkpoint.maxHlc) await this.checkpoint(checkpoint, await this.requireWritable());
        }
      }
    } finally {
      this.stopped = true; for (const stop of [...this.watchers]) stop();
      await this.lock?.release(); this.lock = undefined;
    }
  }
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private requireOpen() { if (!this.opened || this.stopped) throw new StoreError('STORE_CLOSED', 'Workspace store is not open'); }
  private async requireWritable(): Promise<WorkspaceRead> {
    this.requireOpen(); await this.lock!.assertOwned();
    if (this.failed || this.opened!.readOnly) throw new StoreError('WORKSPACE_READ_ONLY', 'Workspace is read-only; reopen after recovery');
    const read = await this.read();
    if (read.manifest.schemaVersion !== SCHEMA_VERSION || (read.manifest.minReaderVersion ?? 1) > (this.options.readerVersion ?? SCHEMA_VERSION)) throw new StoreError('WORKSPACE_READ_ONLY', 'Workspace version changed');
    const maximum = maxSeq(read.events, this.identity!.deviceId);
    if (maximum !== (this.identity!.lastSeqByWorkspace[read.manifest.workspaceId] ?? 0)) { this.failed = true; throw new StoreError('CLONED_DEVICE_DETECTED', 'Writer identity changed; reopen to rotate it'); }
    return read;
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.stopped) return Promise.reject(new StoreError('STORE_CLOSED', 'Workspace store is closing'));
    const result = this.tail.then(operation); this.tail = result.catch(() => undefined); return result;
  }
}
function maxSeq(events: ChangeEvent[], deviceId: string): number { return events.filter(event => event.deviceId === deviceId).reduce((maximum, event) => Math.max(maximum, event.seq), 0); }
