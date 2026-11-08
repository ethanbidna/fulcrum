import { copyFile, chmod, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const POSTJECT = 'postject@1.0.0-alpha.6';
const TAURI_CLI = '@tauri-apps/cli@2.12.4';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const EXECUTABLE_MODE = 0o755;

export function targetTriple(architecture) {
  const triples = { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' };
  if (!triples[architecture]) throw new Error('Use x64 or arm64');
  return triples[architecture];
}

export function buildPlan(runtime, architecture) {
  const output = join(ROOT, 'out', runtime);
  const executable = join(output, `fulcrum-core-${targetTriple(architecture)}`);
  const sign = { program: 'codesign', args: ['--force', '--sign', '-', executable] };
  if (runtime === 'bun') return [
    { program: 'bun', args: ['build', '--compile', `--target=bun-darwin-${architecture}`, '--external=node:sqlite', join(ROOT, 'core.cjs'), '--outfile', executable] }, sign,
  ];
  if (runtime !== 'node') throw new Error('Use node or bun');
  return [
    { program: process.execPath, args: ['--experimental-sea-config', join(output, 'sea-config.json')] },
    { program: 'codesign', args: ['--remove-signature', executable], allowUnsigned: true },
    { program: 'npx', args: ['--yes', POSTJECT, executable, 'NODE_SEA_BLOB', join(output, 'sea.blob'), '--sentinel-fuse', SEA_FUSE, '--macho-segment-name', 'NODE_SEA'] }, sign,
  ];
}

function run(command, options = {}) {
  const result = spawnSync(command.program, command.args, { cwd: ROOT, env: { ...process.env, ...options.environment }, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' });
  if (result.status === 0) return result.stdout;
  if (command.allowUnsigned && result.stderr?.includes('not signed')) return;
  throw new Error(`Packaging command failed: ${command.program}`);
}

async function build(runtime, mode) {
  if (process.platform !== 'darwin') throw new Error('Build on macOS');
  if (!['sidecar', 'app'].includes(mode)) throw new Error('Use sidecar or app');
  const plan = buildPlan(runtime, process.arch);
  const output = join(ROOT, 'out', runtime);
  const triple = targetTriple(process.arch);
  const executable = join(output, `fulcrum-core-${triple}`);
  await mkdir(output, { recursive: true });
  if (runtime === 'node') {
    await copyFile(process.execPath, executable);
    await chmod(executable, EXECUTABLE_MODE);
    await writeFile(join(output, 'sea-config.json'), JSON.stringify({ main: join(ROOT, 'core.cjs'), output: join(output, 'sea.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  }
  for (const command of plan) run(command, { capture: Boolean(command.allowUnsigned) });
  const selfTest = JSON.parse(run({ program: executable, args: ['--self-test'] }, { capture: true }));
  if (!selfTest.fts5 || selfTest.matches !== 1 || selfTest.runtime !== runtime) throw new Error('Packaged FTS5 self-test failed');
  const version = run({ program: runtime === 'node' ? process.execPath : 'bun', args: ['--version'] }, { capture: true }).trim();
  await writeFile(join(output, 'build-info.json'), JSON.stringify({ runtime, version, architecture: process.arch, selfTest, postject: runtime === 'node' ? POSTJECT : null, tauriCli: TAURI_CLI }, null, 2));
  if (mode === 'sidecar') return;
  const binaries = join(ROOT, 'src-tauri', 'binaries');
  await mkdir(binaries, { recursive: true });
  await copyFile(executable, join(binaries, `fulcrum-core-${triple}`));
  run({ program: 'npx', args: ['--yes', TAURI_CLI, 'build', '--bundles', 'app', '--target', triple] }, { environment: { CARGO_TARGET_DIR: join(output, 'tauri-target') } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(process.argv[2], process.argv[3] ?? 'app').catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
