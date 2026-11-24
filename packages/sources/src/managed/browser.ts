import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HOSTED_OAUTH_ORIGIN, readonlyAuthorizationUrl, type ManagedSourceId } from './policy.js';

const HOST = '127.0.0.1';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_REPLY_BYTES = 16 * 1024;
const MAX_CODE_LENGTH = 8192;
const MAX_CONNECTIONS = 8;

export const managedReplyScript = `(() => {
  const button = document.getElementById('continue');
  const cancel = document.getElementById('cancel');
  const message = document.getElementById('message');
  const configuration = JSON.parse(document.getElementById('configuration').textContent);
  let popup;
  let finished = false;
  let sending = false;
  const closePopup = () => { if (popup) popup.close(); };
  const post = (action, value) => fetch(location.pathname + '/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
  }).then(response => { if (!response.ok) throw new Error('closed'); });
  const stop = () => { finished = true; clearInterval(timer); closePopup(); button.disabled = true; cancel.disabled = true; };
  button.addEventListener('click', () => {
    if (popup && !popup.closed) { popup.focus(); return; }
    popup = window.open(configuration.authorizationUrl, '_blank', 'popup,width=600,height=800');
    message.textContent = popup ? 'Finish signing in in the provider window.' : 'Allow popups for this page, then try again.';
  });
  window.addEventListener('message', async event => {
    if (finished || sending || !popup || event.source !== popup || event.origin !== configuration.replyOrigin
      || typeof event.data?.code !== 'string' || !event.data.code || event.data.code.length > configuration.maxCodeLength) return;
    sending = true;
    try {
      const code = decodeURIComponent(event.data.code);
      await post('complete', { code });
      stop(); message.textContent = 'Sign-in received. Return to Fulcrum to check the connection.';
    } catch { stop(); message.textContent = 'Sign-in could not finish. Return to Fulcrum and try again.'; void post('cancel', {}).catch(() => {}); }
  });
  cancel.addEventListener('click', () => {
    if (finished) return;
    stop(); message.textContent = 'Sign-in cancelled. Return to Fulcrum.';
    void post('cancel', {}).catch(() => {});
  });
  const timer = setInterval(() => {
    if (finished || sending) return;
    if (popup && popup.closed) { cancel.click(); return; }
    void fetch(location.pathname + '/status').then(response => { if (!response.ok) throw new Error('closed'); })
      .catch(() => { stop(); message.textContent = 'This sign-in has closed. Return to Fulcrum.'; });
  }, 1000);
  window.addEventListener('pagehide', () => {
    if (finished) return;
    stop(); void fetch(location.pathname + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {});
  });
})();`;

function helperHtml(authorizationUrl: URL, nonce: string): string {
  const configuration = JSON.stringify({ authorizationUrl: authorizationUrl.href, replyOrigin: HOSTED_OAUTH_ORIGIN, maxCodeLength: MAX_CODE_LENGTH }).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect a source · Fulcrum</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#202124;background:#fff;margin:3rem auto;padding:0 1.5rem;max-width:35rem}button{font:inherit;padding:.65rem 1rem;margin:1rem .5rem 0 0;cursor:pointer}</style>
<main><h1>Connect your account</h1><p>Continue to the provider’s sign-in window. Activepieces handles authorization and renewal; its dashboard will not open.</p><p id="message" role="status">Return to Fulcrum after signing in. Importing will remain off.</p><button id="continue">Continue to sign-in</button><button id="cancel">Cancel sign-in</button></main>
<script id="configuration" type="application/json" nonce="${nonce}">${configuration}</script><script nonce="${nonce}">${managedReplyScript}</script></html>`;
}

async function replyBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > MAX_REPLY_BYTES) throw new Error('invalid_oauth_reply');
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_oauth_reply');
  return value as Record<string, unknown>;
}

interface Options {
  source: ManagedSourceId;
  authorizationUrl: string;
  signal: AbortSignal;
  openBrowser(url: URL): void | Promise<unknown>;
  timeoutMs?: number;
}

export async function receiveManagedCode({ source, authorizationUrl, signal, openBrowser, timeoutMs = SIGN_IN_TIMEOUT_MS }: Options): Promise<string> {
  signal.throwIfAborted();
  const authorization = readonlyAuthorizationUrl(source, authorizationUrl, new URL(authorizationUrl).searchParams.get('client_id') ?? '');
  const callbackPath = `/${randomBytes(32).toString('base64url')}`;
  const nonce = randomBytes(24).toString('base64url');
  let origin = '';
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  void result.catch(() => undefined);
  const stop = () => { if (!settled) { settled = true; rejectCode(new Error('managed_sign_in_closed')); } };
  const lifecycle = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  lifecycle.addEventListener('abort', stop, { once: true });

  function terminal(response: ServerResponse, code?: string): void {
    settled = true;
    response.once('finish', () => code === undefined ? rejectCode(new Error('managed_sign_in_cancelled')) : resolveCode(code));
    response.setHeader('Content-Type', 'application/json');
    response.end('{"ok":true}');
  }
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    let url: URL;
    try { url = new URL(request.url ?? '/', origin); } catch { response.writeHead(400).end(); return; }
    if (request.headers.host !== new URL(origin).host || url.origin !== origin || url.search || settled) { response.writeHead(403).end(); return; }
    if (request.method === 'GET' && url.pathname === callbackPath) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(helperHtml(authorization, nonce)); return;
    }
    if (request.method === 'GET' && url.pathname === `${callbackPath}/status`) { response.end('waiting'); return; }
    if (request.method !== 'POST' || ![`${callbackPath}/complete`, `${callbackPath}/cancel`].includes(url.pathname)) { response.writeHead(404).end(); return; }
    if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') { request.resume(); response.writeHead(403).end(); return; }
    void replyBody(request).then(body => {
      if (settled) { response.writeHead(409).end(); return; }
      if (url.pathname.endsWith('/cancel') && Object.keys(body).length === 0) { terminal(response); return; }
      if (!url.pathname.endsWith('/complete') || Object.keys(body).length !== 1 || typeof body.code !== 'string' || !body.code || body.code.length > MAX_CODE_LENGTH) { response.writeHead(400).end(); return; }
      terminal(response, body.code);
    }).catch(() => { if (!response.destroyed) response.writeHead(400).end(); });
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.requestTimeout = REQUEST_TIMEOUT_MS; server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.setTimeout(REQUEST_TIMEOUT_MS, socket => socket.destroy());
  try {
    server.listen(0, HOST); await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('managed_callback_unavailable');
    origin = `http://${HOST}:${address.port}`;
    lifecycle.throwIfAborted();
    await Promise.race([Promise.resolve().then(() => openBrowser(new URL(callbackPath, origin))), result]);
    return await result;
  } finally {
    lifecycle.removeEventListener('abort', stop); server.close(); server.closeAllConnections();
  }
}
