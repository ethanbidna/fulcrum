import { lstat, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile, durableFile, uuid, syncDirectory } from './files.js';
const MAX_CONFIGURATION_BYTES = 1024 * 1024;
export class McpInstallation {
  constructor(private readonly configurationFile: string, private readonly executable: string, private readonly entryPoint: string) {}
  async install(): Promise<{configurationFile:string}> {
    const entry=await lstat(this.entryPoint);if(!entry.isFile()||entry.isSymbolicLink())throw new Error('MCP_EXECUTABLE_UNAVAILABLE');
    const directory=path.dirname(this.configurationFile);await mkdir(directory,{recursive:true,mode:0o700});
    for(let ancestor=directory;ancestor!==path.dirname(ancestor);ancestor=path.dirname(ancestor)){const stat=await lstat(ancestor);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('MCP_CONFIGURATION_PATH_UNSAFE');}
    let content: string|undefined;let configuration: Record<string,unknown>={};
    try{const stat=await lstat(this.configurationFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||stat.size>MAX_CONFIGURATION_BYTES)throw new Error('MCP_CONFIGURATION_UNSAFE');content=await readFile(this.configurationFile,'utf8');configuration=JSON.parse(content);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new Error('MCP_CONFIGURATION_INVALID');
    const servers=configuration.mcpServers??{};if(!servers||typeof servers!=='object'||Array.isArray(servers))throw new Error('MCP_CONFIGURATION_INVALID');
    if(content!==undefined){await durableFile(`${this.configurationFile}.fulcrum-backup-${uuid()}`,content);await syncDirectory(directory);}
    await atomicFile(this.configurationFile,JSON.stringify({...configuration,mcpServers:{...servers,fulcrum:{command:this.executable,args:[this.entryPoint]}}},null,2));
    return {configurationFile:this.configurationFile};
  }
}
