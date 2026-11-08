import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { localInferenceFetch } from '../../spikes/s2/experiments/transport.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('local transport waits for delayed headers within the caller deadline', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'POST');
    setTimeout(() => response.end('{"response":"saved"}'), 30);
  }, async url => {
    const response = await localInferenceFetch(url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(1000) });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { response: 'saved' });
  });
});

test('local transport honors cancellation and preserves HTTP failure details', async () => {
  await withServer(() => {}, async url => {
    await assert.rejects(localInferenceFetch(url, { signal: AbortSignal.timeout(20) }), /abort/i);
  });
  await withServer((request, response) => { response.writeHead(500); response.end('synthetic failure'); }, async url => {
    const response = await localInferenceFetch(url);
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'synthetic failure');
  });
  await assert.rejects(localInferenceFetch('https://example.com'), /loopback HTTP/);
});

test('local transport survives the native fetch five-minute header limit', {
  skip: process.env.FULCRUM_SLOW_HTTP_TEST !== '1', timeout: 340_000,
}, async () => {
  await withServer((request, response) => {
    const timer = setTimeout(() => response.end('{"response":"slow success"}'), 310_000);
    response.on('close', () => clearTimeout(timer));
  }, async url => {
    const native = fetch(url, { signal: AbortSignal.timeout(330_000) }).then(
      () => ({ failed: false }), error => ({ failed: true, code: error.cause?.code }));
    const response = await localInferenceFetch(url, { signal: AbortSignal.timeout(330_000) });
    assert.deepEqual(await response.json(), { response: 'slow success' });
    assert.deepEqual(await native, { failed: true, code: 'UND_ERR_HEADERS_TIMEOUT' });
  });
});

test('preload delegates unrelated traffic and rejects unsupported ports', async () => {
  const { installInferenceTransport } = await import('../../spikes/s2/experiments/transport.mjs');
  const previous = globalThis.fetch;
  let delegated;
  globalThis.fetch = async input => { delegated = input; return new Response('delegated'); };
  try {
    installInferenceTransport();
    assert.equal(await (await fetch('https://example.com')).text(), 'delegated');
    assert.equal(delegated, 'https://example.com');
    assert.throws(() => installInferenceTransport({ port: '22' }), /Unsupported/);
  } finally { globalThis.fetch = previous; }
});
