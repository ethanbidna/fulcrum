import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

const HOST = '127.0.0.1';
const CALLBACK = '/oauth/callback';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const MAILBOX = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const SIGN_IN_TIMEOUT = 120_000;
const API_TIMEOUT = 30_000;

async function googleJson(fetcher, url, options) {
  const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(API_TIMEOUT) });
  if (!response.ok) throw new Error('google_request_failed');
  return response.json();
}

function openCallback(state, signal) {
  let complete;
  let reject;
  const code = new Promise((resolve, fail) => { complete = resolve; reject = fail; });
  void code.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const origin = `http://${HOST}:${server.address().port}`;
    const url = new URL(request.url, origin);
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
  signal.addEventListener('abort', abort, { once: true });
  return { server, code, close: () => {
    signal.removeEventListener('abort', abort);
    server.close();
  } };
}

export async function authorizeGmail({ client, account, openBrowser, stop, fetcher = fetch }) {
  stop?.throwIfAborted();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT);
  const callback = openCallback(state, stop ? AbortSignal.any([stop, timeout]) : timeout);
  const credentials = { client_id: client.client_id, client_secret: client.client_secret };
  const postToken = fields => googleJson(fetcher, TOKEN, {
    method: 'POST', body: new URLSearchParams({ ...credentials, ...fields }),
  });

  let tokens;
  try {
    callback.server.listen(0, HOST);
    await once(callback.server, 'listening');
    const redirect = `http://${HOST}:${callback.server.address().port}${CALLBACK}`;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: READONLY,
      access_type: 'offline', prompt: 'consent', login_hint: account, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    const [, code] = await Promise.all([Promise.resolve().then(() => openBrowser(url)), callback.code]);
    tokens = await postToken({
      grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier,
    });
  } finally {
    callback.close();
  }
  if (!tokens.access_token || !tokens.refresh_token || tokens.scope?.trim() !== READONLY) {
    throw new Error('google_readonly_grant_required');
  }

  const read = (route, token) => googleJson(fetcher, MAILBOX + route, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const profile = await read('profile?fields=emailAddress', tokens.access_token);
  if (profile.emailAddress?.toLowerCase() !== account.toLowerCase()) throw new Error('wrong_google_account');

  const { labels = [] } = await read('labels?fields=labels(id,name,type)', tokens.access_token);
  const refreshToken = tokens.refresh_token;
  return {
    labels: labels.filter(label => label.type === 'user' && typeof label.name === 'string' && typeof label.id === 'string')
      .map(({ id, name }) => ({ id, name })),
    refresh: async () => {
      const refreshed = await postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
      if (!refreshed.access_token) throw new Error('google_request_failed');
      return refreshed.access_token;
    },
  };
}
