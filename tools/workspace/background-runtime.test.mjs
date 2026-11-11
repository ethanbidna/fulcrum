import { expect, test } from 'vitest';
import { OllamaJsonRuntime } from '../../packages/llm/src/index.ts';
const input = { system: 'Synthetic', input: 'Synthetic', schema: { type: 'object' } };
test('local runtime supplies a five-minute idle lifetime and serializes shared-endpoint calls', async () => {
  const calls = []; let release;
  const request = async (_url, options) => { calls.push(JSON.parse(options.body)); if (calls.length === 1) await new Promise(resolve => { release = resolve; }); return Response.json({ message: { content: '{}' } }); };
  const first = new OllamaJsonRuntime(undefined, undefined, request).generate(input);
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = new OllamaJsonRuntime(undefined, undefined, request).generate(input);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(calls).toHaveLength(1);
  release(); await Promise.all([first, second]); expect(calls).toHaveLength(2); expect(calls[0].keep_alive).toBe(300);
});
test('an aborted waiting call never starts inference or blocks the next call', async () => {
  let release; let calls = 0;
  const request = async () => { calls++; if (calls === 1) await new Promise(resolve => { release = resolve; }); return Response.json({ message: { content: '{}' } }); };
  const runtime = new OllamaJsonRuntime(undefined, 'http://127.0.0.1:11435', request);
  const first = runtime.generate(input); await new Promise(resolve => setTimeout(resolve, 0));
  const controller = new AbortController(); const second = runtime.generate({ ...input, signal: controller.signal });
  controller.abort(); await expect(second).rejects.toThrow(); release(); await first;
  await runtime.generate(input); expect(calls).toBe(2);
});
test('an explicitly owned Ollama uses background priority, loopback and one server slot', async () => {
  const { startBackgroundOllama } = await import('../../packages/llm/src/index.ts');
  const { vi } = await import('vitest'); vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  const launch = vi.fn(() => ({ synthetic: true }));
  try {
    expect(startBackgroundOllama({ executable: '/synthetic/ollama', port: 11439 }, launch)).toEqual({ synthetic: true });
    expect(launch.mock.calls[0]).toMatchObject(['/usr/sbin/taskpolicy', ['-b', '/usr/bin/nice', '-n', '10', '/synthetic/ollama', 'serve'], { env: { OLLAMA_HOST: '127.0.0.1:11439', OLLAMA_NUM_PARALLEL: '1', OLLAMA_KEEP_ALIVE: '5m', OLLAMA_NO_CLOUD: '1' }, stdio: 'ignore' }]);
    expect(() => startBackgroundOllama({ executable: 'ollama', port: 11439 }, launch)).toThrow();
  } finally { vi.restoreAllMocks(); }
});
test('review port admission refuses even a server that never answers HTTP', async () => {
  const { createServer } = await import('node:net');
  const { requireUnusedPort } = await import('../../apps/core/dev/background-review.ts');
  const occupied = createServer(); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try { await expect(requireUnusedPort(occupied.address().port)).rejects.toThrow('REVIEW_PORT_UNAVAILABLE'); }
  finally { await new Promise(resolve => occupied.close(resolve)); }
});
test('core background priority failure pauses work instead of failing the editing host', async () => {
  const { prepareBackgroundProcess } = await import('../../apps/core/src/background-priority.ts');
  const calls = [];
  expect(await prepareBackgroundProcess({ platform: 'darwin', reducePriority: () => calls.push('nice'), backgroundQoS: async () => calls.push('background') })).toBeNull();
  expect(calls).toEqual(['nice', 'background']);
  expect(await prepareBackgroundProcess({ platform: 'darwin', reducePriority: () => {}, backgroundQoS: async () => { throw new Error('synthetic denial'); } })).toContain('priority unavailable');
});
