import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { GMAIL_READONLY_SCOPE, GoogleAuthError, type GoogleCredential, type GoogleOAuthClient } from './types.js';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress';
const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/oauth/callback';
const SIGN_IN_TIMEOUT_MS = 120_000;
const API_TIMEOUT_MS = 30_000;
const RANDOM_BYTES = 32;

export interface LoopbackFlowOptions {
  client: GoogleOAuthClient;
  openBrowser(url: URL): void | Promise<void>;
  stop?: AbortSignal;
  fetcher?: typeof fetch;
}

export interface LoopbackFlowResult {
  credential: GoogleCredential;
  /** Short-lived token from the exchange, for the first scope listing. */
  accessToken: string;
}

export async function googleJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    if (body.error === 'invalid_grant') throw new GoogleAuthError('refresh_token_revoked');
    throw new GoogleAuthError('google_request_failed');
  }
  return (await response.json()) as Record<string, unknown>;
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function openCallbackServer(state: string, signal: AbortSignal) {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  void code.catch(() => undefined);

  const server: Server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const port = (server.address() as { port: number }).port;
    const origin = `http://${LOOPBACK_HOST}:${port}`;
    const url = new URL(request.url ?? '/', origin);
    const valid = request.method === 'GET' && request.headers.host === `${LOOPBACK_HOST}:${port}`
      && url.pathname === CALLBACK_PATH && url.searchParams.get('state') === state;
    if (!valid) {
      response.writeHead(400).end('Invalid sign-in response.');
      return;
    }
    const value = url.searchParams.get('code');
    if (!value || url.searchParams.has('error')) {
      response.end('Sign-in was cancelled. Return to Fulcrum to try again.');
      rejectCode(new GoogleAuthError('sign_in_cancelled'));
      return;
    }
    response.end('Return to Fulcrum to continue.');
    resolveCode(value);
  });
  const abort = () => rejectCode(new GoogleAuthError('sign_in_expired'));
  signal.addEventListener('abort', abort, { once: true });
  return {
    server, code,
    close: () => { signal.removeEventListener('abort', abort); server.close(); },
  };
}

/** System-browser authorization-code flow with PKCE on a loopback port. */
export async function authorizeWithLoopback(options: LoopbackFlowOptions): Promise<LoopbackFlowResult> {
  const { client, openBrowser, stop } = options;
  const fetcher = options.fetcher ?? fetch;
  stop?.throwIfAborted();
  const state = randomBytes(RANDOM_BYTES).toString('base64url');
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS);
  const callback = openCallbackServer(state, stop ? AbortSignal.any([stop, timeout]) : timeout);

  let tokens: Record<string, unknown>;
  try {
    callback.server.listen(0, LOOPBACK_HOST);
    await once(callback.server, 'listening');
    const port = (callback.server.address() as { port: number }).port;
    const redirect = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: GMAIL_READONLY_SCOPE,
      access_type: 'offline', prompt: 'consent', state,
      code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256',
    }).toString();
    const [, code] = await Promise.all([Promise.resolve().then(() => openBrowser(url)), callback.code]);
    tokens = await googleJson(fetcher, GOOGLE_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: client.clientId, client_secret: client.clientSecret,
        grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier,
      }),
    });
  } finally {
    callback.close();
  }

  const accessToken = tokens['access_token'];
  const refreshToken = tokens['refresh_token'];
  const scope = tokens['scope'];
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string'
    || typeof scope !== 'string' || scope.trim() !== GMAIL_READONLY_SCOPE) {
    throw new GoogleAuthError('readonly_grant_required');
  }
  const profile = await googleJson(fetcher, GMAIL_PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const email = profile['emailAddress'];
  if (typeof email !== 'string') throw new GoogleAuthError('google_request_failed');
  return { accessToken, credential: { client, accountEmail: email.toLowerCase(), refreshToken } };
}
