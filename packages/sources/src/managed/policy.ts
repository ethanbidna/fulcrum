export const MANAGED_SOURCE_IDS = ['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'] as const;
export type ManagedSourceId = typeof MANAGED_SOURCE_IDS[number];
export const HOSTED_OAUTH_ORIGIN = 'https://secrets.activepieces.com';
export const HOSTED_OAUTH_REDIRECT = `${HOSTED_OAUTH_ORIGIN}/redirect`;

interface OAuthPolicy {
  kind: 'oauth';
  pieceName: string;
  pieceVersion: string;
  authorizationOrigin: string;
  authorizationPaths: readonly string[];
  scopes: readonly string[];
}
interface KeyPolicy { kind: 'api_key'; pieceName: string; pieceVersion: string }
export type ManagedSourcePolicy = OAuthPolicy | KeyPolicy;

const GOOGLE_ORIGIN = 'https://accounts.google.com';
const GOOGLE_PATHS = ['/o/oauth2/auth', '/o/oauth2/v2/auth'];
export const MANAGED_SOURCE_POLICIES: Readonly<Record<ManagedSourceId, ManagedSourcePolicy>> = {
  gmail: {
    kind: 'oauth', pieceName: '@activepieces/piece-gmail', pieceVersion: '0.19.0',
    authorizationOrigin: GOOGLE_ORIGIN, authorizationPaths: GOOGLE_PATHS,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'email'],
  },
  slack: {
    kind: 'oauth', pieceName: '@activepieces/piece-slack', pieceVersion: '0.23.1',
    authorizationOrigin: 'https://slack.com', authorizationPaths: ['/oauth/v2/authorize'],
    scopes: ['channels:read', 'channels:history', 'users:read', 'users:read.email'],
  },
  granola: { kind: 'api_key', pieceName: '@activepieces/piece-granola', pieceVersion: '0.1.3' },
  google_drive: {
    kind: 'oauth', pieceName: '@activepieces/piece-google-drive', pieceVersion: '0.13.3',
    authorizationOrigin: GOOGLE_ORIGIN, authorizationPaths: GOOGLE_PATHS,
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'email'],
  },
  dropbox: {
    kind: 'oauth', pieceName: '@activepieces/piece-dropbox', pieceVersion: '0.10.2',
    authorizationOrigin: 'https://www.dropbox.com', authorizationPaths: ['/oauth2/authorize'],
    scopes: ['files.metadata.read', 'files.content.read'],
  },
  google_calendar: {
    kind: 'oauth', pieceName: '@activepieces/piece-google-calendar', pieceVersion: '0.13.4',
    authorizationOrigin: GOOGLE_ORIGIN, authorizationPaths: GOOGLE_PATHS,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'email'],
  },
};

function exactlyOne(parameters: URLSearchParams, key: string): string {
  const values = parameters.getAll(key);
  if (values.length !== 1 || !values[0]) throw new Error('unexpected_oauth_request');
  return values[0];
}

function sameScopes(actual: string, expected: readonly string[]): boolean {
  const scopes = actual.split(/[ ,]+/).filter(Boolean);
  return scopes.length === expected.length && new Set(scopes).size === scopes.length
    && scopes.every(scope => expected.includes(scope));
}

export function readonlyAuthorizationUrl(source: ManagedSourceId, value: string, clientId: string): URL {
  const policy = MANAGED_SOURCE_POLICIES[source];
  if (policy.kind !== 'oauth') throw new Error('source_requires_api_key');
  const url = new URL(value);
  if (url.origin !== policy.authorizationOrigin || !policy.authorizationPaths.includes(url.pathname)
    || url.username || url.password || url.hash
    || exactlyOne(url.searchParams, 'response_type') !== 'code'
    || exactlyOne(url.searchParams, 'client_id') !== clientId
    || exactlyOne(url.searchParams, 'redirect_uri') !== HOSTED_OAUTH_REDIRECT
    || !sameScopes(exactlyOne(url.searchParams, 'scope'), policy.scopes)) {
    throw new Error('unexpected_oauth_request');
  }
  // The stock Slack auth URL embeds separate user permissions, including writes.
  if (source === 'slack') url.searchParams.delete('user_scope');
  else if (url.searchParams.has('user_scope')) throw new Error('unexpected_oauth_request');
  if (url.searchParams.has('include_granted_scopes') && url.searchParams.get('include_granted_scopes') !== 'false') {
    throw new Error('unexpected_oauth_request');
  }
  return url;
}
