import { test, expect } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { developmentSessionPlugin } from '../../apps/desktop/dev/session-plugin.ts';
test('browser bootstrap serves only a private session to same-origin requests', async () => {
  const directory = await mkdtemp('/tmp/fu1-session-'); const file = `${directory}/session.json`;
  const session = { url: 'ws://127.0.0.1:43210', token: 'a'.repeat(64) };
  await writeFile(file, JSON.stringify(session), { mode: 0o600 });
  let middleware; developmentSessionPlugin(file).configureServer({ middlewares: { use: (_path, handler) => { middleware = handler; } } });
  const request = async headers => {
    const result = { status: 200, body: '', headers: {} };
    const response = { setHeader: (key, value) => { result.headers[key] = value; }, writeHead: code => { result.status = code; return response; }, end: body => { result.body = body ?? ''; } };
    await middleware({ method: 'GET', headers }, response); return result;
  };
  try {
    const headers = { host: '127.0.0.1:5173', 'sec-fetch-site': 'same-origin' };
    const success = await request(headers); expect(success.status).toBe(200); expect(JSON.parse(success.body)).toEqual(session); expect(success.headers['Cache-Control']).toBe('no-store');
    expect((await request({ ...headers, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await request({ ...headers, host: 'remote.example' })).status).toBe(403);
    await chmod(file, 0o644); expect((await request(headers)).status).toBe(503);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
