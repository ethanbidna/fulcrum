import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppliedChange } from '@fulcrum/domain';
import type { RpcChannel } from '../core-transport.js';
// A retry must finish releasing the old native subscription before opening another.
let lifecycle: Promise<unknown> = Promise.resolve();
function subscriptionCommand(name: string) {
  const request = lifecycle.then(() => invoke(name));
  lifecycle = request.catch(() => undefined);
  return request;
}
export class TauriChannel implements RpcChannel {
  private readonly listeners = new Set<(message: { method: string; params: AppliedChange }) => void>();
  private closed = false;
  private unlisten: () => void = () => {};
  static async connect(): Promise<TauriChannel> {
    const channel = new TauriChannel();
    channel.unlisten = await listen<AppliedChange>('core-change', event => {
      for (const listener of channel.listeners) {
        try { listener({ method: 'AppliedChange', params: event.payload }); } catch { continue; }
      }
    });
    return channel;
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('CONNECTION_CLOSED'));
    if (method === 'subscribe') return subscriptionCommand('core_subscribe');
    return invoke('core_request', { method, params });
  }
  listen(listener: (message: { method: string; params: AppliedChange }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() {
    if (this.closed) return;
    this.closed = true; this.listeners.clear(); this.unlisten();
    void subscriptionCommand('core_unsubscribe').catch(() => undefined);
  }
}
