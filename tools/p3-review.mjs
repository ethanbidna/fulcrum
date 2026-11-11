import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/core/package.json', import.meta.url));
const { build } = require('esbuild');
const output = path.join(root, 'apps/core/dist-dev/p3-review.mjs');
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/core/dev/background-review.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node22', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
const directory = await mkdtemp(path.join(tmpdir(), 'fulcrum-p3-'));
try { const { reviewBackground } = await import(output); await reviewBackground(directory, new URL('../schemas/v1/', import.meta.url), process.argv.slice(2)); }
finally { await rm(directory, { recursive: true, force: true }); }
