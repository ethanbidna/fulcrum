import type{WorkspaceSetup}from'./setup.js';
import type { CoreTransport } from '../core-transport.js';
export interface Platform { setup?:WorkspaceSetup; connectCore(): Promise<CoreTransport> }
