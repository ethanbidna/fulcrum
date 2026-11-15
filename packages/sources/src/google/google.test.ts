import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GMAIL_READONLY_SCOPE, GoogleAuthError, GoogleClientOwner, connectGoogleAccount, disconnectGoogleAccount,
  fulcrumClientFrom, RefreshingAccessTokenProvider, userClientFromInput,
  type GoogleCredential, type GoogleCredentialStore,
} from './index.js';

const CLIENT = { owner: GoogleClientOwner.User, clientId: '123456-synthetic.apps.googleusercontent.com', clientSecret: 'GOCSPX-synthetic' };
const ACCOUNT = 'person@example.test';

class MemoryStore implements GoogleCredentialStore {
  items = new Map<string, GoogleCredential>();
  async load(key: string) { return this.items.get(key) ?? null; }
  async save(key: string, value: GoogleCredential) { this.items.set(key, value); }
  async remove(key: string) { this.items.delete(key); }
}

interface FakeOptions { scope?: string; email?: string; refreshToken?: string | null; tokenError?: string }

/** Stands in for Google's token and Gmail endpoints; records every call. */
function fakeGoogle(options: FakeOptions = {}) {
  const calls: { url: string; body: URLSearchParams | null; auth: string | null }[] = [];
  let refreshCount = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    const auth = new Headers(init?.headers).get('Authorization');
    calls.push({ url, body, auth });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.endsWith('/token')) {
      if (options.tokenError) return json({ error: options.tokenError }, 400);
      if (body?.get('grant_type') === 'refresh_token') return json({ access_token: `access-${++refreshCount}`, expires_in: 3600 });
      return json({
        access_token: 'access-0', expires_in: 3600, scope: options.scope ?? GMAIL_READONLY_SCOPE,
        ...(options.refreshToken === null ? {} : { refresh_token: options.refreshToken ?? 'refresh-synthetic' }),
      });
    }
    return json({ emailAddress: options.email ?? 'Person@Example.test' });
  }) as typeof fetch;
  return { fetcher, calls };
}

/** Plays the browser: follows the authorization URL straight to the loopback redirect. */
function browserThatApproves(seen: { url?: URL } = {}) {
  return async (url: URL) => {
    seen.url = url;
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code', 'code-synthetic');
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    await fetch(redirect);
  };
}

describe('client input', () => {
  it('accepts pasted values and trims whitespace', () => {
    const client = userClientFromInput({ clientId: `  ${CLIENT.clientId}\n`, clientSecret: ` ${CLIENT.clientSecret} ` });
    expect(client).toEqual(CLIENT);
  });
  it('rejects malformed ids and secrets', () => {
    expect(() => userClientFromInput({ clientId: 'abc', clientSecret: CLIENT.clientSecret })).toThrow(GoogleAuthError);
    expect(() => userClientFromInput({ clientId: CLIENT.clientId, clientSecret: 'GOCSPX-' })).toThrow('client_secret_missing');
  });
  it('reports an unavailable Fulcrum client', () => {
    expect(() => fulcrumClientFrom(null)).toThrow('fulcrum_client_unavailable');
    expect(fulcrumClientFrom({ clientId: 'x', clientSecret: 'y' }).owner).toBe(GoogleClientOwner.Fulcrum);
  });
});

describe('connectGoogleAccount', () => {
  it('requests readonly + PKCE, stores the refresh token, and returns a provider', async () => {
    const google = fakeGoogle();
    const store = new MemoryStore();
    const seen: { url?: URL } = {};
    const result = await connectGoogleAccount({
      client: CLIENT, store, accountKey: 'acct-1', fetcher: google.fetcher, openBrowser: browserThatApproves(seen),
    });
    const params = seen.url!.searchParams;
    expect(params.get('scope')).toBe(GMAIL_READONLY_SCOPE);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const exchange = google.calls.find(call => call.body?.get('grant_type') === 'authorization_code')!;
    const challenge = createHash('sha256').update(exchange.body!.get('code_verifier')!).digest('base64url');
    expect(challenge).toBe(params.get('code_challenge'));
    expect(result.accountEmail).toBe(ACCOUNT);
    expect(store.items.get('acct-1')?.refreshToken).toBe('refresh-synthetic');
    expect(await result.tokens.accessToken()).toBe('access-1');
  });

  it('rejects a grant with extra scopes and stores nothing', async () => {
    const store = new MemoryStore();
    await expect(connectGoogleAccount({
      client: CLIENT, store, accountKey: 'a', fetcher: fakeGoogle({ scope: `${GMAIL_READONLY_SCOPE} https://mail.google.com/` }).fetcher,
      openBrowser: browserThatApproves(),
    })).rejects.toThrow('readonly_grant_required');
    expect(store.items.size).toBe(0);
  });

  it('rejects a response with no refresh token', async () => {
    await expect(connectGoogleAccount({
      client: CLIENT, store: new MemoryStore(), accountKey: 'a', fetcher: fakeGoogle({ refreshToken: null }).fetcher,
      openBrowser: browserThatApproves(),
    })).rejects.toThrow('readonly_grant_required');
  });

  it('reports cancellation from the browser', async () => {
    const cancel = async (url: URL) => {
      const redirect = new URL(url.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('state', url.searchParams.get('state')!);
      await fetch(redirect);
    };
    await expect(connectGoogleAccount({
      client: CLIENT, store: new MemoryStore(), accountKey: 'a', fetcher: fakeGoogle().fetcher, openBrowser: cancel,
    })).rejects.toThrow('sign_in_cancelled');
  });

  it('ignores a callback with the wrong state', async () => {
    const forged = async (url: URL) => {
      const redirect = new URL(url.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('code', 'attacker');
      redirect.searchParams.set('state', 'wrong');
      expect((await fetch(redirect)).status).toBe(400);
      await browserThatApproves()(url);
    };
    const store = new MemoryStore();
    await connectGoogleAccount({ client: CLIENT, store, accountKey: 'a', fetcher: fakeGoogle().fetcher, openBrowser: forged });
    expect(store.items.size).toBe(1);
  });

  it('stops when aborted', async () => {
    const stop = new AbortController();
    const wait = connectGoogleAccount({
      client: CLIENT, store: new MemoryStore(), accountKey: 'a', fetcher: fakeGoogle().fetcher, stop: stop.signal,
      openBrowser: () => { queueMicrotask(() => stop.abort()); },
    });
    await expect(wait).rejects.toThrow('sign_in_expired');
  });

  it('removes the credential on disconnect', async () => {
    const store = new MemoryStore();
    await store.save('a', { client: CLIENT, accountEmail: ACCOUNT, refreshToken: 'r' });
    await disconnectGoogleAccount(store, 'a');
    expect(await store.load('a')).toBeNull();
  });
});

describe('RefreshingAccessTokenProvider', () => {
  async function setup(options: FakeOptions = {}) {
    const store = new MemoryStore();
    await store.save('a', { client: CLIENT, accountEmail: ACCOUNT, refreshToken: 'refresh-synthetic' });
    const google = fakeGoogle(options);
    let now = 0;
    const provider = new RefreshingAccessTokenProvider({ store, accountKey: 'a', fetcher: google.fetcher, now: () => now });
    return { provider, google, advance: (ms: number) => { now += ms; } };
  }

  it('caches until near expiry, then refreshes', async () => {
    const { provider, advance } = await setup();
    expect(await provider.accessToken()).toBe('access-1');
    expect(await provider.accessToken()).toBe('access-1');
    advance(3_600_000 - 30_000);
    expect(await provider.accessToken()).toBe('access-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const { provider, google } = await setup();
    const tokens = await Promise.all([provider.accessToken(), provider.accessToken(), provider.accessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(google.calls.length).toBe(1);
  });

  it('refetches after invalidate', async () => {
    const { provider } = await setup();
    await provider.accessToken();
    provider.invalidate();
    expect(await provider.accessToken()).toBe('access-2');
  });

  it('reports a revoked or expired refresh token', async () => {
    const { provider } = await setup({ tokenError: 'invalid_grant' });
    await expect(provider.accessToken()).rejects.toThrow('refresh_token_revoked');
  });

  it('reports a missing credential', async () => {
    const provider = new RefreshingAccessTokenProvider({ store: new MemoryStore(), accountKey: 'none', fetcher: fakeGoogle().fetcher });
    await expect(provider.accessToken()).rejects.toThrow('refresh_token_revoked');
  });
});
