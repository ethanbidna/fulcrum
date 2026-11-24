import { describe, expect, it, vi } from 'vitest';
import { ManagedConnections, type ManagedRuntimeIdentity } from './client.js';
import { HOSTED_OAUTH_REDIRECT, MANAGED_SOURCE_IDS, MANAGED_SOURCE_POLICIES } from './policy.js';

const ORIGIN = 'http://127.0.0.1:18082';
const identity: ManagedRuntimeIdentity = { origin: ORIGIN, email: 'local@example.invalid', password: 'synthetic-password', provisioned: true };
const session = { token: 'synthetic-runtime-token', projectId: 'synthetic-project' };
function fixture(saved: ManagedRuntimeIdentity | null = null) {
  let stored = saved;
  let now = 0;
  const writes: ManagedRuntimeIdentity[] = [];
  const requests: { route: string; body: Record<string, unknown>; init: RequestInit }[] = [];
  const secrets = { read: vi.fn(async () => stored), write: vi.fn(async (value: ManagedRuntimeIdentity) => {
    stored = structuredClone(value); writes.push(structuredClone(value));
  }) };
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const route = String(input);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ route, body, init });
    if (route.startsWith('https://secrets.activepieces.com/apps')) {
      return response(Object.fromEntries(MANAGED_SOURCE_IDS.map(source => [MANAGED_SOURCE_POLICIES[source].pieceName, { clientId: 'synthetic-client' }])));
    }
    if (route.includes('/authentication/')) return response(session);
    if (route.endsWith('/authorization-url')) {
      const policy = Object.values(MANAGED_SOURCE_POLICIES).find(policy => policy.pieceName === body.pieceName);
      if (!policy || policy.kind !== 'oauth') throw new Error('unexpected_source');
      const url = new URL(policy.authorizationPaths[0]!, policy.authorizationOrigin);
      url.search = new URLSearchParams({ response_type: 'code', client_id: 'synthetic-client', redirect_uri: HOSTED_OAUTH_REDIRECT, scope: (body.scopes as string[]).join(' ') }).toString();
      if (policy.pieceName.endsWith('slack')) url.searchParams.set('user_scope', 'chat:write');
      return response({ authorizationUrl: url.href, codeVerifier: 'synthetic-verifier' });
    }
    if (route.endsWith('/app-connections')) {
      return response({ id: 'synthetic-connection', externalId: body.externalId, pieceName: body.pieceName, projectId: session.projectId, scope: 'PROJECT', status: 'ACTIVE', value: { access_token: 'must-not-return' } });
    }
    throw new Error('unexpected_route');
  });
  const create = () => new ManagedConnections({ origin: ORIGIN, namespace: 'synthetic-workspace', secrets, fetcher: fetcher as typeof fetch, now: () => now });
  return { client: create(), create, fetcher, secrets, requests, writes, response, advance: () => { now += 5 * 60_000; } };
}

describe('managed connections', () => {
  for (const source of MANAGED_SOURCE_IDS.filter(source => source !== 'granola')) {
    it(`connects ${source} without flow execution or browser credentials`, async () => {
      const test = fixture();
      const begin = await test.client.begin(source);
      expect(Object.keys(begin).sort()).toEqual(['attemptId', 'authorizationUrl']);
      expect(new URL(begin.authorizationUrl).searchParams.has('user_scope')).toBe(false);
      const connected = await test.client.complete(begin.attemptId, 'synthetic-code');
      expect(connected).toEqual({ id: 'synthetic-connection', source, ingestion: 'blocked' });
      const save = test.requests.at(-1)!;
      expect(save.body.value).toMatchObject({ code_challenge: 'synthetic-verifier' });
      expect(test.requests.every(request => !/flow|sample-data|mcp|run-action/.test(request.route))).toBe(true);
      expect(JSON.stringify(connected)).not.toContain('must-not-return');
      expect(test.requests.every(request => request.init.redirect === 'error')).toBe(true);
    });
  }
  it('saves identity before signup and reuses it after restart', async () => {
    const test = fixture();
    await test.client.begin('gmail');
    expect(test.writes[0]?.provisioned).toBe(false);
    expect(test.writes[1]?.provisioned).toBe(true);
    expect(test.secrets.write.mock.invocationCallOrder[0]).toBeLessThan(test.fetcher.mock.invocationCallOrder[1]!);
    await test.create().begin('gmail');
    expect(test.requests.filter(request => request.route.endsWith('/sign-up'))).toHaveLength(1);
    expect(test.requests.filter(request => request.route.endsWith('/sign-in'))).toHaveLength(1);
  });
  it('does not provision if secure storage fails', async () => {
    const test = fixture();
    test.secrets.write.mockRejectedValueOnce(new Error('keychain_denied'));
    await expect(test.client.begin('gmail')).rejects.toThrow('keychain_denied');
    expect(test.requests.filter(request => request.route.includes('/authentication/'))).toHaveLength(0);
  });
  it('shares initialization between simultaneous sources', async () => {
    const test = fixture();
    await Promise.all([test.client.begin('gmail'), test.client.begin('slack')]);
    expect(test.requests.filter(request => request.route.endsWith('/sign-up'))).toHaveLength(1);
  });
  it('never signs up again after a provisioned identity is rejected', async () => {
    const test = fixture(identity);
    const original = test.fetcher.getMockImplementation()!;
    test.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/sign-in')
      ? test.response({ secret: 'must-not-leak' }, 401) : original(input, init));
    await expect(test.client.begin('gmail')).rejects.toThrow('managed_runtime_request_failed');
    expect(test.requests.some(request => request.route.endsWith('/sign-up'))).toBe(false);
  });
  it('recovers an identity saved before interrupted provisioning', async () => {
    const test = fixture({ ...identity, provisioned: false });
    const original = test.fetcher.getMockImplementation()!;
    test.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/sign-in')
      ? test.response({}, 401) : original(input, init));
    await test.client.begin('gmail');
    expect(test.requests.filter(request => request.route.endsWith('/sign-up'))).toHaveLength(1);
    expect(test.writes.at(-1)?.provisioned).toBe(true);
  });
  it('refuses a runtime identity bound to a different origin', async () => {
    const test = fixture({ ...identity, origin: 'http://127.0.0.1:18083' });
    await expect(test.client.begin('gmail')).rejects.toThrow('runtime_identity_mismatch');
    expect(test.requests.filter(request => request.route.startsWith(ORIGIN))).toHaveLength(0);
  });
  it('does not reuse cancelled, superseded or expired attempts', async () => {
    const test = fixture();
    const old = await test.client.begin('gmail');
    const current = await test.client.begin('gmail');
    await expect(test.client.complete(old.attemptId, 'synthetic')).rejects.toThrow('source_sign_in_expired');
    test.client.cancel(current.attemptId);
    await expect(test.client.complete(current.attemptId, 'synthetic')).rejects.toThrow('source_sign_in_expired');
    const expired = await test.client.begin('slack'); test.advance();
    await expect(test.client.complete(expired.attemptId, 'synthetic')).rejects.toThrow('source_sign_in_expired');
  });
  it('consumes the code even when connection saving fails', async () => {
    const test = fixture();
    const begin = await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ secret: 'must-not-leak' }, 500));
    await expect(test.client.complete(begin.attemptId, 'synthetic')).rejects.toThrow('managed_runtime_request_failed');
    await expect(test.client.complete(begin.attemptId, 'synthetic')).rejects.toThrow('source_sign_in_expired');
  });
  it('handles expired sessions with one sign-in and retry', async () => {
    const test = fixture(identity);
    const begin = await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({}, 401));
    await test.client.complete(begin.attemptId, 'synthetic');
    expect(test.requests.filter(request => request.route.endsWith('/sign-in'))).toHaveLength(2);
  });
  it('disconnects only the expected project connection and cancels its pending sign-in', async () => {
    const test = fixture(identity);
    const begin = await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ id: 'synthetic-connection', externalId: 'fulcrum-synthetic-workspace-gmail', pieceName: '@activepieces/piece-gmail', projectId: session.projectId, scope: 'PROJECT', status: 'ERROR' }));
    test.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await test.client.disconnect('gmail', 'synthetic-connection');
    expect(test.fetcher.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
    await expect(test.client.complete(begin.attemptId, 'synthetic')).rejects.toThrow('source_sign_in_expired');
  });
  it.each([
    { externalId: 'another-connection' }, { projectId: 'another-project' },
    { scope: 'PLATFORM' }, { pieceName: '@activepieces/piece-slack' }, { id: 'another-id' },
  ])('refuses to delete mismatched connection metadata %o', async mismatch => {
    const test = fixture(identity);
    await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ id: 'synthetic-connection', externalId: 'fulcrum-synthetic-workspace-gmail', pieceName: '@activepieces/piece-gmail', projectId: session.projectId, scope: 'PROJECT', ...mismatch }));
    await expect(test.client.disconnect('gmail', 'synthetic-connection')).rejects.toThrow('source_connection_mismatch');
    expect(test.fetcher.mock.calls.at(-1)?.[1]?.method).toBe('GET');
  });
  it('recovers only this workspace connection through bounded metadata lookup', async () => {
    const test = fixture(identity);
    await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ data: [{ id: 'other', externalId: 'another-workspace' }], next: 'page-2' }));
    test.fetcher.mockResolvedValueOnce(test.response({ data: [{ id: 'own', externalId: 'fulcrum-synthetic-workspace-gmail', pieceName: '@activepieces/piece-gmail', projectId: session.projectId, scope: 'PROJECT', status: 'ACTIVE', value: 'must-not-return' }], next: null }));
    expect(await test.client.lookup('gmail')).toEqual({ connection: { id: 'own', source: 'gmail', ingestion: 'blocked' }, active: true });
    const request = String(test.fetcher.mock.calls.at(-1)?.[0]);
    expect(new URL(request).searchParams.get('cursor')).toBe('page-2');
    expect(new URL(request).searchParams.get('pieceName')).toBe('@activepieces/piece-gmail');
  });
  it.each([{ projectId: 'foreign-project' }, { pieceName: '@activepieces/piece-slack' }, { scope: 'PLATFORM' }])('rejects recovered metadata from a different owner %o', async mismatch => {
    const test = fixture(identity); await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ data: [{ id: 'own', externalId: 'fulcrum-synthetic-workspace-gmail', pieceName: '@activepieces/piece-gmail', projectId: session.projectId, scope: 'PROJECT', status: 'ACTIVE', ...mismatch }], next: null }));
    await expect(test.client.lookup('gmail')).rejects.toThrow('source_connection_mismatch');
  });
  it('fails closed at the metadata page limit instead of assuming no connection exists', async () => {
    const test = fixture(identity); await test.client.begin('gmail');
    for (let page = 0; page < 10; page++) test.fetcher.mockResolvedValueOnce(test.response({ data: [], next: `page-${page}` }));
    await expect(test.client.lookup('gmail')).rejects.toThrow('connection_lookup_limit');
  });
  it('returns null only after the metadata result ends', async () => {
    const test = fixture(identity); await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ data: [], next: null }));
    expect(await test.client.lookup('gmail')).toBeNull();
  });
  it('rejects a repeated metadata cursor', async () => {
    const test = fixture(identity); await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ data: [], next: 'repeat' }));
    test.fetcher.mockResolvedValueOnce(test.response({ data: [], next: 'repeat' }));
    await expect(test.client.lookup('gmail')).rejects.toThrow('invalid_runtime_response');
  });
  it('stores a Granola API key only in the local connection request', async () => {
    const test = fixture();
    const connected = await test.client.connectGranola('synthetic-granola-key');
    expect(connected.source).toBe('granola');
    expect(test.requests.at(-1)?.body.value).toEqual({ type: 'SECRET_TEXT', secret_text: 'synthetic-granola-key' });
    expect(JSON.stringify(test.writes)).not.toContain('synthetic-granola-key');
    await expect(test.client.begin('granola')).rejects.toThrow('source_requires_api_key');
  });
  it.each(['', ' ', 'synthetic\nkey', 'x'.repeat(4097)])('rejects malformed keys before network access', async key => {
    const test = fixture();
    await expect(test.client.connectGranola(key)).rejects.toThrow('invalid_source_key');
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it('rejects inactive connections without exposing provider data', async () => {
    const test = fixture();
    const begin = await test.client.begin('gmail');
    test.fetcher.mockResolvedValueOnce(test.response({ id: 'connection', externalId: 'fulcrum-synthetic-workspace-gmail', pieceName: '@activepieces/piece-gmail', status: 'ERROR', secret: 'must-not-leak' }));
    await expect(test.client.complete(begin.attemptId, 'synthetic')).rejects.toThrow('source_connection_not_active');
  });
  it('fails closed when a shared OAuth app is unavailable', async () => {
    const test = fixture(); test.fetcher.mockResolvedValueOnce(test.response({}));
    await expect(test.client.begin('dropbox')).rejects.toThrow('shared_oauth_unavailable');
    expect(test.requests).toHaveLength(0);
  });
  it('bounds runtime response bodies', async () => {
    const test = fixture(); test.fetcher.mockResolvedValueOnce(test.response({ data: 'x'.repeat(512 * 1024) }));
    await expect(test.client.begin('gmail')).rejects.toThrow('runtime_response_too_large');
  });
  it.each(['https://127.0.0.1:18082', 'http://localhost:18082', 'http://example.invalid:18082', 'http://127.0.0.1', 'http://127.0.0.1:18082/path'])('rejects an unowned runtime address %s', origin => {
    const test = fixture();
    expect(() => new ManagedConnections({ origin, namespace: 'synthetic', secrets: test.secrets })).toThrow('loopback_runtime_required');
  });
});
