import { describe, expect, it } from 'vitest';
import { HOSTED_OAUTH_REDIRECT, MANAGED_SOURCE_IDS, MANAGED_SOURCE_POLICIES, readonlyAuthorizationUrl } from './policy.js';

function authorization(source: typeof MANAGED_SOURCE_IDS[number]) {
  const policy = MANAGED_SOURCE_POLICIES[source];
  if (policy.kind !== 'oauth') throw new Error('key_source');
  const url = new URL(policy.authorizationPaths[0]!, policy.authorizationOrigin);
  url.search = new URLSearchParams({ response_type: 'code', client_id: 'synthetic-client', redirect_uri: HOSTED_OAUTH_REDIRECT, scope: policy.scopes.join(' ') }).toString();
  return url;
}

describe('managed source permission boundary', () => {
  it('includes exactly the six requested services', () => {
    expect(MANAGED_SOURCE_IDS).toEqual(['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar']);
    expect(MANAGED_SOURCE_POLICIES.granola.kind).toBe('api_key');
  });
  for (const source of MANAGED_SOURCE_IDS.filter(source => source !== 'granola')) {
    it(`accepts the exact ${source} read request`, () => {
      const url = authorization(source);
      expect(readonlyAuthorizationUrl(source, url.href, 'synthetic-client').href).toBe(url.href);
    });
    it(`rejects extra permissions and duplicate parameters for ${source}`, () => {
      const url = authorization(source);
      url.searchParams.append('scope', 'write');
      expect(() => readonlyAuthorizationUrl(source, url.href, 'synthetic-client')).toThrow('unexpected_oauth_request');
      url.searchParams.set('scope', `${url.searchParams.get('scope')} write`);
      expect(() => readonlyAuthorizationUrl(source, url.href, 'synthetic-client')).toThrow('unexpected_oauth_request');
    });
  }
  it('removes Slack user grants embedded by the stock piece', () => {
    const url = authorization('slack');
    url.searchParams.append('user_scope', 'chat:write,users.profile:write');
    url.searchParams.append('user_scope', 'channels:write');
    const checked = readonlyAuthorizationUrl('slack', url.href, 'synthetic-client');
    expect(checked.searchParams.has('user_scope')).toBe(false);
    expect(checked.searchParams.get('scope')).not.toContain('write');
  });
  it.each(['client_id', 'redirect_uri'])('rejects a duplicate %s', key => {
    const url = authorization('gmail');
    url.searchParams.append(key, 'unexpected');
    expect(() => readonlyAuthorizationUrl('gmail', url.href, 'synthetic-client')).toThrow();
  });
  it('rejects other hosts, paths, credentials and incremental broad grants', () => {
    for (const mutate of [
      (url: URL) => { url.searchParams.set('response_type', 'token'); },
      (url: URL) => { url.hostname = 'example.invalid'; },
      (url: URL) => { url.pathname = '/unexpected'; },
      (url: URL) => { url.username = 'synthetic'; },
      (url: URL) => { url.searchParams.set('include_granted_scopes', 'true'); },
    ]) {
      const url = authorization('gmail'); mutate(url);
      expect(() => readonlyAuthorizationUrl('gmail', url.href, 'synthetic-client')).toThrow();
    }
  });
});
