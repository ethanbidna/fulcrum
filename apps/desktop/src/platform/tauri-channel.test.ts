import { expect, test, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
import { TauriChannel } from './tauri-channel.js';
test('native adapter sends typed RPC without credentials and releases events', async () => {
  native.invoke.mockResolvedValue([]); native.listen.mockResolvedValue(native.unlisten);
  const channel = await TauriChannel.connect();
  await channel.request('query', { name: 'portfolio.list', args: {} });
  expect(native.invoke).toHaveBeenCalledWith('core_request', { method: 'query', params: { name: 'portfolio.list', args: {} } });
  const received = vi.fn(); channel.listen(() => { throw new Error('synthetic observer'); }); channel.listen(received);
  native.listen.mock.calls[0]![1]({ payload: { eventId: 'synthetic' } });
  expect(received).toHaveBeenCalledWith({ method: 'AppliedChange', params: { eventId: 'synthetic' } });
  channel.close(); expect(native.unlisten).toHaveBeenCalled();
  await expect(channel.request('query', {})).rejects.toThrow('CONNECTION_CLOSED');
});
test('retry serializes unsubscribe before the next native subscription', async () => {
  native.invoke.mockClear(); native.invoke.mockResolvedValue({}); native.listen.mockResolvedValue(native.unlisten);
  const previous = await TauriChannel.connect(); await previous.request('subscribe', {});
  previous.close();
  const next = await TauriChannel.connect(); await next.request('subscribe', {});
  expect(native.invoke.mock.calls.map(call => call[0])).toEqual(['core_subscribe', 'core_unsubscribe', 'core_subscribe']);
  next.close(); await Promise.resolve();
});
