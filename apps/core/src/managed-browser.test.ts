import { expect, test, vi } from 'vitest';
import { ManagedSourceSettings } from './managed-sources.js';
import { ManagedSourceBrowser } from './managed-browser.js';
import type { ManagedSourceId } from '@fulcrum/domain';

function fixture() {
  const client = {
    lookup: vi.fn(async () => null), begin: vi.fn(async () => ({ attemptId: 'synthetic-attempt', authorizationUrl: 'https://accounts.google.com/synthetic' })),
    complete: vi.fn(async () => ({ source: 'gmail' as const, id: 'synthetic', ingestion: 'blocked' as const })),
    connectGranola: vi.fn(async () => ({ source: 'granola' as const, id: 'synthetic', ingestion: 'blocked' as const })), cancel: vi.fn(), disconnect: vi.fn(async () => {}),
  };
  const settings = new ManagedSourceSettings({ client, preferences: { read: async () => undefined, write: async () => {} }, designated: () => true });
  const phase = () => settings.status().find(status => status.source === 'gmail')!.phase;
  return { client, settings, phase };
}

test('browser orchestration returns before consent and completes through the existing settings service', async () => {
  const test = fixture(); const open = vi.fn(async () => {});
  const browser = new ManagedSourceBrowser(test.settings, vi.fn(async options => { await options.openBrowser(new URL('http://127.0.0.1:18000/synthetic')); return 'synthetic-code'; }), open);
  browser.start('gmail', true);
  await vi.waitFor(() => expect(test.phase()).toBe('connected'));
  expect(open).toHaveBeenCalledTimes(1);
  expect(test.client.complete).toHaveBeenCalledWith('synthetic-attempt', 'synthetic-code');
  expect(test.settings.status().every(status => status.ingestion === 'blocked')).toBe(true);
  await browser.close(); await test.settings.close();
});

test('browser orchestration requires acknowledgement and never opens for an unavailable source', async () => {
  const test = fixture(); const receive = vi.fn(); const browser = new ManagedSourceBrowser(test.settings, receive);
  expect(() => browser.start('gmail', false)).toThrow();
  expect(() => browser.start('granola', true)).toThrow();
  expect(receive).not.toHaveBeenCalled(); await browser.close();
});

test('cancelling or closing interrupts browser waiting without accepting a late grant', async () => {
  for (const operation of ['cancel', 'close'] as const) {
    const test = fixture();
    const receive = vi.fn(async (options: Parameters<typeof import('@fulcrum/sources').receiveManagedCode>[0]) => new Promise<string>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('synthetic-cancel')), { once: true });
    }));
    const browser = new ManagedSourceBrowser(test.settings, receive);
    browser.start('gmail', true); await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    if (operation === 'cancel') await browser.cancel('gmail'); else await browser.close();
    await vi.waitFor(() => expect(test.phase()).toBe('disconnected'));
    expect(test.client.complete).not.toHaveBeenCalled();
    await browser.close(); await test.settings.close();
  }
});

test('a browser failure leaves a retryable status and consumes no grant', async () => {
  const test = fixture(); const browser = new ManagedSourceBrowser(test.settings, async () => { throw new Error('private error'); });
  browser.start('gmail' satisfies ManagedSourceId, true);
  await vi.waitFor(() => expect(test.phase()).toBe('failed'));
  expect(test.client.complete).not.toHaveBeenCalled(); await browser.close(); await test.settings.close();
});

test('service pause closes a waiting browser and permits fresh consent after restart', async () => {
  const test = fixture();
  const receive = vi.fn(async (options: Parameters<typeof import('@fulcrum/sources').receiveManagedCode>[0]) => new Promise<string>((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('synthetic-cancel')), { once: true });
  }));
  const browser = new ManagedSourceBrowser(test.settings, receive);
  try {
    browser.start('gmail', true); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    test.settings.suspend(); await browser.pause(); await test.settings.pause();
    expect(test.client.complete).not.toHaveBeenCalled(); expect(test.phase()).toBe('unavailable');
    test.settings.resume(test.client); browser.resume(); receive.mockResolvedValueOnce('synthetic-code');
    browser.start('gmail', true); await vi.waitFor(() => expect(test.phase()).toBe('connected'));
    expect(test.client.complete).toHaveBeenCalledTimes(1);
  } finally { await browser.close(); await test.settings.close(); }
});
