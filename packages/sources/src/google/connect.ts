import { authorizeWithLoopback, type LoopbackFlowOptions } from './loopback-flow.js';
import { RefreshingAccessTokenProvider } from './token-provider.js';
import type { GoogleCredentialStore } from './types.js';

export interface ConnectGoogleOptions extends LoopbackFlowOptions {
  store: GoogleCredentialStore;
  /** Opaque local key for this connection; never the email address. */
  accountKey: string;
}

/** Runs sign-in, persists the refresh token, and returns a token provider. */
export async function connectGoogleAccount(options: ConnectGoogleOptions) {
  const { store, accountKey, ...flow } = options;
  const { credential } = await authorizeWithLoopback(flow);
  await store.save(accountKey, credential);
  return {
    accountEmail: credential.accountEmail,
    tokens: new RefreshingAccessTokenProvider({
      store, accountKey, ...(flow.fetcher ? { fetcher: flow.fetcher } : {}),
    }),
  };
}

export async function disconnectGoogleAccount(store: GoogleCredentialStore, accountKey: string): Promise<void> {
  await store.remove(accountKey);
}
