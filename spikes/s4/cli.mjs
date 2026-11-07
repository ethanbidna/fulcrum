import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { ApiClient, ProbeError, refreshGoogle } from './http.mjs';
import { probeSlack, probeGmail } from './probes.mjs';

const SECONDS_PER_DAY = 86400;
const BACKFILL_DAYS = 14;
const KIB = 1024;
const OUTPUT = new URL('./out/', import.meta.url);
const environment = process.env;

async function optionsFor(provider, mode) {
  const stateFile = new URL(`${provider}-state.json`, OUTPUT);
  if (mode === 'resume' || mode === 'incremental') {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (mode === 'incremental' && (provider !== 'gmail' || !state.historyId || state.pageToken)) throw new ProbeError('finish_backfill_first');
    if (mode === 'resume' && provider === 'gmail' && !state.pageToken) throw new ProbeError('no_pending_page');
    if (mode === 'resume' && provider === 'slack' && !state.historyCursor && !state.threadCursor) throw new ProbeError('no_pending_page');
    return state;
  }
  const now = Math.floor(Date.now() / 1000);
  if (provider === 'slack') return { channel: environment.SLACK_TEST_CHANNEL, oldest: String(now - BACKFILL_DAYS * SECONDS_PER_DAY), latest: String(now), threadTs: environment.SLACK_TEST_THREAD_TS };
  return { label: environment.GMAIL_TEST_LABEL, after: String(now - BACKFILL_DAYS * SECONDS_PER_DAY) };
}

async function tokenFor(provider) {
  if (provider === 'slack') return environment.SLACK_TEST_TOKEN;
  if (environment.GMAIL_TEST_REFRESH_TOKEN) return refreshGoogle(environment);
  return environment.GMAIL_TEST_ACCESS_TOKEN;
}

async function main() {
  const [provider, mode = 'backfill', extra] = process.argv.slice(2);
  if (!['slack', 'gmail'].includes(provider) || !['backfill', 'resume', 'incremental'].includes(mode) || extra) throw new ProbeError('usage_slack_or_gmail_backfill_resume_incremental');
  if (environment.S4_SYNTHETIC_ONLY !== 'yes') throw new ProbeError('confirm_throwaway_account');
  const options = await optionsFor(provider, mode);
  const client = new ApiClient(provider, await tokenFor(provider));
  const started = performance.now();
  const result = provider === 'slack' ? await probeSlack(client, options) : await probeGmail(client, options);
  const report = { provider, mode, observedAt: new Date().toISOString(), apiCalls: client.calls, elapsedMs: performance.now() - started,
    nodeVersion: process.version, processPeakRssBytes: process.resourceUsage().maxRSS * KIB,
    summary: result.summary, refreshExercised: provider === 'gmail' && Boolean(environment.GMAIL_TEST_REFRESH_TOKEN),
    authenticationFlowVerified: false, packageDiskBytes: null, runtimeMemoryBytes: null };
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(new URL(`${provider}-${mode}.json`, OUTPUT), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(new URL(`${provider}-state.json`, OUTPUT), `${JSON.stringify(result.continuation, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${provider}: probe complete; review the count-only report in spikes/s4/out/. Keep continuation state local.\n`);
}

main().catch(error => {
  const code = error instanceof ProbeError ? error.code : 'local_probe_failure';
  process.stderr.write(`${code}${error.retryAfterSeconds ? `; retry after ${error.retryAfterSeconds} seconds` : ''}\n`);
  process.exitCode = 1;
});
