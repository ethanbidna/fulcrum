import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const API = 'http://localhost:18082/api/v1';
const GMAIL = '@activepieces/piece-gmail';
const PIECE_VERSION = '0.19.0';
const REDIRECT = 'https://secrets.activepieces.com/redirect';
const TEST_LABEL = 'S4 synthetic';
const READ_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const RUN_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 750;
const MAX_CODE_LENGTH = 8192;
export const READ_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'email'];

export class ManagedGmailSession {
  constructor({ fetch = globalThis.fetch, now = Date.now, sleep = delay } = {}) {
    this.fetch = fetch;
    this.now = now;
    this.sleep = sleep;
    this.labels = new Map();
    this.externalId = `fulcrum-s4-${randomUUID()}`;
  }

  async request(path, body) {
    const response = await this.fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`activepieces_request_failed_${response.status}`);
    return response.json();
  }

  async initialize() {
    if (this.token) return;
    const identity = await this.request('/authentication/sign-up', {
      email: `s4-${randomUUID()}@example.invalid`, password: `S4!${randomBytes(24).toString('base64url')}`,
      firstName: 'Synthetic', lastName: 'Reader', trackEvents: false, newsLetter: false,
    });
    if (!identity.token || !identity.projectId) throw new Error('local_identity_unavailable');
    this.token = identity.token;
    this.projectId = identity.projectId;
  }

  async begin() {
    await this.initialize();
    const catalog = await this.fetch('https://secrets.activepieces.com/apps?edition=ce', {
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!catalog.ok) throw new Error('shared_oauth_unavailable');
    this.clientId = (await catalog.json())[GMAIL]?.clientId;
    if (!this.clientId) throw new Error('shared_oauth_unavailable');
    const result = await this.request('/app-connections/oauth2/authorization-url', {
      projectId: this.projectId, pieceName: GMAIL, pieceVersion: PIECE_VERSION,
      clientId: this.clientId, redirectUrl: REDIRECT, props: {}, scopes: READ_SCOPES,
    });
    const url = new URL(result.authorizationUrl);
    const scopes = url.searchParams.get('scope')?.split(' ').sort();
    if (url.origin !== 'https://accounts.google.com' || url.searchParams.get('redirect_uri') !== REDIRECT
      || url.searchParams.get('client_id') !== this.clientId || JSON.stringify(scopes) !== JSON.stringify([...READ_SCOPES].sort())) {
      throw new Error('unexpected_oauth_request');
    }
    this.attempt = { id: randomUUID(), expires: this.now() + SIGN_IN_TIMEOUT_MS };
    return { authorizationUrl: url.href, attemptId: this.attempt.id };
  }

  async complete({ attemptId, code }) {
    if (!this.attempt || this.attempt.id !== attemptId || this.attempt.expires < this.now()) throw new Error('google_sign_in_expired');
    if (typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH) throw new Error('invalid_oauth_reply');
    this.attempt = undefined;
    await this.request('/app-connections', {
      projectId: this.projectId, externalId: this.externalId, displayName: 'Fulcrum dashboard-free test',
      pieceName: GMAIL, pieceVersion: PIECE_VERSION, type: 'CLOUD_OAUTH2',
      value: { type: 'CLOUD_OAUTH2', client_id: this.clientId, code, scope: READ_SCOPES.join(' '), props: {} },
    });
    const result = await this.request('/pieces/options', {
      projectId: this.projectId, pieceName: GMAIL, pieceVersion: PIECE_VERSION,
      actionOrTriggerName: 'gmail_search_mail', propertyName: 'label', input: { auth: this.authReference() },
    });
    const labels = result.options?.options;
    if (!Array.isArray(labels)) throw new Error('labels_unavailable');
    this.labels = new Map(labels.filter(label => label.value?.name === TEST_LABEL && typeof label.value.id === 'string')
      .map(label => [label.value.id, { id: label.value.id, name: TEST_LABEL }]));
    return [...this.labels.values()];
  }

  authReference() {
    return `{{connections['${this.externalId}']}}`;
  }

  async prepareRead(label) {
    if (!this.flow) this.flow = await this.request('/flows', { projectId: this.projectId, displayName: 'Fulcrum dashboard-free Gmail proof' });
    const action = {
      name: 'read_synthetic', displayName: 'Read synthetic mail', valid: true, type: 'PIECE',
      settings: { pieceName: GMAIL, pieceVersion: PIECE_VERSION, actionName: 'gmail_search_mail',
        input: { auth: this.authReference(), label, max_results: READ_LIMIT, include_spam_trash: false }, propertySettings: {} },
    };
    this.flow = await this.request(`/flows/${encodeURIComponent(this.flow.id)}`, this.actionAdded
      ? { type: 'UPDATE_ACTION', request: action }
      : { type: 'ADD_ACTION', request: { parentStep: 'trigger', action } });
    this.actionAdded = true;
  }

  async waitForRead(runId) {
    const deadline = this.now() + RUN_TIMEOUT_MS;
    while (this.now() < deadline) {
      const run = await this.request(`/flow-runs/${encodeURIComponent(runId)}?${new URLSearchParams({ projectId: this.projectId })}`);
      const step = run.steps?.read_synthetic;
      if (run.status === 'SUCCEEDED' && step?.status === 'SUCCEEDED' && step.outputType !== 'SLICE') return step.output;
      if (step?.outputType === 'SLICE') throw new Error('invalid_read_result');
      if (run.status !== 'SUCCEEDED' && (run.finishTime || ['FAILED', 'TIMEOUT', 'CANCELED', 'INTERNAL_ERROR'].includes(run.status))) throw new Error('test_read_failed');
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error('test_read_timed_out');
  }

  async read(labelId) {
    const label = this.labels.get(labelId);
    if (!label) throw new Error('choose_test_label');
    await this.prepareRead(label);
    const run = await this.request('/sample-data/test-step', {
      projectId: this.projectId, flowVersionId: this.flow.version.id, stepName: 'read_synthetic',
    });
    const sample = await this.waitForRead(run.id);
    const count = sample.results?.count;
    if (!Number.isInteger(count) || count < 0 || count > READ_LIMIT || !Array.isArray(sample.results?.messages)
      || sample.results.messages.length !== count) throw new Error('invalid_read_result');
    if (sample.results.messages.some(message => message.error || (typeof message.text !== 'string' && typeof message.html !== 'string'))) {
      throw new Error('invalid_read_result');
    }
    return { messages: count, pages: 1 };
  }
}
