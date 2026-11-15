import { GOOGLE_TOKEN_URL, googleJson } from './loopback-flow.js';
import { GoogleAuthError, type AccessTokenProvider, type GoogleCredentialStore } from './types.js';

const DEFAULT_LIFETIME_SECONDS = 3600;
const MS_PER_SECOND = 1000;
/** Refresh early so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenProviderOptions {
  store: GoogleCredentialStore;
  accountKey: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Caches one access token in memory; the refresh token stays in the store. */
export class RefreshingAccessTokenProvider implements AccessTokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly options: TokenProviderOptions) {}

  async accessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const now = (this.options.now ?? Date.now)();
    if (this.cached && this.cached.expiresAt - EXPIRY_MARGIN_MS > now) return this.cached.token;
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Drops the cached token, e.g. after a 401 from Gmail. */
  invalidate(): void { this.cached = null; }

  private async refresh(): Promise<string> {
    const { store, accountKey } = this.options;
    const credential = await store.load(accountKey);
    if (!credential) throw new GoogleAuthError('refresh_token_revoked');
    const response = await googleJson(this.options.fetcher ?? fetch, GOOGLE_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: credential.client.clientId, client_secret: credential.client.clientSecret,
        grant_type: 'refresh_token', refresh_token: credential.refreshToken,
      }),
    });
    const token = response['access_token'];
    if (typeof token !== 'string') throw new GoogleAuthError('google_request_failed');
    const lifetime = typeof response['expires_in'] === 'number' ? response['expires_in'] : DEFAULT_LIFETIME_SECONDS;
    this.cached = { token, expiresAt: (this.options.now ?? Date.now)() + lifetime * MS_PER_SECOND };
    return token;
  }
}
