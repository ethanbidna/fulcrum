import path from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
export function releaseLaunch(kind:'core'|'mcp',options={packaged:isSea(),executable:process.execPath}){
 if(options.packaged)return{command:path.join(path.dirname(options.executable),`fulcrum-${kind}`),args:[] as string[]};
 return{command:options.executable,args:[fileURLToPath(new URL(`./${kind}.mjs`,import.meta.url))]};
}
export function bundledCredentialHelper(){
 if(!isSea())return undefined;
 return path.resolve(path.dirname(process.execPath),'../../MacOS/fulcrum-desktop');
}
