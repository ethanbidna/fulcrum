import { expect, test, vi } from 'vitest';
import { OllamaJsonRuntime } from './index.js';
import { createServer } from 'node:http';
test('generation is loopback-only, bounded and uses the frozen startup model', async () => {
  expect(() => new OllamaJsonRuntime(undefined, 'https://example.com')).toThrow();
  expect(() => new OllamaJsonRuntime('unknown-model')).toThrow();
  const request = vi.fn(async () => new Response(JSON.stringify({ message: { content: '{"commands":[]}' } })));
  const runtime = new OllamaJsonRuntime(undefined, undefined, request);
  expect(await runtime.generate({ system: 'Rules', input: 'Synthetic request', schema: { type: 'object' } })).toEqual({ commands: [] });
  const [url, options] = request.mock.calls[0]! as unknown as [URL, RequestInit];
  expect(url.origin).toBe('http://127.0.0.1:11434');
  expect(JSON.parse(String(options.body))).toMatchObject({ stream: false, think: false, options: { temperature: 0, num_thread: 4 } });
});
test('a runtime redirect cannot forward the command to another endpoint', async () => {
  let forwarded = 0;
  const server = createServer((request,response) => {
    if(request.url === '/api/chat') { response.writeHead(307,{location:'/forwarded'}); response.end(); return; }
    forwarded++; response.end(JSON.stringify({message:{content:'{}'}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address(); if(!address||typeof address==='string')throw new Error('Missing test listener');
    const runtime=new OllamaJsonRuntime(undefined,`http://127.0.0.1:${address.port}`);
    await expect(runtime.generate({system:'Rules',input:'Synthetic request',schema:{type:'object'}})).rejects.toThrow();
    expect(forwarded).toBe(0);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
