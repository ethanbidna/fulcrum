import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { allowedMutation, proofHandler } from './server.mjs';

const headers = { host: 'localhost:18081', origin: 'http://localhost:18081', 'content-type': 'application/json' };

test('requires exact loopback host, same origin and JSON for mutations', () => {
  assert.equal(allowedMutation({ method: 'POST', headers }), true);
  assert.equal(allowedMutation({ method: 'POST', headers: { ...headers, origin: 'https://other.invalid' } }), false);
  assert.equal(allowedMutation({ method: 'POST', headers: { ...headers, host: 'other.invalid' } }), false);
  assert.equal(allowedMutation({ method: 'POST', headers: { ...headers, 'content-type': 'text/plain' } }), false);
  assert.equal(allowedMutation({ method: 'GET', headers }), false);
});

test('offers fixed proof routes without proxying arbitrary Activepieces actions', async () => {
  let called = false;
  const handler = proofHandler({ session: { begin: async () => { called = true; return { attemptId: 'synthetic-attempt' }; } }, assets: {} });
  const response = () => ({ status: 200, text: '', setHeader() {}, writeHead(status) { this.status = status; return this; }, end(text) { this.text = text; return this; } });
  const request = Readable.from(['{}']);
  Object.assign(request, { method: 'POST', url: '/api/execute-anything', headers });
  const rejected = response();
  await handler(request, rejected);
  assert.equal(rejected.status, 404);
  assert.equal(called, false);
  const accepted = Readable.from(['{}']);
  Object.assign(accepted, { method: 'POST', url: '/api/begin', headers });
  const result = response();
  await handler(accepted, result);
  assert.equal(result.status, 200);
  assert.equal(called, true);
  assert.equal(JSON.parse(result.text).attemptId, 'synthetic-attempt');
});
