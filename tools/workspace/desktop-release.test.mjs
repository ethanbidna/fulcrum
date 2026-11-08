import { test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
const execute = promisify(execFile);
test('release frontend excludes development bootstrap and websocket transport', async () => {
  await execute(process.execPath, ['build.mjs'], { cwd: 'apps/desktop' });
  const files = await readdir('apps/desktop/dist/assets');
  const script = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => readFile(`apps/desktop/dist/assets/${file}`, 'utf8')))).join('');
  for (const forbidden of ['/__fulcrum/session', 'LOCAL_DEVELOPMENT_BRIDGE_REQUIRED', 'new WebSocket(', 'KeychainSecretStore']) expect(script.includes(forbidden), forbidden).toBe(false);
  expect(files.some(file => file.endsWith('.svg'))).toBe(true);
  expect(await readFile('apps/desktop/dist/index.html', 'utf8')).not.toContain('http://');
}, 30_000);
