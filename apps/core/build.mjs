import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
const dev = process.argv.includes('--dev');
const output = new URL(dev ? './dist-dev/' : './dist/', import.meta.url);
await mkdir(output, { recursive: true });
const result = await build({ entryPoints: [new URL(dev ? './src/dev-main.ts' : './src/main.ts', import.meta.url).pathname], outfile: new URL('core.mjs', output).pathname,
  bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
if (!dev && Object.keys(result.metafile.inputs).some(file => /dev-bridge|dev-main|node_modules.*[\\/]ws[\\/]/.test(file))) throw new Error('DEVELOPMENT_CODE_IN_RELEASE');
await cp(new URL('../../schemas/v1/', import.meta.url), new URL('schemas/v1/', output), { recursive: true });

if (!dev) await build({ entryPoints: [new URL('./src/mcp-main.ts', import.meta.url).pathname], outfile: new URL('mcp.mjs', output).pathname, bundle: true, platform: 'node', target: 'node22', format: 'esm', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
