import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ManagedSourceId } from '@fulcrum/domain';
import { receiveManagedCode } from '@fulcrum/sources';
import type { ManagedSourceSettings } from './managed-sources.js';

const open = promisify(execFile);
type ReceiveCode = typeof receiveManagedCode;
interface Job { controller: AbortController; done: Promise<void> }

export class ManagedSourceBrowser {
  private readonly jobs = new Map<ManagedSourceId, Job>();
  private closed = false;
  private paused = false;
  constructor(private readonly settings: ManagedSourceSettings, private readonly receive: ReceiveCode = receiveManagedCode,
    private readonly openBrowser: (url: URL) => Promise<unknown> = url => open('/usr/bin/open', [url.href])) {}

  start(source: unknown, acknowledged: unknown): void {
    const id = this.settings.admit(source, acknowledged);
    if (this.closed || this.paused || this.jobs.has(id)) throw new Error('MANAGED_SOURCE_BUSY_OR_UNAVAILABLE');
    const controller = new AbortController();
    const done = this.connect(id, controller.signal).finally(() => { this.jobs.delete(id); });
    this.jobs.set(id, { controller, done });
  }

  private async connect(source: ManagedSourceId, signal: AbortSignal): Promise<void> {
    try {
      const attempt = await this.settings.begin(source, true);
      if (attempt.phase === 'connected') return;
      signal.throwIfAborted();
      const code = await this.receive({ source, authorizationUrl: attempt.authorizationUrl, signal, openBrowser: this.openBrowser });
      signal.throwIfAborted();
      await this.settings.complete(attempt.attemptId, code);
    } catch {
      await this.settings.cancel(source).catch(() => undefined);
      if (!signal.aborted && !this.closed) this.settings.failed(source);
    }
  }

  async cancel(source: unknown): Promise<void> {
    this.jobs.get(source as ManagedSourceId)?.controller.abort();
    await this.settings.cancel(source);
  }
  async disconnect(source: unknown): Promise<void> { await this.cancel(source); await this.settings.disconnect(source); }
  resume(): void { if (this.closed) throw new Error('MANAGED_SOURCE_BUSY_OR_UNAVAILABLE'); this.paused = false; }
  async close(): Promise<void> { this.closed = true; await this.pause(); }
  async pause(): Promise<void> {
    this.paused = true;
    for (const [source, job] of this.jobs) { job.controller.abort(); await this.settings.cancel(source).catch(() => undefined); }
    await Promise.allSettled([...this.jobs.values()].map(job => job.done));
  }
}
