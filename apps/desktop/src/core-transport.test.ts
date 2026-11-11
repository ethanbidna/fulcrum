import { expect, test, vi } from 'vitest';
import { ShellCoreTransport } from './core-transport.js';
import type { RpcChannel } from './core-transport.js';
test('planning uses a short-lived ticket while ordinary core requests remain available', async () => {
  const plan = {id:'synthetic-plan',prompt:'Synthetic request',changes:[],expiresAt:'2026-11-09T16:00:00Z'};
  const channel = {request:vi.fn(async (method:string)=>method==='planCommand'?{id:'synthetic-job'}:method==='commandPlanStatus'?{phase:'ready',plan}:{ready:true}),listen:vi.fn(),close:vi.fn()} as unknown as RpcChannel;
  const transport = new ShellCoreTransport(channel);
  expect(await transport.planCommand({prompt:'Synthetic request'})).toEqual(plan);
  expect(channel.request).toHaveBeenNthCalledWith(1,'planCommand',{prompt:'Synthetic request'});
  expect(channel.request).toHaveBeenNthCalledWith(2,'commandPlanStatus',{id:'synthetic-job'});
});
test('cancellation before the ticket arrives cancels that exact job instead of adopting its result', async () => {
  let finish!:(value:unknown)=>void;
  const request=vi.fn((method:string)=>method==='planCommand'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({}));
  const transport=new ShellCoreTransport({request,listen:()=>()=>{},close:()=>{}});
  const pending=transport.planCommand({prompt:'Synthetic request'});await transport.cancelCommandPlan();finish({id:'synthetic-job'});
  await expect(pending).rejects.toThrow('cancelled');expect(request).toHaveBeenLastCalledWith('cancelCommandPlan',{id:'synthetic-job'});
});
