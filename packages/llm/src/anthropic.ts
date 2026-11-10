import type{JsonGeneration,JsonModelRuntime}from'./interfaces.js';
const API_ORIGIN='https://api.anthropic.com/v1/messages';
const API_VERSION='2023-06-01';const MAX_OUTPUT_TOKENS=1024;const MAX_INPUT_BYTES=128*1024;const DEADLINE_MS=120_000;const REQUEST_OVERHEAD_TOKENS=1024;
export class AnthropicJsonRuntime implements JsonModelRuntime{
 constructor(private readonly model:string,private readonly key:()=>Promise<string>,private readonly reserve:(tokens:number)=>Promise<void>,private readonly request:typeof fetch=fetch){if(model!=='claude-haiku-4-5-20251001')throw new Error('Approved provider model required.');}
 async generate(input:JsonGeneration){
  const bytes=Buffer.byteLength(input.system)+Buffer.byteLength(input.input)+Buffer.byteLength(JSON.stringify(input.schema));if(bytes>MAX_INPUT_BYTES)throw new Error('Request exceeds the hosted sharing limit. Narrow the request.');
  await this.reserve(bytes+MAX_OUTPUT_TOKENS+REQUEST_OVERHEAD_TOKENS);
  const key=await this.key();
  const response=await this.request(API_ORIGIN,{method:'POST',redirect:'error',signal:input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(DEADLINE_MS)]):AbortSignal.timeout(DEADLINE_MS),headers:{'content-type':'application/json','anthropic-version':API_VERSION,'x-api-key':key},body:JSON.stringify({model:this.model,max_tokens:MAX_OUTPUT_TOKENS,system:input.system,messages:[{role:'user',content:input.input}],tools:[{name:'return_structured_result',description:'Return only the requested structured data.',input_schema:input.schema}],tool_choice:{type:'tool',name:'return_structured_result'}})});
  if(!response.ok)throw new Error('Hosted connection failed. Check the API key, account access and provider budget.');
  const text=await response.text();if(Buffer.byteLength(text)>MAX_INPUT_BYTES)throw new Error('Hosted response exceeded the limit.');
  const value=JSON.parse(text)as{content?:{type:string;name?:string;input?:unknown}[];stop_reason?:string};
  if(value.stop_reason==='max_tokens')throw new Error('Hosted response was incomplete. Narrow the request.');
  const result=value.content?.find(item=>item.type==='tool_use'&&item.name==='return_structured_result');if(!result)throw new Error('Hosted provider returned invalid structured data.');return result.input;
 }
}
