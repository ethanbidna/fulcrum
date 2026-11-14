import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const HOST = '127.0.0.1';
const CALLBACK = '/oauth/callback';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const MAILBOX = 'https://gmail.googleapis.com/gmail/v1/users/me/';
export const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const SIGN_IN_TIMEOUT = 120_000;
const API_TIMEOUT = 30_000;

export interface GmailClient { client_id: string; client_secret: string }
interface Tokens { access_token?: string; refresh_token?: string; scope?: string }
interface AuthorizeOptions {
  client: GmailClient;
  account: string;
  openBrowser(url: URL): void | Promise<unknown>;
  stop?: AbortSignal;
  fetcher?: typeof fetch;
}

async function googleJson<T>(fetcher: typeof fetch, url: string, options: RequestInit, stop?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(API_TIMEOUT);
  const response = await fetcher(url, { ...options, redirect: 'error', signal: stop ? AbortSignal.any([timeout, stop]) : timeout });
  if (!response.ok) throw new Error('google_request_failed');
  return await response.json() as T;
}

function postToken(client: GmailClient, fields: Record<string, string>, fetcher: typeof fetch, signal?: AbortSignal) {
  return googleJson<Tokens>(fetcher, TOKEN, {
    method: 'POST', body: new URLSearchParams({ ...client, ...fields }),
  }, signal);
}

export async function refreshGmail(client: GmailClient, refreshToken: string, signal?: AbortSignal, fetcher = fetch) {
  const refreshed = await postToken(client, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher, signal);
  if (typeof refreshed.access_token !== 'string' || !refreshed.access_token) throw new Error('google_request_failed');
  if (refreshed.scope !== undefined && refreshed.scope !== GMAIL_READONLY) throw new Error('google_readonly_grant_required');
  return { accessToken: refreshed.access_token, ...(typeof refreshed.refresh_token === 'string' && refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}) };
}

function openCallback(state: string, signal: AbortSignal) {
  let complete!: (value: string) => void;
  let reject!: (error: Error) => void;
  const code = new Promise<string>((resolve, fail) => { complete = resolve; reject = fail; });
  void code.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const port = callbackPort(server);
    const origin = `http://${HOST}:${port}`;
    const url = parseCallback(request.url, origin);
    if (!url) { response.writeHead(400).end('Invalid sign-in response.'); return; }
    if (request.method !== 'GET' || request.headers.host !== new URL(origin).host
      || url.origin !== origin || url.pathname !== CALLBACK || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in response.');
      return;
    }
    const value = url.searchParams.get('code');
    if (!value || url.searchParams.has('error')) {
      response.end('Sign-in was cancelled. Return to Fulcrum to try again.');
      reject(new Error('google_sign_in_cancelled'));
      return;
    }
    response.end('Return to Fulcrum to continue.');
    complete(value);
  });
  const abort = () => reject(new Error('google_sign_in_expired'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return { server, code, close: () => {
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  } };
}

function parseCallback(value: string | undefined, origin: string) {
  try { return value ? new URL(value, origin) : null; } catch { return null; }
}

function callbackPort(server: ReturnType<typeof createServer>) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('google_callback_unavailable');
  return address.port;
}

export async function authorizeGmail({ client, account, openBrowser, stop, fetcher = fetch }: AuthorizeOptions) {
  stop?.throwIfAborted();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT);
  const callback = openCallback(state, stop ? AbortSignal.any([stop, timeout]) : timeout);
  let tokens: Tokens;
  try {
    callback.server.listen(0, HOST);
    await once(callback.server, 'listening');
    const redirect = `http://${HOST}:${callbackPort(callback.server)}${CALLBACK}`;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: GMAIL_READONLY,
      access_type: 'offline', prompt: 'consent', login_hint: account, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    const [, code] = await Promise.all([Promise.resolve().then(() => openBrowser(url)), callback.code]);
    tokens = await postToken(client, {
      grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier,
    }, fetcher, stop);
  } finally {
    callback.close();
  }
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || tokens.scope !== GMAIL_READONLY) {
    throw new Error('google_readonly_grant_required');
  }

  const read = <T>(route: string) => googleJson<T>(fetcher, MAILBOX + route, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }, stop);
  const profile = await read<{ emailAddress?: string }>('profile?fields=emailAddress');
  if (typeof profile.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== account.toLowerCase()) {
    throw new Error('wrong_google_account');
  }

  const { labels = [] } = await read<{ labels?: Array<{ id: string; name: string; type: string }> }>('labels?fields=labels(id,name,type)');
  return {
    labels: labels.filter(label => label?.type === 'user' && typeof label.name === 'string' && typeof label.id === 'string')
      .map(({ id, name }) => ({ id, name })),
    refreshToken: tokens.refresh_token,
  };
}
