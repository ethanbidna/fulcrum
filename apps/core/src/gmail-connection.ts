import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authorizeGmail, GmailSourceAdapter, refreshGmail } from '@fulcrum/sources';
import type { GmailClient, SourceAdapter, SourceScope } from '@fulcrum/sources';
import { NativeProviderSecrets } from './provider-secrets.js';

const open = promisify(execFile);

export interface GmailCredentials {
  get(): Promise<string>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

export interface GmailConnectionOptions {
  client: GmailClient;
  account: string;
  credentials: GmailCredentials;
  openBrowser?(url: URL): void | Promise<unknown>;
  fetcher?: typeof fetch;
}

export function nativeGmailConnection(client: GmailClient, account: string, helper: string, workspaceId: string) {
  return new GmailConnection({ client, account, credentials: new NativeProviderSecrets(helper, 'gmail', workspaceId) });
}

export class GmailConnection {
  private pending: Promise<unknown> = Promise.resolve();
  private scope: AbortController | undefined;

  constructor(private readonly options: GmailConnectionOptions) {}

  connect(signal: AbortSignal): Promise<SourceScope[]> {
    return this.run(async () => {
      const { client, account, credentials, fetcher, openBrowser } = this.options;
      const grant = await authorizeGmail({
        client, account, stop: signal, ...(fetcher ? { fetcher } : {}),
        openBrowser: openBrowser ?? (url => open('/usr/bin/open', [url.href])),
      });
      signal.throwIfAborted();
      await credentials.set(grant.refreshToken);
      this.scope?.abort();
      this.scope = new AbortController();
      return grant.labels.map(({ id, name }) => ({ id, label: name }));
    });
  }

  adapter(accountKey: string, labels: SourceScope[]): SourceAdapter {
    this.scope ??= new AbortController();
    const connection = this.scope.signal;
    const adapter = new GmailSourceAdapter({
      accountKey, labels, now: Date.now,
      accessToken: signal => this.accessToken(signal),
    });
    const scoped = (signal: AbortSignal) => AbortSignal.any([signal, connection]);
    return {
      id: adapter.id,
      scopes: () => adapter.scopes(),
      pull: (scope, cursor, limits) => adapter.pull(scope, cursor, { ...limits, signal: scoped(limits.signal) }),
      read: (ref, signal) => adapter.read(ref, scoped(signal)),
      permalink: () => adapter.permalink(),
    };
  }

  disconnect(): Promise<void> {
    this.scope?.abort();
    return this.run(async () => {
      this.scope?.abort();
      await this.options.credentials.remove();
    });
  }

  private accessToken(signal: AbortSignal) {
    return this.run(async () => {
      signal.throwIfAborted();
      const { client, credentials, fetcher } = this.options;
      const refreshToken = await credentials.get();
      signal.throwIfAborted();
      const result = await refreshGmail(client, refreshToken, signal, fetcher);
      if (result.refreshToken) await credentials.set(result.refreshToken);
      signal.throwIfAborted();
      return result.accessToken;
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
}
