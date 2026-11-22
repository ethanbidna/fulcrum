import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManagedGmailSession, READ_SCOPES } from './client.mjs';
import { acceptsOAuthReply } from './reply.mjs';

function fixture() {
  const requests = [];
  let sampleCount = 3;
  let messageFailure = false;
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, options });
    if (url.hostname === 'secrets.activepieces.com') return Response.json({ '@activepieces/piece-gmail': { clientId: 'synthetic-client' } });
    if (url.pathname.endsWith('/authentication/sign-up')) return Response.json({ token: 'synthetic-local-session', projectId: 'synthetic-project' });
    assert.equal(options.headers.Authorization, 'Bearer synthetic-local-session');
    if (url.pathname.endsWith('/authorization-url')) {
      const authorization = new URL('https://accounts.google.com/o/oauth2/auth');
      authorization.search = new URLSearchParams({ scope: READ_SCOPES.join(' '), client_id: 'synthetic-client', redirect_uri: 'https://secrets.activepieces.com/redirect' });
      return Response.json({ authorizationUrl: authorization.href });
    }
    if (url.pathname.endsWith('/app-connections')) return Response.json({ status: 'ACTIVE' });
    if (url.pathname.endsWith('/pieces/options')) return Response.json({ options: { options: [
      { label: 'S4 synthetic', value: { id: 'synthetic-label', name: 'S4 synthetic' } },
      { label: 'INBOX', value: { id: 'INBOX', name: 'INBOX' } },
    ] } });
    if (url.pathname.endsWith('/flows')) return Response.json({ id: 'synthetic-flow', version: { id: 'synthetic-version' } });
    if (url.pathname.endsWith('/flows/synthetic-flow')) return Response.json({ id: 'synthetic-flow', version: { id: 'synthetic-version' } });
    if (url.pathname.endsWith('/test-step')) return Response.json({ id: 'synthetic-run' });
    if (url.pathname.endsWith('/flow-runs/synthetic-run')) return Response.json({ status: 'SUCCEEDED', steps: {
      read_synthetic: { status: 'SUCCEEDED', output: { found: true, results: { count: sampleCount, messages: Array.from({ length: sampleCount }, () => messageFailure ? { error: 'Failed to retrieve message details' } : { text: 'Synthetic source content' }) } } },
    } });
    if (url.pathname.endsWith('/sample-data')) return Response.json({});
    throw new Error('unexpected_test_route');
  };
  return { requests, session: new ManagedGmailSession({ fetch }), setCount: count => { sampleCount = count; }, failMessages: () => { messageFailure = true; } };
}

test('provisions a separate local identity and connects through shared read-only OAuth', async () => {
  const { session, requests } = fixture();
  const attempt = await session.begin();
  assert.equal(new URL(attempt.authorizationUrl).hostname, 'accounts.google.com');
  const result = await session.complete({ attemptId: attempt.attemptId, code: 'synthetic-code' });
  assert.deepEqual(result, [{ id: 'synthetic-label', name: 'S4 synthetic' }]);
  const signup = requests.find(request => request.url.pathname.endsWith('/sign-up'));
  assert.equal(signup.body.trackEvents, false);
  assert.equal(signup.body.newsLetter, false);
  assert.ok(signup.body.email.endsWith('@example.invalid'));
  const connection = requests.find(request => request.url.pathname.endsWith('/app-connections'));
  assert.equal(connection.body.type, 'CLOUD_OAUTH2');
  assert.equal(connection.body.value.scope, READ_SCOPES.join(' '));
  assert.equal(JSON.stringify(result).includes('synthetic-local-session'), false);
  await assert.rejects(session.complete({ attemptId: attempt.attemptId, code: 'replayed-code' }), /sign_in_expired/);
});

test('runs only a fixed bounded read and returns counts, never mail content', async () => {
  const { session, requests } = fixture();
  const attempt = await session.begin();
  await session.complete({ ...attempt, code: 'synthetic-code' });
  await assert.rejects(session.read('INBOX'), /choose_test_label/);
  const result = await session.read('synthetic-label');
  assert.deepEqual(result, { messages: 3, pages: 1 });
  const action = requests.find(request => request.body?.type === 'ADD_ACTION').body.request.action;
  assert.equal(action.settings.actionName, 'gmail_search_mail');
  assert.equal(action.settings.input.max_results, 3);
  assert.equal(action.settings.input.label.id, 'synthetic-label');
  assert.equal(requests.some(request => request.body?.type === 'LOCK_AND_PUBLISH'), false);
});

test('rejects unexpected counts and invalid OAuth attempts', async () => {
  const { session, setCount } = fixture();
  const attempt = await session.begin();
  await assert.rejects(session.complete({ attemptId: 'unrelated', code: 'synthetic-code' }), /sign_in_expired/);
  await session.complete({ ...attempt, code: 'synthetic-code' });
  setCount(4);
  await assert.rejects(session.read('synthetic-label'), /invalid_read_result/);
});

test('does not count per-message retrieval failures as successful reads', async () => {
  const { session, failMessages } = fixture();
  const attempt = await session.begin();
  await session.complete({ ...attempt, code: 'synthetic-code' });
  failMessages();
  await assert.rejects(session.read('synthetic-label'), /invalid_read_result/);
});

test('accepts OAuth replies only from the opened window and hosted redirect origin', () => {
  const popup = {};
  assert.equal(acceptsOAuthReply({ origin: 'https://secrets.activepieces.com', source: popup, data: { code: 'synthetic-code' } }, popup), true);
  assert.equal(acceptsOAuthReply({ origin: 'https://other.invalid', source: popup, data: { code: 'synthetic-code' } }, popup), false);
  assert.equal(acceptsOAuthReply({ origin: 'https://secrets.activepieces.com', source: {}, data: { code: 'synthetic-code' } }, popup), false);
  assert.equal(acceptsOAuthReply({ origin: 'https://secrets.activepieces.com', source: popup, data: { code: '' } }, popup), false);
});
