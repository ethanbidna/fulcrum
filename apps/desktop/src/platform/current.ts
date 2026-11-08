import { isTauri } from '@tauri-apps/api/core';
import { ShellCoreTransport } from '../core-transport.js';
import { TauriChannel } from './tauri-channel.js';
import type { Platform } from './platform.js';
export const platform: Platform = {
  async connectCore() {
    if (isTauri()) return new ShellCoreTransport(await TauriChannel.connect());
    if (import.meta.env.DEV) {
      const { connectDevelopmentCore } = await import('../../dev/browser-platform.js');
      return connectDevelopmentCore();
    }
    throw new Error('NATIVE_SHELL_REQUIRED');
  },
};
