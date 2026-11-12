import { readFile, readdir } from 'node:fs/promises';
// Release transport selection must not inherit a test or development environment.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build({ mode: 'production' });
for (const file of await readdir('dist/assets')) {
  if (!file.endsWith('.js')) continue;
  const script = await readFile(`dist/assets/${file}`, 'utf8');
  if (['/__fulcrum/session', 'LOCAL_DEVELOPMENT_BRIDGE_REQUIRED', '/__fulcrum/gmail-test'].some(marker => script.includes(marker))) throw new Error('DEVELOPMENT_TRANSPORT_IN_RELEASE');
}
