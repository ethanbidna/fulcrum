import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { authorizeGmail } from './desktop-oauth.mjs';
import { createGmailTestSession } from './desktop-session.mjs';

const account = 'gmail-test@example.invalid';
const client = { client_id: 'fixture-client', client_secret: 'fixture-secret' };
const label = 'Label_synthetic';
const readonly = 'https://www.googleapis.com/auth/gmail.readonly';

function browserCallback(context, checkState = false) {
  const localFetch = globalThis.fetch;
  return async url => {
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'), readonly);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    context.authorization = url;
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'fixture-code');
    if (checkState) {
      callback.searchParams.set('state', 'unrelated-attempt');
      const rejected = await localFetch(callback);
      assert.equal(rejected.status, 400);
      await rejected.text();
    }
    callback.searchParams.set('state', url.searchParams.get('state'));
    const accepted = await localFetch(callback);
    assert.equal(accepted.status, 200);
    await accepted.text();
  };
}

test('desktop sign-in restricts access to the chosen test label and refreshes across scans', async context => {
  let refreshes = 0;
  let changedLabel = false;
  const browser = {};
  const openBrowser = browserCallback(browser, true);

  context.mock.method(globalThis, 'fetch', async (input, request) => {
    const url = new URL(input);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const grant = request.body.get('grant_type');
      if (grant === 'authorization_code') {
        const verifier = request.body.get('code_verifier');
        assert.equal(createHash('sha256').update(verifier).digest('base64url'),
          browser.authorization.searchParams.get('code_challenge'));
        assert.equal(request.body.get('redirect_uri'), browser.authorization.searchParams.get('redirect_uri'));
        return Response.json({ access_token: 'initial-access', refresh_token: 'refresh', scope: readonly });
      }
      assert.equal(grant, 'refresh_token');
      assert.equal(request.body.get('refresh_token'), 'refresh');
      return Response.json({ access_token: `fixture-access-${++refreshes}` });
    }

    assert.equal(url.origin, 'https://gmail.googleapis.com');
    const route = url.pathname.split('/me/')[1];
    if (url.searchParams.has('fields')) {
      assert.equal(request.headers.Authorization, 'Bearer initial-access');
      if (route === 'profile') return Response.json({ emailAddress: account });
      assert.equal(route, 'labels');
      return Response.json({ labels: [{ id: label, name: 'Synthetic', type: 'user' }, { id: 'INBOX', type: 'system' }] });
    }
    assert.equal(request.headers.Authorization, `Bearer fixture-access-${refreshes}`);
    if (route === 'profile') return Response.json({ historyId: '100' });
    if (route === 'messages') {
      assert.equal(url.searchParams.get('labelIds'), label);
      return Response.json({ messages: [{ id: 'initial' }] });
    }
    if (route === 'history') {
      assert.equal(url.searchParams.get('startHistoryId'), '100');
      assert.equal(url.searchParams.get('labelId'), label);
      assert.ok(changedLabel);
      return Response.json({ historyId: '200', history: [{ labelsAdded: [{ message: { id: 'new' } }] }] });
    }
    return Response.json({
      id: route.split('/')[1], labelIds: [label], internalDate: String(Date.now()),
      payload: { headers: [{ name: 'From', value: 'fixture@example.invalid' }] },
      snippet: 'Synthetic mail',
    });
  });

  const session = createGmailTestSession(stop => authorizeGmail({ client, account, openBrowser, stop }));
  context.after(session.close);
  assert.deepEqual(await session.run('/connect'), [{ id: label, name: 'Synthetic' }]);
  await assert.rejects(session.run('/backfill', 'INBOX'), { message: 'choose_test_label' });
  assert.deepEqual(await session.run('/backfill', label), { pages: 1, messages: 1 });
  changedLabel = true;
  assert.deepEqual(await session.run('/incremental'), { pages: 1, messages: 1 });
  assert.equal(refreshes, 2);
});

test('signing into another account stops before listing any labels', async () => {
  const openBrowser = browserCallback({});
  const fetcher = async input => {
    if (input === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'initial-access', refresh_token: 'refresh', scope: readonly });
    }
    assert.equal(input, 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress');
    return Response.json({ emailAddress: 'other@example.invalid' });
  };
  await assert.rejects(authorizeGmail({ client, account, openBrowser, fetcher }), { message: 'wrong_google_account' });
});
