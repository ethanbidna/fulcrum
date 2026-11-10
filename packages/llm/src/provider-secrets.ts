import{spawn}from'node:child_process';
const SECRET_BYTES=8192;const KEYCHAIN_TIMEOUT_MS=15_000;
export interface ProviderSecrets{get():Promise<string>;set(key:string):Promise<void>;remove():Promise<void>}
export class NativeProviderSecrets implements ProviderSecrets{
 constructor(private readonly helper:string|undefined){}
 private request(action:'get'|'set'|'remove',key?:string):Promise<{key?:string}>{
  if(process.platform!=='darwin'||!this.helper)return Promise.reject(new Error('Native Keychain helper unavailable.'));
  return new Promise((resolve,reject)=>{
   const child=spawn(this.helper!,['--provider-keychain',action],{stdio:['pipe','pipe','ignore']});let output='';let finished=false;
   const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child.kill('SIGTERM');reject(error);return;}try{const value=JSON.parse(output)as{key?:string};resolve(value);}catch{reject(new Error('Keychain operation failed.'));}};
   const timer=setTimeout(()=>finish(new Error('Keychain approval timed out. Retry and approve the macOS prompt.')),KEYCHAIN_TIMEOUT_MS);
   child.stdout.on('data',(bytes:Buffer)=>{output+=bytes.toString('utf8');if(Buffer.byteLength(output)>SECRET_BYTES)finish(new Error('Invalid Keychain response.'));});child.on('error',()=>finish(new Error('Keychain helper unavailable.')));child.on('close',code=>finish(code===0?undefined:new Error('Keychain approval failed.')));child.stdin.on('error',()=>undefined);child.stdin.end(JSON.stringify({provider:'anthropic',...(key?{key}:{})}));
  });
 }
 async get(){const value=await this.request('get');if(typeof value.key!=='string'||!value.key)throw new Error('Provider key unavailable. Reconnect in Local AI settings.');return value.key;}
 async set(key:string){if(!key.trim()||key.length>4096||/[\r\n\0]/.test(key))throw new Error('Enter a valid API key.');await this.request('set',key);}
 async remove(){await this.request('remove');}
}
