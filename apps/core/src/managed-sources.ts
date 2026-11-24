import type { ManagedAuthorization, ManagedSourceId, ManagedSourceStatus } from '@fulcrum/domain';
import { MANAGED_SOURCE_IDS } from '@fulcrum/sources';
import type { ManagedConnection, ManagedConnections } from '@fulcrum/sources';
import type { LocalPreferences } from '@fulcrum/store';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const MAX_API_KEY_LENGTH = 4096;
class CancelledAuthorization extends Error {}
const MAX_CODE_LENGTH = 8192;
type ConnectionClient = Pick<ManagedConnections, 'begin' | 'complete' | 'connectGranola' | 'lookup' | 'disconnect' | 'cancel'>;
type Preferences = Pick<LocalPreferences, 'read' | 'write'>;
interface Job { cancelled: boolean; claiming: boolean; attemptId?: string; expires?: number }
interface Options { preferences: Preferences; client?: ConnectionClient; designated(): boolean; now?: () => number }

function sourceId(value: unknown): ManagedSourceId {
  if (typeof value !== 'string' || !MANAGED_SOURCE_IDS.includes(value as ManagedSourceId)) throw new Error('INVALID_MANAGED_SOURCE');
  return value as ManagedSourceId;
}
function validReceipt(value: unknown): value is ManagedConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return Object.keys(receipt).length === 3 && typeof receipt.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt.id)
    && MANAGED_SOURCE_IDS.includes(receipt.source as ManagedSourceId) && receipt.ingestion === 'blocked';
}

export class ManagedSourceSettings {
  private readonly connections = new Map<ManagedSourceId, ManagedConnection>();
  private readonly pending = new Set<ManagedSourceId>();
  private readonly phases = new Map<ManagedSourceId, ManagedSourceStatus['phase']>();
  private readonly jobs = new Map<ManagedSourceId, Job>();
  private readonly operations = new Map<ManagedSourceId, Promise<unknown>>();
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly now: () => number;

  constructor(private readonly options: Options) { this.now = options.now ?? Date.now; }

  async restore(): Promise<void> {
    const saved = await this.options.preferences.read('managedSources');
    if (saved === undefined) return;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('INVALID_MANAGED_SETTINGS');
    const { connections, pending, ...extra } = saved as Record<string, unknown>;
    if (Object.keys(extra).length || !Array.isArray(connections) || connections.length > MANAGED_SOURCE_IDS.length
      || !connections.every(validReceipt) || !Array.isArray(pending) || pending.length > MANAGED_SOURCE_IDS.length
      || new Set(connections.map(item => item.source)).size !== connections.length || new Set(pending).size !== pending.length) {
      throw new Error('INVALID_MANAGED_SETTINGS');
    }
    const pendingSources = pending.map(sourceId);
    for (const receipt of connections) { this.connections.set(receipt.source, receipt); this.phases.set(receipt.source, 'saved'); }
    for (const source of pendingSources) { this.pending.add(source); this.phases.set(source, 'failed'); }
  }

  status(): ManagedSourceStatus[] {
    for (const [source, job] of this.jobs) {
      if (job.expires !== undefined && job.expires <= this.now() && !this.operations.has(source)) {
        if (job.attemptId) this.options.client?.cancel(job.attemptId);
        this.jobs.delete(source); this.phases.set(source, 'failed');
      }
    }
    return MANAGED_SOURCE_IDS.map(source => ({ source, ingestion: 'blocked',
      phase: !this.options.client || this.closed ? 'unavailable' : this.phases.get(source) ?? 'disconnected' }));
  }

  private persist(): Promise<void> {
    const saved = { connections: [...this.connections.values()], pending: [...this.pending] };
    const write = this.writes.then(() => this.options.preferences.write('managedSources', saved));
    this.writes = write.catch(() => undefined);
    return write;
  }

  private run<T>(source: ManagedSourceId, operation: () => Promise<T>): Promise<T> {
    if (!this.options.client || this.closed || this.operations.has(source)) return Promise.reject(new Error('MANAGED_SOURCE_BUSY_OR_UNAVAILABLE'));
    const running = Promise.resolve().then(() => {
      if (this.closed) throw new CancelledAuthorization();
      return operation();
    }).catch(error => {
      if (!(error instanceof CancelledAuthorization)) this.phases.set(source, 'failed');
      throw new Error('MANAGED_SOURCE_OPERATION_FAILED');
    }).finally(() => { this.operations.delete(source); });
    this.operations.set(source, running);
    return running;
  }

  private requireConsent(acknowledged: unknown): void {
    if (acknowledged !== true || !this.options.designated()) throw new Error('MANAGED_SOURCE_CONNECTION_NOT_ALLOWED');
  }

  private async remember(source: ManagedSourceId, receipt: ManagedConnection | null, active: boolean): Promise<void> {
    if (receipt) this.connections.set(source, receipt); else this.connections.delete(source);
    this.pending.delete(source);
    await this.persist();
    this.phases.set(source, receipt ? active ? 'connected' : 'failed' : 'disconnected');
  }

  private async cancelJob(source: ManagedSourceId, job: Job): Promise<void> {
    if (job.attemptId) this.options.client!.cancel(job.attemptId);
    this.jobs.delete(source);
    this.pending.delete(source);
    await this.persist();
    this.phases.set(source, this.connections.has(source) ? 'saved' : 'disconnected');
  }

  private shouldCancel(job: Job): boolean {
    return job.cancelled || this.closed || !this.options.designated();
  }

  private async acceptGrant(source: ManagedSourceId, receipt: ManagedConnection, job: Job): Promise<void> {
    if (!this.shouldCancel(job)) {
      try { await this.remember(source, receipt, true); }
      catch (error) { if (!this.shouldCancel(job)) throw error; }
    }
    if (!this.shouldCancel(job)) return;
    this.phases.set(source, 'cancelling');
    await this.options.client!.disconnect(source, receipt.id);
    await this.remember(source, null, false);
  }

  admit(input: unknown, acknowledged: unknown): ManagedSourceId {
    const source = sourceId(input);
    this.requireConsent(acknowledged);
    if (!this.options.client || this.closed || source === 'granola' || this.jobs.has(source) || this.operations.has(source)) throw new Error('MANAGED_SOURCE_CONNECTION_NOT_ALLOWED');
    return source;
  }

  failed(input: unknown): void { this.phases.set(sourceId(input), 'failed'); }

  async begin(input: unknown, acknowledged: unknown): Promise<ManagedAuthorization> {
    const source = this.admit(input, acknowledged);
    return this.run(source, async () => {
      const job: Job = { cancelled: false, claiming: false };
      this.jobs.set(source, job); this.phases.set(source, 'connecting');
      try {
        this.pending.add(source); await this.persist();
        const found = await this.options.client!.lookup(source);
        if (job.cancelled || this.closed || !this.options.designated()) { await this.cancelJob(source, job); throw new CancelledAuthorization(); }
        if (found) {
          await this.remember(source, found.connection, found.active);
          this.jobs.delete(source);
          if (!found.active) throw new Error('inactive_connection');
          return { phase: 'connected' };
        }
        const attempt = await this.options.client!.begin(source);
        job.attemptId = attempt.attemptId; job.expires = this.now() + SIGN_IN_TIMEOUT_MS;
        if (job.cancelled || this.closed || !this.options.designated()) { await this.cancelJob(source, job); throw new CancelledAuthorization(); }
        return { phase: 'authorization', ...attempt };
      } catch (error) {
        if (!job.attemptId) this.jobs.delete(source);
        throw error;
      }
    });
  }

  async complete(attemptId: unknown, code: unknown): Promise<void> {
    const entry = [...this.jobs.entries()].find(([, job]) => job.attemptId === attemptId && !job.claiming && !job.cancelled);
    if (!entry || typeof attemptId !== 'string' || typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH) throw new Error('INVALID_MANAGED_AUTHORIZATION');
    const [source, job] = entry;
    this.requireConsent(true);
    if (job.expires === undefined || job.expires <= this.now()) throw new Error('INVALID_MANAGED_AUTHORIZATION');
    return this.run(source, async () => {
      job.claiming = true;
      try {
        const receipt = await this.options.client!.complete(attemptId, code);
        await this.acceptGrant(source, receipt, job);
      } finally { this.jobs.delete(source); }
    });
  }

  async granola(apiKey: unknown, acknowledged: unknown): Promise<void> {
    this.requireConsent(acknowledged);
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > MAX_API_KEY_LENGTH || /[\r\n\0]/.test(apiKey)) throw new Error('INVALID_MANAGED_SOURCE_KEY');
    return this.run('granola', async () => {
      const job: Job = { cancelled: false, claiming: true };
      this.jobs.set('granola', job); this.phases.set('granola', 'connecting');
      try {
        this.pending.add('granola'); await this.persist();
        const found = await this.options.client!.lookup('granola');
        if (job.cancelled || this.closed || !this.options.designated()) { await this.cancelJob('granola', job); return; }
        if (found) { await this.remember('granola', found.connection, found.active); return; }
        const receipt = await this.options.client!.connectGranola(apiKey);
        await this.acceptGrant('granola', receipt, job);
      } finally { this.jobs.delete('granola'); }
    });
  }

  async verify(input: unknown): Promise<void> {
    const source = sourceId(input);
    if (this.jobs.has(source) || !this.connections.has(source) && !this.pending.has(source)) throw new Error('MANAGED_SOURCE_VERIFICATION_NOT_ALLOWED');
    return this.run(source, async () => {
      const found = await this.options.client!.lookup(source);
      await this.remember(source, found?.connection ?? null, found?.active ?? false);
    });
  }

  async cancel(input: unknown): Promise<void> {
    const source = sourceId(input);
    const job = this.jobs.get(source);
    if (!job) return;
    job.cancelled = true;
    this.phases.set(source, 'cancelling');
    if (this.operations.has(source)) return;
    await this.cancelJob(source, job);
  }

  async disconnect(input: unknown): Promise<void> {
    const source = sourceId(input);
    await this.cancel(source);
    await this.operations.get(source)?.catch(() => undefined);
    return this.run(source, async () => {
      const found = await this.options.client!.lookup(source);
      if (found) await this.options.client!.disconnect(source, found.connection.id);
      await this.remember(source, null, false);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      if (job.attemptId) this.options.client?.cancel(job.attemptId);
    }
    await Promise.allSettled(this.operations.values());
    let changed = false;
    for (const [source, job] of this.jobs) {
      if (!job.claiming) changed = this.pending.delete(source) || changed;
    }
    this.jobs.clear();
    if (changed) await this.persist().catch(() => undefined);
    await this.writes;
  }
}
