import { isTauri, invoke } from '@tauri-apps/api/core';
import { ShellCoreTransport } from '../core-transport.js';
import { TauriChannel } from './tauri-channel.js';
import type { Platform } from './platform.js';
export const platform: Platform = {
  ...(isTauri()?{setup:{privacy:async(action:'copy'|'lock'|'restore',backupId?:string)=>{await invoke('privacy_request',{action,backupId:backupId??null});},status:()=>invoke('setup_request',{name:'status',args:{}}),choose:(location:'documents'|'dropbox'|'drive'|'choose',mode:'create'|'open')=>invoke('setup_request',{name:'choose',args:{location,mode}}),open:async(token:string,deviceLabel:string)=>{await invoke('setup_request',{name:'open',args:{token,deviceLabel}});}}}:{}),
  async connectCore() {
    if (isTauri()) return new ShellCoreTransport(await TauriChannel.connect());
    if (import.meta.env.DEV) {
      const { connectDevelopmentCore } = await import('../../dev/browser-platform.js');
      return connectDevelopmentCore();
    }
    throw new Error('NATIVE_SHELL_REQUIRED');
  },
};
