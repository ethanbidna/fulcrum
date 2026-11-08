import type { CoreTransport } from '../core-transport.js';
export interface Platform { connectCore(): Promise<CoreTransport> }
