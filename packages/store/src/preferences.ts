import { mkdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, StoreError } from './files.js';
const PRIVATE_MODE = 0o600;
const MAX_PREFERENCE_BYTES = 64 * 1024;
const FILES = { modelPreferences:'model-preferences.json', ai: 'ai-settings.json', aiUsage:'ai-usage.json', setup:'setup.json', background: 'background-settings.json', mcp: 'mcp-access.json', activeWorkspace: 'active-workspace.json' } as const;
export class LocalPreferences {
  constructor(private readonly directory:string) {}
  async read(name:keyof typeof FILES):Promise<unknown|undefined>{
    const file=this.file(name);
    try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==PRIVATE_MODE||stat.size>MAX_PREFERENCE_BYTES)throw new StoreError('PRIVATE_CONFIGURATION_REQUIRED','Local preferences are not a private file');return JSON.parse(await readFile(file,'utf8'));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  }
  async write(name:keyof typeof FILES,value:unknown){
    const content=JSON.stringify(value);if(Buffer.byteLength(content)>MAX_PREFERENCE_BYTES)throw new StoreError('PREFERENCES_TOO_LARGE','Local preferences exceed their limit');
    await this.read(name);await mkdir(this.directory,{recursive:true,mode:0o700});await atomicFile(this.file(name),content);
  }
  private file(name:keyof typeof FILES){if(!Object.hasOwn(FILES,name))throw new StoreError('INVALID_PREFERENCE','Unknown local preference');return path.join(this.directory,FILES[name]);}
}
