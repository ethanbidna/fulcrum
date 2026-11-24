import type { ConnectionRuntimeStatus } from '@fulcrum/domain';
import type { ConnectorRuntime } from '@fulcrum/sources/runtime';
import type { LocalPreferences } from '@fulcrum/store';
import type { ConnectionClient, ManagedSourceSettings } from './managed-sources.js';
import type { ManagedSourceBrowser } from './managed-browser.js';

const HEALTH_INTERVAL_MS = 30_000;
type Preferences = Pick<LocalPreferences, 'read' | 'write'>;
interface Options {
  runtime?: ConnectorRuntime | undefined;
  preferences: Preferences;
  sources: ManagedSourceSettings;
  browser: ManagedSourceBrowser;
  designated(): boolean;
  connect(origin: string): Promise<ConnectionClient>;
}
interface Job { controller: AbortController; done: Promise<void> }
type HaltReason = 'stop' | 'shutdown' | 'failure';

export class ConnectionRuntime {
  private state: ConnectionRuntimeStatus = { phase: 'checking', installed: false, message: 'Checking the local connection service…', completedBytes: null, totalBytes: null };
  private job: Job | undefined;
  private halting: Promise<void> | undefined;
  private closed = false;
  private origin: string | undefined;
  private checking = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly options: Options) {}
  status(): ConnectionRuntimeStatus { return { ...this.state }; }
  private phase(phase: ConnectionRuntimeStatus['phase'], message: string): void {
    this.state = { ...this.state, phase, message, completedBytes: null, totalBytes: null };
  }
  async restore(): Promise<void> {
    if (!this.options.runtime) { this.phase('unavailable', 'The connection service needs the native macOS app.'); return; }
    try {
      this.state.installed = await this.options.runtime.installed();
      const saved = await this.options.preferences.read('connectionRuntime');
      if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved)
        || Object.keys(saved).length !== 1 || typeof (saved as { enabled?: unknown }).enabled !== 'boolean')) throw new Error('invalid_runtime_preference');
      this.phase(this.state.installed ? 'stopped' : 'not_installed', this.state.installed ? 'Connection service stopped. Saved connections stay on this Mac.' : 'Set up the local connection service to connect your tools.');
      this.timer = setInterval(() => { void this.check(); }, HEALTH_INTERVAL_MS); this.timer.unref();
      if ((saved as { enabled?: boolean } | undefined)?.enabled && this.options.designated()) {
        if (this.state.installed) this.start(true);
        else this.phase('failed', 'Setup was interrupted. Review and retry installation.');
      }
    } catch { this.phase('failed', 'Could not read the saved connection service setup. Retry without resetting its data.'); }
  }
  start(acknowledged: unknown): void {
    if (acknowledged !== true || this.closed || this.job || this.halting || !this.options.runtime
      || !this.options.designated() || this.state.phase === 'checking' || this.state.phase === 'ready') throw new Error('CONNECTION_RUNTIME_NOT_ALLOWED');
    const controller = new AbortController();
    this.phase(this.state.installed ? 'starting' : 'installing', this.state.installed ? 'Starting the local connection service…' : 'Preparing the local connection service…');
    const done = this.run(controller.signal).finally(() => { this.job = undefined; });
    this.job = { controller, done };
  }
  private async run(signal: AbortSignal): Promise<void> {
    try {
      await this.options.preferences.write('connectionRuntime', { enabled: true }); signal.throwIfAborted();
      const runtime = this.options.runtime!;
      const progress = (value: { message: string; completedBytes: number | null; totalBytes: number | null }) => {
        if (!this.options.designated()) this.job?.controller.abort();
        if (!signal.aborted && !this.closed && !this.halting) this.state = { ...this.state, ...value };
      };
      const origin = await (this.state.installed ? runtime.start(signal, progress) : runtime.install(signal, progress));
      this.state.installed = true; signal.throwIfAborted();
      this.phase('starting', 'Preparing secure sign-in on this Mac…');
      const client = await this.options.connect(origin); signal.throwIfAborted();
      if (!this.options.designated() || this.closed) throw new Error('not_designated');
      this.options.sources.resume(client); this.options.browser.resume(); this.origin = origin;
      this.phase('ready', 'Connection service ready. Importing is off.');
    } catch (error) {
      let stopped = true;
      await this.pause().catch(() => { stopped = false; });
      this.state.installed = await this.options.runtime!.installed().catch(() => this.state.installed);
      await this.options.runtime!.stop().catch(() => { stopped = false; });
      if (!this.closed && !this.halting) this.phase('failed', error instanceof Error && error.message.startsWith('Keychain approval')
        ? 'macOS Keychain approval was not completed. Start again and approve Fulcrum’s prompt for its local service keys.'
        : stopped ? 'Connection service setup did not finish. Check available storage and macOS Keychain access, then retry. Saved data was preserved.'
        : 'Connection service setup and shutdown could not finish. Saved data was preserved; retry stopping the service.');
    }
  }
  private async pause(): Promise<void> {
    this.options.sources.suspend();
    await this.options.browser.pause(); await this.options.sources.pause(); this.origin = undefined;
  }
  stop(): void {
    if (this.closed || !this.options.runtime) throw new Error('CONNECTION_RUNTIME_NOT_ALLOWED');
    void this.halt('stop');
  }
  private halt(reason: HaltReason): Promise<void> {
    if (this.halting) return this.halting;
    this.options.sources.suspend(); this.job?.controller.abort();
    this.phase('stopping', 'Stopping the connection service. Saved connections will stay on this Mac…');
    const running = this.finishHalt(reason).finally(() => { this.halting = undefined; });
    this.halting = running; return running;
  }
  private async finishHalt(reason: HaltReason): Promise<void> {
    let failed = false;
    if (reason !== 'shutdown') await this.options.preferences.write('connectionRuntime', { enabled: false }).catch(() => { failed = true; });
    await this.job?.done;
    await this.pause().catch(() => { failed = true; });
    await this.options.runtime?.stop().catch(() => { failed = true; });
    this.phase(failed || reason === 'failure' ? 'failed' : this.state.installed ? 'stopped' : 'not_installed', failed
      ? 'Could not finish stopping or save your stop preference. Retry before closing Fulcrum. Saved data was preserved.'
      : reason === 'failure' ? 'The connection service became unavailable. Start it again to check saved connections.'
        : 'Connection service stopped. Saved connections stay on this Mac.');
  }
  async check(): Promise<void> {
    if (this.closed || this.checking || this.halting) return;
    if (!this.options.designated() && this.job) { await this.halt('stop'); return; }
    if (this.state.phase !== 'ready' || !this.origin) return;
    this.checking = true; const origin = this.origin;
    try {
      const healthy = await this.options.runtime!.healthy(origin).catch(() => false);
      if (!this.closed && !this.halting && this.origin === origin && (!healthy || !this.options.designated())) await this.halt('failure');
    } finally { this.checking = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); await this.halt('shutdown');
  }
  async settled(): Promise<void> { await this.job?.done; await this.halting; }
}
