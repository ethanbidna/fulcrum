import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { authorizeGmail } from './desktop-oauth.mjs';
import { openGmailProbe } from './live.mjs';

const DEVELOPMENT_HOST = '127.0.0.1:5173';
const API = '/__fulcrum/gmail-test';
const SAFE_ERRORS = new Set([
  'google_request_failed', 'google_sign_in_cancelled', 'google_sign_in_expired',
  'google_readonly_grant_required', 'wrong_google_account', 'choose_test_label',
  'no_backfill_messages', 'no_incremental_messages', 'gmail_history_expired',
]);

export async function gmailTestPlugin(clientFile, account) {
  const { installed: client } = JSON.parse(await readFile(clientFile, 'utf8'));
  if (!client?.client_id || !client.client_secret || !account?.includes('@')) {
    throw new Error('Set the Gmail test account and provide a downloaded Desktop OAuth client JSON file.');
  }
  const open = promisify(execFile);
  const openBrowser = url => open('/usr/bin/open', [url.href]);
  const session = createGmailTestSession(stop => authorizeGmail({ client, account, openBrowser, stop }));
  const plugin = {
    name: 'fulcrum-gmail-test', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(API, async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'POST' || request.headers.host !== DEVELOPMENT_HOST
          || request.headers.origin !== `http://${DEVELOPMENT_HOST}`
          || request.headers['sec-fetch-site'] !== 'same-origin') {
          response.writeHead(403).end();
          return;
        }
        const url = new URL(request.url, `http://${DEVELOPMENT_HOST}`);
        response.setHeader('Content-Type', 'application/json');
        try {
          response.end(JSON.stringify(await session.run(url.pathname, url.searchParams.get('label'))));
        } catch (error) {
          const code = SAFE_ERRORS.has(error.message) ? error.message : 'gmail_test_failed';
          response.writeHead(400).end(JSON.stringify({ error: code }));
        }
      });
    },
  };
  return { plugin, closeSession: session.close };
}

export function createGmailTestSession(authorize) {
  let grant;
  let probe;
  let active;
  const stop = new AbortController();
  async function reset() {
    grant = undefined;
    const previous = probe;
    probe = undefined;
    await previous?.close();
  }
  async function run(action, label) {
    if (action === '/connect') {
      await reset();
      grant = await authorize(stop.signal);
      return grant.labels;
    }
    if (!grant) throw new Error('connect_first');
    if (action === '/backfill') {
      if (!grant.labels.some(({ id }) => id === label)) throw new Error('choose_test_label');
      await probe?.close();
      probe = await openGmailProbe(label, grant.refresh);
      return probe.backfill();
    }
    if (action === '/incremental' && probe) return probe.incremental();
    throw new Error('backfill_first');
  }
  return {
    async run(action, label) {
      stop.signal.throwIfAborted();
      if (active) throw new Error('test_busy');
      active = run(action, label);
      try { return await active; } finally { active = undefined; }
    },
    async close() {
      stop.abort();
      await active?.catch(() => {});
      await reset();
    },
  };
}
