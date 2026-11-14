import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the updater plugin has a config section so the app can start', async () => {
  const config = JSON.parse(await readFile('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
  expect(typeof config.plugins?.updater?.pubkey).toBe('string');
});
