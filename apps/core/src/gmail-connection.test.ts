import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GmailConnection } from './gmail-connection.js';

test('Gmail stays scoped across restart and disconnect', async () => {
  let stored: string | undefined;
  const credentials = {
    get: async () => { assert.ok(stored); return stored; },
    set: async (token: string) => { stored = token; },
    remove: async () => { stored = undefined; },
  };
  const account = 'fixture@example.invalid';
  const provider = async (input: RequestInfo | URL, request?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      assert.ok(request?.body instanceof URLSearchParams);
      if (request.body.get('grant_type') === 'authorization_code') {
        return Response.json({ access_token: 'initial', refresh_token: 'fixture-token', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
      }
      assert.equal(request.body.get('refresh_token'), 'fixture-token');
      return Response.json({ access_token: 'refreshed', refresh_token: 'rotated' });
    }
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: account });
    assert.ok(url.pathname.endsWith('/labels'));
    return Response.json({ labels: [{ id: 'Label_selected', name: 'Synthetic', type: 'user' }] });
  };
  const options = {
    account, credentials, client: { client_id: 'fixture-client', client_secret: 'fixture-secret' },
    fetcher: provider,
    async openBrowser(url: URL) {
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'fixture-code');
      const result = await fetch(callback);
      assert.equal(result.status, 200);
      await result.text();
    },
  };
  const signal = new AbortController().signal;
  const labels = await new GmailConnection(options).connect(signal);
  assert.equal(stored, 'fixture-token');
  const resumed = new GmailConnection(options);
  const adapter = resumed.adapter('fixture-account', labels);
  const [scope] = await adapter.scopes();
  assert.ok(scope);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'gmail.googleapis.com');
    assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer refreshed');
    if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '1' });
    assert.equal(url.searchParams.get('labelIds'), 'Label_selected');
    return Response.json({ messages: [] });
  };
  try {
    const limits = { since: '2026-01-01T00:00:00Z', limit: 1, signal };
    await adapter.pull(scope, null, limits);
    assert.equal(stored, 'rotated');
    await resumed.disconnect();
    assert.equal(stored, undefined);
    await assert.rejects(adapter.pull(scope, null, limits), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; }
});

test('Gmail rejects refresh responses that broaden the grant', async () => {
  const { refreshGmail } = await import('@fulcrum/sources');
  const fetcher = async () => Response.json({ access_token: 'fixture', scope: 'https://www.googleapis.com/auth/gmail.modify' });
  await assert.rejects(refreshGmail({ client_id: 'fixture', client_secret: 'fixture' }, 'fixture', undefined, fetcher),
    { message: 'google_readonly_grant_required' });
});
