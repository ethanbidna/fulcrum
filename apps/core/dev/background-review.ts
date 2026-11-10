import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { SyntheticSourceAdapter } from '@fulcrum/sources';
import { OllamaJsonRuntime, startBackgroundOllama } from '@fulcrum/llm';
import { startCore } from '../src/bootstrap.js';
import { SocketClient } from '../src/socket-client.js';
import { KeychainSecretStore } from '../src/secrets.js';
const REVIEW_PORT = 11439;
const MOCK_DELAY_MS = 10_000;
const USER_ID = '08000000-0000-7000-8000-000000000001';
export async function reviewBackground(directory: string, schemaDirectory: URL, args: string[]) {
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const executable = option('--ollama'); const model = option('--model'); const modelBytes = Number(option('--model-bytes'));
  if (args.length && (!executable || !model || !Number.isSafeInteger(modelBytes) || modelBytes <= 0)) throw new Error('Provide --ollama, --model and --model-bytes together');
  const runtime = model ? new OllamaJsonRuntime(model, `http://127.0.0.1:${REVIEW_PORT}`) : undefined;
  // Refuse to reuse another process's server for this measurement.
  if (runtime) {
    try { await fetch(`http://127.0.0.1:${REVIEW_PORT}/api/version`, { signal: AbortSignal.timeout(1000) }); throw new Error('REVIEW_PORT_OCCUPIED'); }
    catch (error) { if (error instanceof Error && error.message === 'REVIEW_PORT_OCCUPIED') throw error; }
  }
  const ownedRuntime = executable ? startBackgroundOllama({ executable, port: REVIEW_PORT }) : undefined;
  let runtimeFailed = false; ownedRuntime?.once('error', () => { runtimeFailed = true; });
  const secrets = new KeychainSecretStore();
  let processed = 0; let interrupted = 0;
  const server = await startCore({ localDirectory: path.join(directory, 'local'), workspaceDirectory: path.join(directory, 'workspace'),
    userEntityId: USER_ID, deviceLabel: 'Synthetic P3 Mac', create: true, schemaDirectory,
    background: { modelBytes: runtime ? modelBytes : 1 },
    ingestion: { adapters: [new SyntheticSourceAdapter({ now: new Date().toISOString(), days: 7 })], scopes: { synthetic: ['fixture'] },
      process: async (_item, { signal }) => {
        try {
          if (runtimeFailed) throw new Error('REVIEW_RUNTIME_UNAVAILABLE');
          if (runtime) await runtime.generate({ system: 'Return only a JSON object with a synthetic boolean.', input: 'Synthetic background resource trial.', schema: { type: 'object', properties: { synthetic: { type: 'boolean' } }, required: ['synthetic'] }, signal });
          else await delay(MOCK_DELAY_MS, undefined, { signal });
          signal.throwIfAborted(); processed++;
        } catch (error) { if (signal.aborted) interrupted++; throw error; }
      } },
  }, secrets).catch(error => { ownedRuntime?.kill(); throw error; });
  let client: SocketClient | undefined; let timer: NodeJS.Timeout | undefined;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const close = async () => { clearInterval(timer); terminal.close(); client?.close(); try { await server.close(); } finally { ownedRuntime?.kill(); } };
  try {
    client = await SocketClient.connect(server.socketPath, await secrets.getOrCreate());
    const history = await client.request('query', { name: 'history.list', args: {} }) as { deviceId: string }[];
    await client.request('execute', { name: 'settings.setIngestionDevice', args: { ingestionDeviceId: history[0]!.deviceId } });
    const status = async () => {
      const background = await client!.request('query', { name: 'status.background', args: {} }) as { sourcePause: string | null; extractionPause: string | null; sample: { power: string; thermal: string; batteryPercent: number | null } | null };
      const freshness = await client!.request('query', { name: 'status.freshness', args: {} });
      console.log(JSON.stringify({ freshness, sourcePause: background.sourcePause, extractionPause: background.extractionPause,
        power: background.sample?.power, thermal: background.sample?.thermal, batteryPercent: background.sample?.batteryPercent, processed, interrupted }));
    };
    console.log(runtime ? 'Explicit owned local-model trial; no reconciliation writes.' : 'Mock timing trial; this does not validate model CPU or memory use.');
    console.log(`In another terminal from this checkout, run:\nFULCRUM_DEV_PROFILE='${directory.replaceAll("'", "'\\''")}/local' pnpm --filter @fulcrum/desktop tauri dev`);
    console.log('Commands: status, pause, resume, present, return, plugged, any-power, override-battery, respect-battery, quit');
    await status(); timer = setInterval(() => { void status().catch(() => console.log('STATUS_UNAVAILABLE')); }, 5000);
    const commands: Record<string, Record<string, boolean>> = { pause: { paused: true }, resume: { paused: false }, present: { presenting: true }, return: { presenting: false }, plugged: { onlyWhenPluggedIn: true }, 'any-power': { onlyWhenPluggedIn: false }, 'override-battery': { batteryOverride: true }, 'respect-battery': { batteryOverride: false } };
    await new Promise<void>(resolve => {
      terminal.on('line', line => { const command = line.trim();
        if (command === 'quit') { resolve(); return; }
        if (command === 'status') { void status().catch(() => console.log('STATUS_UNAVAILABLE')); return; }
        if (commands[command]) void client!.request('background.configure', commands[command]).then(status).catch(() => console.log('CONTROL_UNAVAILABLE'));
      });
      terminal.once('close', resolve); process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
    });
  } finally { await close(); }
}
