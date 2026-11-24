import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRuntime } from './connection-runtime.js';
import { ManagedSourceSettings } from './managed-sources.js';
import { ManagedSourceBrowser } from './managed-browser.js';

const controllers: ConnectionRuntime[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.close())); });
function fixture(saved?: unknown, installed = false) {
  let value = saved;
  const preferences = { read: vi.fn(async () => value), write: vi.fn(async (_key, next) => { value = next; }) };
  const runtime = { installed: vi.fn(async () => installed), install: vi.fn(async () => { installed = true; return 'http://127.0.0.1:18089'; }), start: vi.fn(async () => 'http://127.0.0.1:18089'), stop: vi.fn(async () => {}), healthy: vi.fn(async () => true) };
  const client = { lookup: vi.fn(async () => null), begin: vi.fn(async () => ({ attemptId: 'synthetic', authorizationUrl: 'https://accounts.google.com/synthetic' })), complete: vi.fn(), connectGranola: vi.fn(), disconnect: vi.fn(async () => {}), cancel: vi.fn() };
  const sources = new ManagedSourceSettings({ preferences: { read: async () => undefined, write: async () => {} }, designated: () => true });
  const browser = new ManagedSourceBrowser(sources);
  const connect = vi.fn(async () => client);
  const designated = vi.fn(() => true);
  const controller = new ConnectionRuntime({ runtime, preferences, sources, browser, connect, designated }); controllers.push(controller);
  return { controller, runtime, preferences, sources, browser, connect, designated, client };
}
describe('in-app connection runtime', () => {
  it('does no network or installation without acknowledgement', async () => {
    const test = fixture(); await test.controller.restore();
    expect(test.controller.status().phase).toBe('not_installed');
    expect(() => test.controller.start(false)).toThrow();
    expect(test.runtime.install).not.toHaveBeenCalled(); expect(test.connect).not.toHaveBeenCalled();
    test.designated.mockReturnValue(false); expect(() => test.controller.start(true)).toThrow();
  });
  it('returns immediately, provisions before enabling sources and stops without deleting them', async () => {
    const test = fixture(); await test.controller.restore();
    let finish!: () => void;
    test.connect.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return test.client; });
    test.controller.start(true);
    expect(test.controller.status().phase).toBe('installing');
    await vi.waitFor(() => expect(test.connect).toHaveBeenCalled());
    expect(test.sources.status().every(status => status.phase === 'unavailable')).toBe(true);
    finish(); await test.controller.settled(); expect(test.controller.status().phase).toBe('ready');
    test.controller.stop(); await test.controller.settled(); expect(test.controller.status().phase).toBe('stopped');
    test.controller.start(true); await test.controller.settled(); expect(test.controller.status().phase).toBe('ready');
  });
  it('starts saved opt-in on restart and retains it on application close', async () => {
    const test = fixture({ enabled: true }, true); await test.controller.restore(); await test.controller.settled();
    expect(test.runtime.start).toHaveBeenCalledTimes(1); expect(test.runtime.install).not.toHaveBeenCalled();
    expect(test.controller.status().phase).toBe('ready');
    await test.controller.close(); expect(test.preferences.write).not.toHaveBeenCalledWith('connectionRuntime', { enabled: false });
  });
  it('does not silently retry interrupted downloads or start on another ingestion Mac', async () => {
    const test = fixture({ enabled: true }); await test.controller.restore(); expect(test.controller.status().phase).toBe('failed');
    expect(test.runtime.install).not.toHaveBeenCalled();
    const other = fixture({ enabled: true }, true); other.designated.mockReturnValue(false); await other.controller.restore();
    expect(other.runtime.start).not.toHaveBeenCalled();
  });
  it('cancels installation and blocks late activation', async () => {
    const test = fixture(); await test.controller.restore(); let finish!: () => void;
    test.runtime.install.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'http://127.0.0.1:18089'; });
    test.controller.start(true); await vi.waitFor(() => expect(test.runtime.install).toHaveBeenCalled());
    test.controller.stop(); finish(); await test.controller.settled();
    expect(test.connect).not.toHaveBeenCalled(); expect(test.controller.status().phase).toBe('not_installed');
    expect(test.preferences.write).toHaveBeenCalledWith('connectionRuntime', { enabled: false });
    expect(test.sources.status().every(status => status.phase === 'unavailable')).toBe(true);
  });
  it('stops after bootstrap failure and never exposes its error details', async () => {
    const test = fixture(); await test.controller.restore(); test.connect.mockRejectedValueOnce(new Error('secret-token'));
    test.controller.start(true); await test.controller.settled();
    expect(test.runtime.stop).toHaveBeenCalled(); expect(test.controller.status().phase).toBe('failed');
    expect(JSON.stringify(test.controller.status())).not.toContain('secret-token');
  });
  it('disables clients on unhealthy service and supports restart', async () => {
    const test = fixture(); await test.controller.restore(); test.controller.start(true); await test.controller.settled();
    expect(test.sources.status()[0]?.phase).toBe('disconnected');
    test.runtime.healthy.mockResolvedValueOnce(false); await test.controller.check();
    expect(test.controller.status().phase).toBe('failed'); expect(test.sources.status()[0]?.phase).toBe('unavailable');
    test.controller.start(true); await test.controller.settled(); expect(test.controller.status().phase).toBe('ready');
  });
  it('fails closed on malformed preferences and missing native runtime', async () => {
    const test = fixture({ enabled: true, origin: 'https://example.invalid' }); await test.controller.restore(); expect(test.controller.status().phase).toBe('failed');
    expect(test.runtime.start).not.toHaveBeenCalled();
  });
});

it('cancels during owner bootstrap without installing a late client', async () => {
  const test = fixture(); await test.controller.restore(); let finish!: () => void;
  test.connect.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return test.client; });
  test.controller.start(true); await vi.waitFor(() => expect(test.connect).toHaveBeenCalled());
  test.controller.stop(); finish(); await test.controller.settled();
  expect(test.controller.status().phase).toBe('stopped'); expect(test.sources.status()[0]?.phase).toBe('unavailable');
});
it('does not install when saving acknowledgement fails and reports unavailable without a native driver', async () => {
  const test = fixture(); await test.controller.restore(); test.preferences.write.mockRejectedValueOnce(new Error('private-file-error'));
  test.controller.start(true); await test.controller.settled(); expect(test.runtime.install).not.toHaveBeenCalled(); expect(test.controller.status().phase).toBe('failed');
  const unavailable = new ConnectionRuntime({ preferences: test.preferences, sources: test.sources, browser: test.browser, connect: test.connect, designated: () => true });
  await unavailable.restore(); expect(unavailable.status().phase).toBe('unavailable'); expect(() => unavailable.start(true)).toThrow(); await unavailable.close();
});
it('explains a native Keychain approval failure without exposing credentials', async () => {
  const test = fixture(); await test.controller.restore(); test.connect.mockRejectedValueOnce(new Error('Keychain approval failed.'));
  test.controller.start(true); await test.controller.settled();
  expect(test.controller.status().message).toContain('macOS Keychain approval was not completed');
  expect(test.runtime.stop).toHaveBeenCalled();
});
