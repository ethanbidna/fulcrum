import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import { receiveManagedCode, managedReplyScript } from './browser.js';
import { HOSTED_OAUTH_ORIGIN, HOSTED_OAUTH_REDIRECT, MANAGED_SOURCE_POLICIES } from './policy.js';

function authorization() {
  const policy = MANAGED_SOURCE_POLICIES.gmail;
  if (policy.kind !== 'oauth') throw new Error('synthetic');
  return `https://accounts.google.com/o/oauth2/auth?${new URLSearchParams({ response_type: 'code', client_id: 'synthetic-client', redirect_uri: HOSTED_OAUTH_REDIRECT, scope: policy.scopes.join(' ') })}`;
}
function post(url: URL, action: string, body: unknown, origin = url.origin) {
  return fetch(`${url.href}/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('callback opens only a temporary Fulcrum page and closes after one valid reply', async () => {
  let helper!: URL;
  const code = await receiveManagedCode({ source: 'gmail', authorizationUrl: authorization(), signal: new AbortController().signal,
    openBrowser: async url => {
      helper = url;
      expect(url.hostname).toBe('127.0.0.1');
      const page = await fetch(url);
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      const html = await page.text();
      expect(html).toContain('Continue to sign-in');
      expect(html).not.toContain('synthetic-runtime-token');
      expect((await post(url, 'complete', { code: 'synthetic-code' }, 'https://example.invalid')).status).toBe(403);
      expect((await post(url, 'complete', { code: 'synthetic-code', action: 'read' })).status).toBe(400);
      expect((await post(url, 'complete', { code: 'synthetic-code' })).status).toBe(200);
    },
  });
  expect(code).toBe('synthetic-code');
  await expect(fetch(helper)).rejects.toThrow();
});

test('callback rejects unknown paths and non-JSON posts without consuming the attempt', async () => {
  expect(await receiveManagedCode({ source: 'gmail', authorizationUrl: authorization(), signal: new AbortController().signal,
    openBrowser: async url => {
      expect((await fetch(new URL('/not-the-attempt', url))).status).toBe(404);
      expect((await fetch(`${url.href}/complete`, { method: 'POST', headers: { Origin: url.origin }, body: 'code=synthetic' })).status).toBe(403);
      expect((await post(url, 'complete', { code: '' })).status).toBe(400);
      expect((await post(url, 'complete', { code: 'x'.repeat(8193) })).status).toBe(400);
      await post(url, 'complete', { code: 'synthetic' });
    },
  })).toBe('synthetic');
});

test('callback cancellation, abort and failed browser launch remove the listener', async () => {
  for (const mode of ['cancel', 'abort', 'launch'] as const) {
    let helper!: URL; const controller = new AbortController();
    const connection = receiveManagedCode({ source: 'gmail', authorizationUrl: authorization(), signal: controller.signal,
      openBrowser: async url => {
        helper = url;
        if (mode === 'cancel') await post(url, 'cancel', {});
        if (mode === 'abort') controller.abort();
        if (mode === 'launch') throw new Error('synthetic-launch-failure');
      },
    });
    await expect(connection).rejects.toThrow();
    await expect(fetch(helper)).rejects.toThrow();
  }
});

test('callback expires even if browser launching never finishes', async () => {
  let helper!: URL;
  await expect(receiveManagedCode({ source: 'gmail', authorizationUrl: authorization(), signal: new AbortController().signal, timeoutMs: 30,
    openBrowser: url => { helper = url; return new Promise(() => {}); },
  })).rejects.toThrow('managed_sign_in_closed');
  await expect(fetch(helper)).rejects.toThrow();
});

test('callback does not accept arbitrary sign-in destinations', async () => {
  const openBrowser = vi.fn();
  await expect(receiveManagedCode({ source: 'gmail', authorizationUrl: 'https://example.invalid', signal: new AbortController().signal, openBrowser })).rejects.toThrow();
  expect(openBrowser).not.toHaveBeenCalled();
});

function browserFixture() {
  const listeners = new Map<string, (event: unknown) => unknown>();
  const events = new Map<string, () => void>();
  const popup = { closed: false, close: vi.fn(), focus: vi.fn() };
  const button = { disabled: false, addEventListener: (_name: string, callback: () => void) => events.set('continue', callback) };
  const cancel = { disabled: false, addEventListener: (_name: string, callback: () => void) => events.set('cancel', callback), click: () => events.get('cancel')!() };
  const message = { textContent: '' };
  const config = { textContent: JSON.stringify({ authorizationUrl: authorization(), replyOrigin: HOSTED_OAUTH_ORIGIN, maxCodeLength: 8192 }) };
  const fetcher = vi.fn(async () => ({ ok: true }));
  const window = { open: vi.fn(() => popup), addEventListener: (name: string, callback: (event: unknown) => unknown) => listeners.set(name, callback) };
  runInNewContext(managedReplyScript, { window, document: { getElementById: (id: string) => ({ continue: button, cancel, message, configuration: config })[id as 'continue'] },
    location: { pathname: '/synthetic-attempt' }, fetch: fetcher, setInterval: () => 1, clearInterval: () => {} });
  events.get('continue')!();
  const reply = (origin: string, source: unknown, data: unknown) => listeners.get('message')!({ origin, source, data });
  return { popup, fetcher, message, reply };
}

test('popup relay requires the exact hosted origin and exact popup and consumes its code once', async () => {
  const browser = browserFixture();
  await browser.reply('https://example.invalid', browser.popup, { code: 'synthetic' });
  await browser.reply(`${HOSTED_OAUTH_ORIGIN}.example.invalid`, browser.popup, { code: 'synthetic' });
  await browser.reply(HOSTED_OAUTH_ORIGIN, {}, { code: 'synthetic' });
  await browser.reply(HOSTED_OAUTH_ORIGIN, browser.popup, { code: 'x'.repeat(8193) });
  expect(browser.fetcher).not.toHaveBeenCalled();
  await browser.reply(HOSTED_OAUTH_ORIGIN, browser.popup, { code: 'synthetic%2Fcode' });
  expect(browser.fetcher.mock.calls[0]).toEqual(['/synthetic-attempt/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"synthetic/code"}' }]);
  await browser.reply(HOSTED_OAUTH_ORIGIN, browser.popup, { code: 'replay' });
  expect(browser.fetcher).toHaveBeenCalledTimes(1);
  expect(browser.popup.close).toHaveBeenCalled();
  expect(browser.message.textContent).toContain('Return to Fulcrum');
});
