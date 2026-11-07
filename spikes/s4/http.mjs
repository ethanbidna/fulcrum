const TIMEOUT_MS = 30_000;
const ROOTS = { slack: 'https://slack.com/api/', gmail: 'https://gmail.googleapis.com/gmail/v1/users/me/' };
const SLACK_ROUTES = new Set(['conversations.history', 'conversations.replies', 'chat.getPermalink']);
const SAFE_ERRORS = new Set(['missing_scope', 'invalid_auth', 'token_revoked', 'token_expired', 'not_in_channel', 'channel_not_found', 'thread_not_found']);

export class ProbeError extends Error {
  constructor(code, retryAfterSeconds = null) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function allowedRoute(provider, route) {
  if (provider === 'slack') return SLACK_ROUTES.has(route);
  return provider === 'gmail' && /^(profile|messages|history|(messages|threads)\/[A-Za-z0-9_-]+)$/.test(route);
}

export class ApiClient {
  constructor(provider, token, fetcher = fetch) {
    if (!ROOTS[provider] || !token) throw new ProbeError('configuration_required');
    this.provider = provider;
    this.token = token;
    this.fetcher = fetcher;
    this.calls = 0;
  }

  async get(route, query = {}) {
    if (!allowedRoute(this.provider, route)) throw new ProbeError('route_denied');
    const url = new URL(route, ROOTS[this.provider]);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    this.calls++;
    let response;
    try {
      response = await this.fetcher(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch { throw new ProbeError('network_or_timeout'); }
    if (!response.ok) throw responseError(this.provider, route, response);
    let body;
    try { body = await response.json(); } catch { throw new ProbeError('invalid_response'); }
    if (this.provider === 'slack' && body.ok === false) throw new ProbeError(SAFE_ERRORS.has(body.error) ? body.error : 'provider_rejected');
    return body;
  }
}

function responseError(provider, route, response) {
  if (response.status === 429) {
    const header = response.headers?.get('retry-after');
    const retry = header && /^\d+$/.test(header) ? Number(header) : null;
    return new ProbeError('rate_limited', retry);
  }
  if (response.status === 401) return new ProbeError('needs_reconnect');
  if (response.status === 403) return new ProbeError('permission_or_quota_denied');
  if (provider === 'gmail' && route === 'history' && response.status === 404) return new ProbeError('history_expired');
  return new ProbeError('provider_http_error');
}

export async function refreshGoogle(environment, fetcher = fetch) {
  const keys = ['GMAIL_TEST_CLIENT_ID', 'GMAIL_TEST_CLIENT_SECRET', 'GMAIL_TEST_REFRESH_TOKEN'];
  if (keys.some(key => !environment[key])) throw new ProbeError('refresh_configuration_required');
  const body = new URLSearchParams({ client_id: environment.GMAIL_TEST_CLIENT_ID, client_secret: environment.GMAIL_TEST_CLIENT_SECRET,
    refresh_token: environment.GMAIL_TEST_REFRESH_TOKEN, grant_type: 'refresh_token' });
  let response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (typeof result.access_token !== 'string' || !result.access_token) throw new Error();
    return result.access_token;
  } catch { throw new ProbeError('refresh_failed'); }
}
