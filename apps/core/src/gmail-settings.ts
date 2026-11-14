import { createHash } from 'node:crypto';
import type { GmailSettingsStatus } from '@fulcrum/domain';
import type { GmailClient, SourceScope } from '@fulcrum/sources';
import { LocalPreferences } from '@fulcrum/store';
import { NativeProviderSecrets } from './provider-secrets.js';
import { nativeGmailConnection } from './gmail-connection.js';
import type { GmailConnection } from './gmail-connection.js';
import type { WorkspaceIngestion } from './ingestion.js';

type Selection = { account: string; clientId: string; label: SourceScope | null };
const validAccount = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);

export class GmailSettings {
  private selection: Selection | null = null;
  private labels: SourceScope[] = [];
  private connection: GmailConnection | undefined;
  private job: AbortController | undefined;
  private failed = false;
  private active = false;
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly preferences: LocalPreferences,
    private readonly client: GmailClient | undefined,
    private readonly helper: string | undefined,
    private readonly workspaceId: string,
    private readonly designated: () => boolean,
    private readonly apply: (configuration?: WorkspaceIngestion) => Promise<void>,
    private readonly connectionFor = nativeGmailConnection,
  ) {}

  async restore() {
    const saved = await this.preferences.read('gmail');
    if (saved === undefined || saved === null) return;
    const selection = saved as Selection;
    if (!validAccount(selection.account) || typeof selection.clientId !== 'string' || (selection.label !== null &&
        (typeof selection.label?.id !== 'string' || !selection.label.id || typeof selection.label.label !== 'string'))) {
      throw new Error('INVALID_GMAIL_SETTINGS');
    }
    this.selection = selection;
    if (this.client && this.helper) this.connection = this.createConnection(selection.account);
    await this.activate();
  }

  status(): GmailSettingsStatus {
    if (!this.helper) return { phase: 'unavailable' };
    if (!this.client && this.selection) return { phase: 'select', account: this.selection.account, labels: [] };
    if (!this.client) return { phase: 'unavailable' };
    if (this.job) return { phase: 'connecting' };
    if (this.active && this.selection?.label && this.client.client_id === this.selection.clientId) return { phase: 'active', account: this.selection.account, label: this.selection.label };
    if (this.selection) return { phase: 'select', account: this.selection.account, labels: this.labels };
    return { phase: this.failed ? 'failed' : 'disconnected' };
  }

  start(account: unknown, acknowledged: unknown) {
    if (!validAccount(account) || acknowledged !== true || this.job || this.selection || !this.designated()) {
      throw new Error('GMAIL_CONNECTION_NOT_ALLOWED');
    }
    const normalized = account.toLowerCase();
    const connection = this.createConnection(normalized);
    const job = new AbortController();
    this.job = job;
    this.failed = false;
    this.connecting = this.connect(normalized, connection, job);
  }

  async select(id: unknown) {
    const label = this.labels.find(item => item.id === id);
    const selection = this.selection;
    if (this.job || !selection || !label || selection.label || !this.designated()) throw new Error('INVALID_GMAIL_LABEL');
    await this.save({ ...selection, label });
    try { await this.activate(); }
    catch (error) { await this.save(selection); throw error; }
  }

  async disconnect() {
    if (this.job) { this.job.abort(); return; }
    if (!this.selection || !this.helper) return;
    const paused = { ...this.selection, label: null };
    await this.save(paused);
    this.active = false;
    await this.apply();
    if (this.connection) await this.connection.disconnect();
    else await new NativeProviderSecrets(this.helper, 'gmail', this.workspaceId).remove();
    await this.save(null);
    this.labels = [];
    this.connection = undefined;
  }

  async close() { this.job?.abort(); await this.connecting; }

  private async connect(account: string, connection: GmailConnection, job: AbortController) {
    try {
      // Keep a local disconnect path even if shutdown interrupts credential storage.
      await this.save({ account, clientId: this.client!.client_id, label: null });
      this.connection = connection;
      this.labels = await connection.connect(job.signal);
      job.signal.throwIfAborted();
    } catch {
      try { await connection.disconnect(); await this.save(null); this.connection = undefined; }
      catch { this.failed = true; }
      this.failed ||= !job.signal.aborted;
    } finally { this.job = undefined; }
  }

  private createConnection(account: string) {
    if (!this.client || !this.helper) throw new Error('GMAIL_UNAVAILABLE');
    return this.connectionFor(this.client, account, this.helper, this.workspaceId);
  }

  private async save(selection: Selection | null) {
    await this.preferences.write('gmail', selection);
    this.selection = selection;
  }

  private async activate() {
    if (!this.connection || !this.selection?.label || this.client?.client_id !== this.selection.clientId) return;
    const key = createHash('sha256').update(JSON.stringify([this.client.client_id, this.selection.account])).digest('hex');
    const adapter = this.connection.adapter(key, [this.selection.label]);
    const scopes = (await adapter.scopes()).map(scope => scope.id);
    await this.apply({ adapters: [adapter], scopes: { [adapter.id]: scopes } });
    this.active = true;
  }
}
