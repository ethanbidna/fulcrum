import { ShellCoreTransport } from '../src/core-transport.js';
import { DevelopmentWebSocketChannel } from './websocket-channel.js';
export async function connectDevelopmentCore() {
  const response = await fetch('/__fulcrum/session', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('DEVELOPMENT_SESSION_UNAVAILABLE');
  const session = await response.json() as { url: string; token: string };
  return new ShellCoreTransport(await DevelopmentWebSocketChannel.connect(session.url, session.token));
}
