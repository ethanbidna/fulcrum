import { appendFile, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { StoreError } from './files.js';
export interface McpActivity { at: string; tool: string; outcome: 'requested'|'allowed'|'denied'|'failed'; recordIds: string[] }
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const RECENT_ENTRIES = 200;
export class LocalMcpActivity {
  private readonly file: string;
  constructor(directory: string) { this.file = path.join(directory, 'mcp-access.log'); }
  private async check() {
    try { const stat = await lstat(this.file); if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid?.() || (stat.mode&0o777)!==0o600 || stat.size>MAX_LOG_BYTES) throw new StoreError('MCP_LOG_UNAVAILABLE','MCP activity requires a private bounded file'); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  }
  async append(entry: McpActivity) { await this.check(); await appendFile(this.file,`${JSON.stringify(entry)}\n`,{mode:0o600}); }
  async recent(): Promise<McpActivity[]> {
    await this.check();
    try { return (await readFile(this.file,'utf8')).trim().split('\n').filter(Boolean).slice(-RECENT_ENTRIES).map(line=>JSON.parse(line)).reverse(); }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return []; throw error; }
  }
}
