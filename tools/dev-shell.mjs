import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const coreRequire = createRequire(new URL('../apps/core/package.json', import.meta.url));
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { build } = coreRequire('esbuild');
const { createServer } = await import(desktopRequire.resolve('vite'));
const output = path.join(root, 'apps/core/dist-dev/fixture.mjs');
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/core/dev/fixture.ts')], outfile: output, bundle: true,
  alias: { 'jsonc-parser': path.join(root, 'packages/store/node_modules/jsonc-parser/lib/esm/main.js') },
  format: 'esm', platform: 'node', target: 'node22', banner: { js: "import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(import.meta.url);" } });
const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-shell-'));
let fixture; let server;
const close = async () => { await server?.close(); await fixture?.close(); await rm(directory, { recursive: true, force: true }); };
try {
  const { startFixture } = await import(output);
  const snapshot = JSON.parse(await readFile(new URL('../fixtures/states/portfolio.state.json', import.meta.url), 'utf8'));
  fixture = await startFixture(directory, new URL('../schemas/v1/', import.meta.url), snapshot);
  process.env.FULCRUM_DEV_SESSION = fixture.sessionFile;
  server = await createServer({ root: path.join(root, 'apps/desktop'), configFile: path.join(root, 'apps/desktop/vite.config.ts') });
  await server.listen();
  console.log('Synthetic local workspace ready: http://127.0.0.1:5173');
  console.log('No connectors or Keychain access. AI starts off; manual commands work without it. Ctrl-C stops this session.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) { await close(); throw error; }
