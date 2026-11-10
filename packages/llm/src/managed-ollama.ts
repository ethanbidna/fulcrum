import {mkdir,lstat,open,rename,mkdtemp,rm}from'node:fs/promises';
import path from'node:path';import {createHash,randomUUID}from'node:crypto';
import {execFile,spawn}from'node:child_process';import {promisify}from'node:util';import {createServer}from'node:net';import{setTimeout}from'node:timers/promises';
import{OLLAMA_RELEASE}from'./model-catalog.js';import type{CatalogChoice}from'./model-catalog.js';
import{OllamaJsonRuntime}from'./index.js';
const execute=promisify(execFile);
const DOWNLOAD_HOSTS=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const REDIRECT_LIMIT=5;const STARTUP_ATTEMPTS=100;const POLL_MS=100;const COMMAND_TIMEOUT_MS=60_000;
const PULL_LINE_BYTES=64*1024;const MIB=1024*1024;const RUNTIME_DISK_MARGIN=1024*MIB;
export interface ModelProgress{message:string;completedBytes:number|null;totalBytes:number|null}
export interface ManagedOllamaPorts{request:typeof fetch;run:typeof execute}
export class ManagedOllama{
 private child:ReturnType<typeof spawn>|undefined;private origin:string|undefined;
 constructor(private readonly directory:string,private readonly ports:ManagedOllamaPorts={request:fetch,run:execute}){}
 async install(signal:AbortSignal,progress:(value:ModelProgress)=>void){
  if(process.platform!=='darwin')throw new Error('Managed runtime requires macOS.');
  await privateDirectory(this.directory);const root=path.join(this.directory,'runtime');await privateDirectory(root);
  const installed=path.join(root,`ollama-${OLLAMA_RELEASE.version}`);
  try{await this.verify(installed,signal);return;}catch(error){if(signal.aborted)throw error;}
  const temporary=await mkdtemp(path.join(root,'candidate-'));const archive=path.join(temporary,'runtime.zip');
  try{
   progress({message:'Downloading the official Ollama runtime…',completedBytes:0,totalBytes:OLLAMA_RELEASE.bytes});
   await downloadRuntime(archive,signal,progress,this.ports.request);
   await this.ports.run('/usr/bin/ditto',['-x','-k',archive,path.join(temporary,'unpacked')],{signal,timeout:COMMAND_TIMEOUT_MS});
   const candidate=path.join(temporary,'unpacked');await this.verify(candidate,signal);
   try{const entry=await lstat(installed);if(entry.isSymbolicLink()||!entry.isDirectory())throw new Error('Managed runtime folder is unsafe.');await rename(installed,path.join(root,`replaced-${randomUUID()}`));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   await rename(candidate,installed);
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
 private async verify(directory:string,signal:AbortSignal){
  const app=path.join(directory,'Ollama.app');const entry=await lstat(app);if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Managed runtime is unavailable.');
  await this.ports.run('/usr/bin/codesign',['--verify','--deep','--strict',app],{signal,timeout:COMMAND_TIMEOUT_MS});
  await this.ports.run('/usr/sbin/spctl',['--assess','--type','execute',app],{signal,timeout:COMMAND_TIMEOUT_MS});
  const binary=await lstat(path.join(app,'Contents','Resources','ollama'));if(!binary.isFile()||binary.isSymbolicLink())throw new Error('Managed runtime executable is unavailable.');
 }
 async start(signal:AbortSignal){
  if(this.child&&this.child.exitCode===null&&!this.child.killed&&this.origin)return this.origin;
  const installed=path.join(this.directory,'runtime',`ollama-${OLLAMA_RELEASE.version}`);await this.verify(installed,signal);
  const port=await availablePort();const origin=`http://127.0.0.1:${port}`;
  const models=path.join(this.directory,'models');await privateDirectory(models);
  const child=spawn(path.join(installed,'Ollama.app','Contents','Resources','ollama'),['serve'],{stdio:'ignore',env:{...process.env,OLLAMA_HOST:`127.0.0.1:${port}`,OLLAMA_MODELS:models,OLLAMA_NO_CLOUD:'1',OLLAMA_ORIGINS:'',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'4096'}});
  this.child=child;child.on('error',()=>undefined);
  for(let attempt=0;attempt<STARTUP_ATTEMPTS;attempt++){
   signal.throwIfAborted();if(child.exitCode!==null||child.killed)break;
   try{const response=await this.ports.request(`${origin}/api/version`,{signal:AbortSignal.any([signal,AbortSignal.timeout(POLL_MS)])});if(response.ok){this.origin=origin;return origin;}}catch{/* Wait for the owned process to listen. */}
   await setTimeout(POLL_MS,undefined,{signal});
  }this.stop();throw new Error('The managed local runtime could not start. Retry or continue without AI.');
 }
 async pull(choice:CatalogChoice,signal:AbortSignal,progress:(value:ModelProgress)=>void){
  if(choice.kind!=='local'||!choice.digest)throw new Error('Choose a supported local model.');
  const origin=await this.start(signal);progress({message:'Downloading model; verified layers can resume on retry…',completedBytes:null,totalBytes:choice.downloadBytes});
  const response=await this.ports.request(`${origin}/api/pull`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:choice.model,stream:true}),signal});
  if(!response.ok||!response.body)throw new Error('Model download failed. Retry to resume verified layers.');
  let pending='';let success=false;const decoder=new TextDecoder();
  for await(const bytes of response.body){signal.throwIfAborted();pending+=decoder.decode(bytes,{stream:true});if(Buffer.byteLength(pending)>PULL_LINE_BYTES)throw new Error('Invalid download progress.');let boundary;
   while((boundary=pending.indexOf('\n'))>=0){const line=pending.slice(0,boundary);pending=pending.slice(boundary+1);if(!line.trim())continue;const value=JSON.parse(line)as{status?:string;error?:string;completed?:number;total?:number};if(value.error)throw new Error('Model download failed. Retry to resume verified layers.');success||=value.status==='success';progress({message:'Downloading and verifying model layers…',completedBytes:typeof value.completed==='number'?value.completed:null,totalBytes:typeof value.total==='number'?value.total:null});}
  }
  if(pending.trim()){const value=JSON.parse(pending)as{status?:string};success||=value.status==='success';}
  if(!success)throw new Error('Model download was incomplete. Retry to resume.');
  const tags=await this.ports.request(`${origin}/api/tags`,{signal});if(!tags.ok)throw new Error('Could not verify the installed model.');
  const installed=await tags.json()as{models?:{name:string;digest:string}[]};
  if(!installed.models?.some(item=>item.name===choice.model&&item.digest===choice.digest))throw new Error('The installed model digest differs from this profile. Choose another model or retry after a profile update.');
 }
 async runtime(model:string,signal:AbortSignal){return new OllamaJsonRuntime(model,await this.start(signal),this.ports.request);}
 async residentBytes():Promise<number|null>{
  const pid=this.child?.pid;if(!pid)return null;
  try{const output=await this.ports.run('/bin/ps',['-axo','pid=,ppid=,rss='],{timeout:COMMAND_TIMEOUT_MS});const rows=String(output.stdout).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));const owned=new Set([pid]);let changed=true;while(changed){changed=false;for(const[child,parent]of rows)if(parent!==undefined&&child!==undefined&&owned.has(parent)&&!owned.has(child)){owned.add(child);changed=true;}}return rows.filter(([child])=>child!==undefined&&owned.has(child)).reduce((sum,row)=>sum+(row[2]??0)*1024,0);}catch{return null;}
 }
 stop(){this.child?.kill('SIGTERM');this.child=undefined;this.origin=undefined;}
}
export function requiredModelDisk(choice:CatalogChoice){return (choice.downloadBytes??0)*2+OLLAMA_RELEASE.bytes*3+RUNTIME_DISK_MARGIN;}
async function privateDirectory(directory:string){await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.())throw new Error('Managed runtime requires an owned local folder.');}
async function availablePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Local runtime address unavailable.');await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return address.port;}
export async function downloadRuntime(file:string,signal:AbortSignal,progress:(value:ModelProgress)=>void,request:typeof fetch=fetch){
 let url=OLLAMA_RELEASE.url;let response:Response|undefined;
 for(let redirects=0;redirects<=REDIRECT_LIMIT;redirects++){const address=new URL(url);if(address.protocol!=='https:'||!DOWNLOAD_HOSTS.has(address.hostname)||address.username||address.password)throw new Error('Untrusted runtime download destination.');response=await request(address,{signal,redirect:'manual'});if(![301,302,303,307,308].includes(response.status))break;const location=response.headers.get('location');if(!location)throw new Error('Invalid runtime download redirect.');url=new URL(location,address).href;}
 if(!response?.ok||!response.body)throw new Error('Runtime download failed. Retry or continue without AI.');
 const output=await open(file,'wx',0o600);const hash=createHash('sha256');let bytes=0;
 try{for await(const chunk of response.body){signal.throwIfAborted();bytes+=chunk.byteLength;if(bytes>OLLAMA_RELEASE.bytes)throw new Error('Runtime download size differs from the approved release.');hash.update(chunk);await output.write(chunk);progress({message:'Downloading the official Ollama runtime…',completedBytes:bytes,totalBytes:OLLAMA_RELEASE.bytes});}await output.sync();}finally{await output.close();}
 if(bytes!==OLLAMA_RELEASE.bytes||hash.digest('hex')!==OLLAMA_RELEASE.digest)throw new Error('Runtime verification failed. Retry the download.');
}
