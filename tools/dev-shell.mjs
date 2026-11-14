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
const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-shell-'));
let fixture; let server; let gmailTest;
const close = async () => { await gmailTest?.closeSession(); await server?.close(); await fixture?.close(); await rm(directory, { recursive: true, force: true }); };
try {
  const clientFile = process.env.FULCRUM_GMAIL_TEST_CLIENT_FILE;
  if (clientFile) {
    const { gmailTestPlugin } = await import('../spikes/s4/gmail-piece/desktop-session.mjs');
    gmailTest = await gmailTestPlugin(clientFile, process.env.FULCRUM_GMAIL_TEST_ACCOUNT);
    process.env.VITE_FULCRUM_GMAIL_TEST = 'enabled';
  } else {
    delete process.env.VITE_FULCRUM_GMAIL_TEST;
    await mkdir(path.dirname(output), { recursive: true });
    await build({ entryPoints: [path.join(root, 'apps/core/dev/fixture.ts')], outfile: output, bundle: true,
      alias: { 'jsonc-parser': path.join(root, 'packages/store/node_modules/jsonc-parser/lib/esm/main.js') },
      format: 'esm', platform: 'node', target: 'node22', banner: { js: "import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(import.meta.url);" } });
    const { startFixture } = await import(output);
    const snapshot = JSON.parse(await readFile(new URL('../fixtures/states/portfolio.state.json', import.meta.url), 'utf8'));
    fixture = await startFixture(directory, new URL('../schemas/v1/', import.meta.url), snapshot);
    process.env.FULCRUM_DEV_SESSION = fixture.sessionFile;
  }
  server = await createServer({ plugins: gmailTest ? [gmailTest.plugin] : [], root: path.join(root, 'apps/desktop'), configFile: path.join(root, 'apps/desktop/vite.config.ts') });
  await server.listen();
  console.log(clientFile
    ? 'Gmail test ready: http://127.0.0.1:5173'
    : 'Synthetic local workspace ready: http://127.0.0.1:5173. AI starts off.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) { await close(); throw error; }
