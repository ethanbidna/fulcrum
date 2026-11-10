import { expect, test } from 'vitest';
import { BackgroundPolicy } from '../../packages/ingest/src/index.ts';
const MIB = 1024 * 1024;
const sample = { awake: true, wakeGeneration: 0, power: 'ac', batteryPercent: 80, thermal: 'nominal', availableMemoryBytes: 8000 * MIB, architecture: 'intel' };
const settings = { modelBytes: 2000 * MIB, wakeGraceMs: 60_000, signalTimeoutMs: 15_000 };
test('signals fail closed, sleep pauses immediately and wake waits for network grace', () => {
  const policy = new BackgroundPolicy(settings); expect(policy.reason(0, 'sources')).toContain('signals');
  policy.observe(sample, 0); expect(policy.reason(0, 'sources')).toContain('wake');
  for (let time = 5000; time <= 60_000; time += 5000) policy.observe(sample, time); expect(policy.reason(60_000, 'sources')).toBeNull();
  policy.observe({ ...sample, awake: false }, 60_001); expect(policy.reason(60_001, 'sources')).toContain('asleep');
  policy.observe(sample, 60_002); expect(policy.reason(60_003, 'sources')).toContain('wake');
  expect(policy.reason(90_000, 'sources')).toContain('signals');
});
test('battery thresholds, plugged-in preference and explicit override are configurable', () => {
  const policy = new BackgroundPolicy({ ...settings, wakeGraceMs: 0 });
  policy.observe({ ...sample, power: 'battery', batteryPercent: 49 }, 0); expect(policy.reason(0, 'sources')).toContain('battery');
  policy.configure({ batteryOverride: true }); expect(policy.reason(0, 'sources')).toBeNull();
  policy.configure({ onlyWhenPluggedIn: true }); expect(policy.reason(0, 'sources')).toContain('plugged');
  policy.configure({ batteryOverride: false, onlyWhenPluggedIn: false });
  policy.observe({ ...sample, architecture: 'apple_silicon', power: 'battery', batteryPercent: 30 }, 1); expect(policy.reason(1, 'sources')).toBeNull();
  policy.observe({ ...sample, architecture: 'apple_silicon', power: 'battery', batteryPercent: 29 }, 2); expect(policy.reason(2, 'sources')).toContain('battery');
});
test('thermal unknown/serious/critical, memory admission and Intel throughput never permit a second batch early', () => {
  const policy = new BackgroundPolicy({ ...settings, wakeGraceMs: 0 });
  policy.observe({ ...sample, thermal: 'serious' }, 0); expect(policy.reason(0, 'sources')).toContain('thermal');
  policy.observe({ ...sample, thermal: 'fair' }, 1); expect(policy.reason(1, 'sources')).toBeNull();
  policy.observe({ ...sample, availableMemoryBytes: 2999 * MIB }, 2); expect(policy.reason(2, 'extraction')).toContain('memory');
  policy.observe(sample, 3); expect(policy.reason(3, 'extraction')).toBeNull(); policy.started(3);
  expect(policy.reason(3, 'sources')).toBeNull(); expect(policy.reason(3, 'extraction')).toContain('throttle');
  policy.observe(sample, 120_003); expect(policy.reason(120_003, 'extraction')).toBeNull();
  policy.configure({ presenting: true }); expect(policy.reason(120_003, 'sources')).toContain('presenting');
  policy.configure({ presenting: false, paused: true }); expect(policy.reason(120_003, 'sources')).toContain('user');
});
test('invalid samples/settings cannot replace a valid policy or refresh stale observations', () => {
  const policy = new BackgroundPolicy({ ...settings, wakeGraceMs: 0 }); policy.observe(sample, 0);
  for (const invalid of [{ batteryPercent: 101 }, { awake: 'true' }, { thermal: 'hot' }, { power: ['ac'] }, { thermal: ['fair'] }, { architecture: ['intel'] }, { availableMemoryBytes: -1 }, { surprise: 'setting' }]) expect(() => policy.observe({ ...sample, ...invalid }, 10)).toThrow();
  for (const invalid of [{ memoryMultiplier: 0 }, { intelBatchIntervalMs: -1 }, { paused: 'true' }, { extra: true }]) expect(() => policy.configure(invalid)).toThrow();
  expect(policy.reason(20_000, 'sources')).toContain('signals');
});
test('coalesced native wake generations still trigger grace without an observed asleep sample', () => {
  const policy = new BackgroundPolicy(settings);
  for (let time = 0; time <= 60_000; time += 5000) policy.observe(sample, time);
  expect(policy.reason(60_000, 'sources')).toBeNull();
  policy.observe({ ...sample, wakeGeneration: 1 }, 60_001); expect(policy.reason(60_001, 'sources')).toContain('wake');
});
async function ingestion(run) {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises'); const path = await import('node:path');
  const { SqliteIngestionQueue, SyntheticSourceAdapter } = await import('../../packages/sources/src/index.ts');
  const { IngestionScheduler } = await import('../../packages/ingest/src/index.ts');
  const directory = await mkdtemp('/tmp/fp3-'); const localDirectory = path.join(directory, 'local'); const workspaceDirectory = path.join(directory, 'workspace');
  await mkdir(localDirectory); await mkdir(workspaceDirectory);
  const queue = await SqliteIngestionQueue.open({ localDirectory, workspaceDirectory, workspaceId: 'synthetic-p3' });
  let now = Date.parse('2026-11-10T12:00:00Z'); const policy = new BackgroundPolicy({ ...settings, wakeGraceMs: 0, intelBatchIntervalMs: 0 });
  policy.observe(sample, now); let scheduler;
  const create = process => scheduler = new IngestionScheduler({ queue, adapters: [new SyntheticSourceAdapter({ now: new Date(now).toISOString(), days: 2 })], deviceId: 'synthetic-device', ingestionDeviceId: () => 'synthetic-device',
    now: () => new Date(now).toISOString(), relevance: () => ({ userId: 'synthetic-user', terms: [], linkedThreadIds: [], excludedAuthorIds: [] }),
    pauseReason: phase => policy.reason(now, phase), extractionStarted: () => policy.started(now), ...(process ? { process } : {}) });
  try { await run({ queue, policy, create, now: () => now, advance: elapsed => { now += elapsed; } }); }
  finally { await scheduler?.close(); queue.close(); await rm(directory, { recursive: true, force: true }); }
}
test('sleep/thermal abort leaves durable pending work, and a late model result cannot acknowledge it', async () => ingestion(async f => {
  let started; const entered = new Promise(resolve => { started = resolve; }); let release; let signal;
  const scheduler = f.create(async (_item, context) => { signal = context.signal; started(); await new Promise(resolve => { release = resolve; }); });
  await scheduler.configure('synthetic', ['fixture']); const running = scheduler.tick(); await entered;
  f.policy.observe({ ...sample, thermal: 'serious' }, f.now()); scheduler.interrupt(); await running;
  expect(signal.aborted).toBe(true); expect(f.queue.counts()).toMatchObject({ pending: 2, failed: 0 });
  release(); await Promise.resolve(); expect(f.queue.counts().pending).toBe(2); expect(scheduler.status().state).toBe('paused');
  await scheduler.close(); let processed = 0; const resumed = f.create(async () => { processed++; });
  f.policy.observe({ ...sample, thermal: 'fair' }, f.now()); await resumed.tick(); expect(processed).toBe(2); expect(resumed.status().state).toBe('current');
}));
test('missing model profile and low memory never turn a completed source scan into false freshness', async () => ingestion(async f => {
  const scheduler = f.create(async () => { throw new Error('Must not process'); });
  f.policy.configure({ modelBytes: null }); await scheduler.configure('synthetic', ['fixture']); await scheduler.tick();
  expect(scheduler.status()).toMatchObject({ state: 'paused', pending: 2, failed: 0 });
  expect(scheduler.status().label).toContain('profile');
  f.policy.configure({ modelBytes: settings.modelBytes }); f.policy.observe({ ...sample, availableMemoryBytes: MIB }, f.now());
  await scheduler.tick(); expect(scheduler.status().label).toContain('memory'); expect(f.queue.counts().pending).toBe(2);
}));
test('expired system signals interrupt an already running model on the next tick', async () => ingestion(async f => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const scheduler = f.create(async () => { entered(); await new Promise(() => {}); });
  await scheduler.configure('synthetic', ['fixture']); const running = scheduler.tick(); await started;
  f.advance(20_000); await scheduler.tick(); await running;
  expect(scheduler.status()).toMatchObject({ state: 'paused', pending: 2, failed: 0 });
}));
test('core controls interrupt extraction while queries and paused-ingestion lifetime remain available', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const path = await import('node:path');
  const { vi } = await import('vitest');
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts');
  const { SyntheticSourceAdapter } = await import('../../packages/sources/src/index.ts');
  const directory = await mkdtemp('/tmp/fp3-core-'); let host; let entered; let signal;
  const started = new Promise(resolve => { entered = resolve; });
  try {
    host = await openWorkspaceHost({ localDirectory: path.join(directory, 'local'), workspaceDirectory: path.join(directory, 'workspace'),
      userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic P3 Mac', create: true,
      background: { wakeGraceMs: 0, modelBytes: 1 }, ingestion: { adapters: [new SyntheticSourceAdapter({ now: new Date().toISOString(), days: 2 })], scopes: { synthetic: ['fixture'] },
        process: async (_item, context) => { signal = context.signal; entered(); await new Promise(() => {}); } } });
    const deviceId = (await host.query('history.list', {}))[0].deviceId;
    expect(await host.execute({ name: 'settings.setIngestionDevice', args: { ingestionDeviceId: deviceId } })).toMatchObject({ ok: true });
    expect((await host.query('status.background', {})).sourcePause).toContain('signals');
    host.observeSystem(sample); await started;
    const portfolio = await host.query('portfolio.list', {});
    host.configureBackground({ paused: true });
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(await host.query('status.freshness', {})).toMatchObject({ state: 'paused', pending: 2, failed: 0 });
    expect(await host.query('portfolio.list', {})).toEqual(portfolio); expect(host.ingestionActive()).toBe(true);
    expect(() => host.observeSystem({ ...sample, awake: 'yes' })).toThrow();
    expect(() => host.configureBackground({ system: 'untrusted' })).toThrow();
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('priority admission failure cannot be overridden by a user setting', () => {
  const policy = new BackgroundPolicy({ wakeGraceMs: 0 }, 'Local ingestion paused — background priority unavailable');
  policy.observe(sample, 0); policy.configure({ paused: false, batteryOverride: true });
  expect(policy.reason(0, 'sources')).toContain('priority');
});
test('a rapid pause/resume never marks an interrupted model item failed', async () => ingestion(async f => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const scheduler = f.create(async () => { entered(); await new Promise(() => {}); });
  await scheduler.configure('synthetic', ['fixture']); const running = scheduler.tick(); await started;
  scheduler.interrupt(); await running;
  expect(f.queue.counts()).toMatchObject({ pending: 2, failed: 0 });
}));
