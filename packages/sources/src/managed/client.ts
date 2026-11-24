import { randomBytes, randomUUID } from 'node:crypto';
import {
  HOSTED_OAUTH_ORIGIN, HOSTED_OAUTH_REDIRECT, MANAGED_SOURCE_POLICIES,
  readonlyAuthorizationUrl, type ManagedSourceId,
} from './policy.js';

const REQUEST_TIMEOUT_MS = 30_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const MAX_CODE_LENGTH = 8192;
const MAX_API_KEY_LENGTH = 4096;
const MAX_JSON_BYTES = 512 * 1024;

export interface ManagedRuntimeIdentity {
  origin: string;
  email: string;
  password: string;
  provisioned: boolean;
}
/** Implemented by the native secure-store driver, never workspace preferences. */
export interface ManagedRuntimeSecrets {
  read(): Promise<ManagedRuntimeIdentity | null>;
  write(identity: ManagedRuntimeIdentity): Promise<void>;
}
export interface ManagedConnection {
  id: string;
  source: ManagedSourceId;
  ingestion: 'blocked';
}
interface Session { token: string; projectId: string }
interface Attempt { source: ManagedSourceId; clientId: string; expires: number; codeVerifier?: string }
interface ClientOptions {
  origin: string;
  namespace: string;
  secrets: ManagedRuntimeSecrets;
  fetcher?: typeof fetch;
  now?: () => number;
}

class RuntimeRequestError extends Error {
  constructor(readonly status: number) { super('managed_runtime_request_failed'); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_runtime_response');
  return value as Record<string, unknown>;
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('invalid_runtime_response');
  return value;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('invalid_runtime_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_JSON_BYTES) throw new Error('runtime_response_too_large');
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new Error('invalid_runtime_response'); }
  } finally { await reader.cancel(); }
}
function runtimeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('loopback_runtime_required');
  }
  return url.origin;
}

export class ManagedConnections {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private session: Session | undefined;
  private initialization: Promise<void> | undefined;
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly options: ClientOptions) {
    this.origin = runtimeOrigin(options.origin);
    if (!/^[a-z0-9-]{1,80}$/.test(options.namespace)) throw new Error('invalid_connection_namespace');
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private async send(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<unknown> {
    const response = await this.fetcher(`${this.origin}/api/v1${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', ...(this.session ? { Authorization: `Bearer ${this.session.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RuntimeRequestError(response.status);
    }
    if (response.status === 204) return undefined;
    return boundedJson(response);
  }

  private async authenticate(): Promise<void> {
    const saved = await this.options.secrets.read();
    const identity = saved ?? {
      origin: this.origin, email: `fulcrum-${randomUUID()}@example.invalid`,
      password: randomBytes(32).toString('base64url'), provisioned: false,
    };
    if (identity.origin !== this.origin || !identity.email || !identity.password) throw new Error('runtime_identity_mismatch');
    if (!saved) await this.options.secrets.write(identity);
    let result: unknown;
    if (saved) {
      try { result = await this.send('/authentication/sign-in', { email: identity.email, password: identity.password }); }
      catch (error) {
        if (identity.provisioned || !(error instanceof RuntimeRequestError) || error.status !== 401) throw error;
      }
    }
    if (result === undefined) {
      result = await this.send('/authentication/sign-up', {
        email: identity.email, password: identity.password, firstName: 'Fulcrum', lastName: 'Local',
        trackEvents: false, newsLetter: false,
      });
    }
    const session = record(result);
    const next = { token: requiredString(session.token), projectId: requiredString(session.projectId) };
    await this.options.secrets.write({ ...identity, provisioned: true });
    this.session = next;
  }

  private async initialize(): Promise<void> {
    if (this.session) return;
    if (!this.initialization) this.initialization = this.authenticate().finally(() => { this.initialization = undefined; });
    await this.initialization;
  }

  private async request(route: string, body?: unknown, method?: string): Promise<unknown> {
    await this.initialize();
    try { return await this.send(route, body, method); }
    catch (error) {
      if (!(error instanceof RuntimeRequestError) || error.status !== 401) throw error;
      this.session = undefined;
      await this.initialize();
      return this.send(route, body, method);
    }
  }

  private externalId(source: ManagedSourceId): string { return `fulcrum-${this.options.namespace}-${source}`; }

  async begin(source: ManagedSourceId): Promise<{ attemptId: string; authorizationUrl: string }> {
    const policy = MANAGED_SOURCE_POLICIES[source];
    if (!policy || policy.kind !== 'oauth') throw new Error('source_requires_api_key');
    const catalogResponse = await this.fetcher(`${HOSTED_OAUTH_ORIGIN}/apps?edition=ce`, {
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!catalogResponse.ok) {
      await catalogResponse.body?.cancel();
      throw new Error('shared_oauth_unavailable');
    }
    const catalog = record(await boundedJson(catalogResponse));
    if (!catalog[policy.pieceName]) throw new Error('shared_oauth_unavailable');
    const clientId = requiredString(record(catalog[policy.pieceName]).clientId);
    await this.initialize();
    const result = record(await this.request('/app-connections/oauth2/authorization-url', {
      projectId: this.session!.projectId, pieceName: policy.pieceName, pieceVersion: policy.pieceVersion,
      clientId, redirectUrl: HOSTED_OAUTH_REDIRECT, props: {}, scopes: policy.scopes,
    }));
    const url = readonlyAuthorizationUrl(source, requiredString(result.authorizationUrl), clientId);
    const codeVerifier = result.codeVerifier === undefined ? undefined : requiredString(result.codeVerifier);
    for (const [id, attempt] of this.attempts) {
      if (attempt.expires <= this.now() || attempt.source === source) this.attempts.delete(id);
    }
    const attemptId = randomUUID();
    this.attempts.set(attemptId, { source, clientId, expires: this.now() + SIGN_IN_TIMEOUT_MS,
      ...(codeVerifier === undefined ? {} : { codeVerifier }) });
    return { attemptId, authorizationUrl: url.href };
  }

  async complete(attemptId: string, code: string): Promise<ManagedConnection> {
    const attempt = this.attempts.get(attemptId);
    this.attempts.delete(attemptId);
    if (!attempt || attempt.expires <= this.now()) throw new Error('source_sign_in_expired');
    if (typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH) throw new Error('invalid_oauth_reply');
    const policy = MANAGED_SOURCE_POLICIES[attempt.source];
    if (policy.kind !== 'oauth') throw new Error('source_requires_api_key');
    return this.save(attempt.source, 'CLOUD_OAUTH2', {
      type: 'CLOUD_OAUTH2', client_id: attempt.clientId, code, scope: policy.scopes.join(' '), props: {},
      ...(attempt.codeVerifier === undefined ? {} : { code_challenge: attempt.codeVerifier }),
    });
  }

  async connectGranola(apiKey: string): Promise<ManagedConnection> {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > MAX_API_KEY_LENGTH || /[\r\n]/.test(apiKey)) {
      throw new Error('invalid_source_key');
    }
    return this.save('granola', 'SECRET_TEXT', { type: 'SECRET_TEXT', secret_text: apiKey });
  }

  private async save(source: ManagedSourceId, type: string, value: unknown): Promise<ManagedConnection> {
    await this.initialize();
    const policy = MANAGED_SOURCE_POLICIES[source];
    const result = record(await this.request('/app-connections', {
      projectId: this.session!.projectId, externalId: this.externalId(source), displayName: `Fulcrum ${source}`,
      pieceName: policy.pieceName, pieceVersion: policy.pieceVersion, type, value,
    }));
    if (result.externalId !== this.externalId(source) || result.pieceName !== policy.pieceName || result.status !== 'ACTIVE') {
      throw new Error('source_connection_not_active');
    }
    return { id: requiredString(result.id), source, ingestion: 'blocked' };
  }

  async disconnect(source: ManagedSourceId, id: string): Promise<void> {
    const policy = MANAGED_SOURCE_POLICIES[source];
    if (!policy || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('source_connection_mismatch');
    for (const [attemptId, attempt] of this.attempts) {
      if (attempt.source === source) this.attempts.delete(attemptId);
    }
    const route = `/app-connections/${encodeURIComponent(id)}`;
    const connection = record(await this.request(route));
    if (connection.id !== id || connection.externalId !== this.externalId(source)
      || connection.pieceName !== policy.pieceName || connection.projectId !== this.session!.projectId
      || connection.scope !== 'PROJECT') throw new Error('source_connection_mismatch');
    await this.request(route, undefined, 'DELETE');
  }

  cancel(attemptId: string): void { this.attempts.delete(attemptId); }
}
