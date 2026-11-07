import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ProbeError, refreshGoogle } from '../../spikes/s4/http.mjs';
import { probeSlack, probeGmail } from '../../spikes/s4/probes.mjs';

test('S4 confines HTTP to read-only provider routes and keeps tokens out of URLs', async () => {
  let request;
  const client = new ApiClient('slack', 'synthetic-secret', async (url, options) => {
    request = { url: String(url), ...options };
    return { ok: true, json: async () => ({ ok: true, messages: [] }) };
  });
  await client.get('conversations.history', { channel: 'C_SYNTHETIC' });
  assert.equal(request.headers.Authorization, 'Bearer synthetic-secret');
  assert.equal(request.redirect, 'error');
  assert.equal(request.url.includes('synthetic-secret'), false);
  await assert.rejects(client.get('chat.postMessage', {}), ProbeError);
  await assert.rejects(client.get('https://untrusted.invalid/', {}), ProbeError);
});

test('S4 exposes retry delays and safe auth errors without logging response content', async () => {
  const client = new ApiClient('slack', 'synthetic-secret', async () => ({
    ok: false, status: 429, headers: new Headers({ 'retry-after': '60' }),
  }));
  await assert.rejects(client.get('conversations.history'), error => error.code === 'rate_limited' && error.retryAfterSeconds === 60);
  const denied = new ApiClient('slack', 'synthetic-secret', async () => ({ ok: true, json: async () => ({ ok: false, error: 'private account content' }) }));
  await assert.rejects(denied.get('conversations.history'), error => error.code === 'provider_rejected' && !error.message.includes('private account'));
});

test('S4 Slack probes pagination, replies and exact permalinks without converting timestamps to numbers', async () => {
  const calls = [];
  const client = { get: async (route, query) => {
    calls.push({ route, query });
    if (route === 'conversations.history') return query.cursor
      ? { messages: [{ ts: '1794000000.000002' }], response_metadata: {} }
      : { messages: [{ ts: '1794000000.000001', reply_count: 1 }], response_metadata: { next_cursor: 'page-two' } };
    if (route === 'conversations.replies') return { messages: [{ ts: '1794000000.000001' }, { ts: '1794000001.000001' }] };
    return { permalink: 'https://synthetic.slack.com/archives/C_SYNTHETIC/p1794000000000001' };
  } };
  const result = await probeSlack(client, { channel: 'C_SYNTHETIC', oldest: '1793900000', latest: '1794100000' });
  assert.equal(result.summary.historyMessages, 2);
  assert.equal(result.summary.threadMessages, 2);
  assert.equal(result.summary.messagePermalink, true);
  assert.equal(calls[1].query.cursor, 'page-two');
  assert.equal(calls.find(call => call.route === 'conversations.replies').query.ts, '1794000000.000001');
  assert.equal(JSON.stringify(result.summary).includes('C_SYNTHETIC'), false);
});

test('S4 page budget retains continuation and never claims complete backfill', async () => {
  const client = { get: async () => ({ messages: [], response_metadata: { next_cursor: 'more' } }) };
  const result = await probeSlack(client, { channel: 'C_SYNTHETIC', oldest: '1', latest: '2', maxPages: 1 });
  assert.equal(result.summary.historyComplete, false);
  assert.equal(result.continuation.historyCursor, 'more');
});

test('S4 Gmail snapshots history before backfill and applies label scope', async () => {
  const calls = [];
  const client = { get: async (route, query) => {
    calls.push({ route, query });
    if (route === 'profile') return { historyId: '90071992547409931234' };
    if (route === 'messages') return { messages: [{ id: 'synthetic-message', threadId: 'synthetic-thread' }] };
    if (route.startsWith('threads/')) return { messages: [{ id: 'synthetic-message', labelIds: ['Label_SYNTHETIC'] }] };
    return { id: 'synthetic-message', threadId: 'synthetic-thread', labelIds: ['Label_SYNTHETIC'], payload: { mimeType: 'text/plain', body: { data: 'U3ludGhldGlj' } } };
  } };
  const result = await probeGmail(client, { label: 'Label_SYNTHETIC', after: '1793900000' });
  assert.equal(calls[0].route, 'profile');
  assert.equal(calls[1].query.labelIds, 'Label_SYNTHETIC');
  assert.equal(result.continuation.historyId, '90071992547409931234');
  assert.equal(result.summary.messagesRead, 1);
  assert.equal(result.summary.bodyAvailable, true);
  assert.equal(result.summary.threadRetrieval, true);
  assert.equal(result.summary.messagePermalink, null);
  assert.equal(JSON.stringify(result.summary).includes('synthetic-message'), false);
});

test('S4 Gmail expired history requires resync, never replaces the cursor with current history', async () => {
  const client = { get: async route => {
    assert.equal(route, 'history');
    throw new ProbeError('history_expired');
  } };
  await assert.rejects(probeGmail(client, { label: 'Label_SYNTHETIC', historyId: '123' }), error => error.code === 'history_expired');
});

test('S4 Gmail history pagination keeps original startHistoryId until all pages finish', async () => {
  const calls = [];
  const client = { get: async (route, query) => {
    calls.push(query);
    return query.pageToken ? { history: [], historyId: '130' } : { history: [], historyId: '129', nextPageToken: 'page-two' };
  } };
  const result = await probeGmail(client, { label: 'Label_SYNTHETIC', historyId: '123' });
  assert.equal(calls[0].startHistoryId, '123');
  assert.equal(calls[1].startHistoryId, '123');
  assert.equal(result.continuation.historyId, '130');
});

test('S4 Slack resumes an unfinished thread without restarting completed history', async () => {
  const client = { get: async (route, query) => {
    assert.notEqual(route, 'conversations.history');
    if (route === 'conversations.replies') {
      assert.equal(query.cursor, 'thread-page-two');
      return { messages: [] };
    }
    return {};
  } };
  const result = await probeSlack(client, { channel: 'C_SYNTHETIC', oldest: '1', latest: '2', historyCursor: null, threadTs: '1.000001', threadCursor: 'thread-page-two' });
  assert.equal(result.summary.threadComplete, true);
});

test('S4 refresh is provider-fixed, env-only, and returns no raw failure content', async () => {
  const environment = { GMAIL_TEST_CLIENT_ID: 'synthetic-id', GMAIL_TEST_CLIENT_SECRET: 'synthetic-secret', GMAIL_TEST_REFRESH_TOKEN: 'synthetic-refresh' };
  const token = await refreshGoogle(environment, async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    return { ok: true, json: async () => ({ access_token: 'synthetic-access' }) };
  });
  assert.equal(token, 'synthetic-access');
  await assert.rejects(refreshGoogle(environment, async () => { throw new Error('synthetic-secret'); }), error => error.message === 'refresh_failed');
});
