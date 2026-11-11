import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteIngestionQueue, SyntheticSourceAdapter } from '../../packages/sources/src/index.ts';
import { IngestionScheduler } from '../../packages/ingest/src/index.ts';
const NOW = '2026-01-08T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
async function setup(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fi1-'));
  const localDirectory = path.join(directory, 'local'); const workspaceDirectory = path.join(directory, 'workspace');
  await mkdir(localDirectory); await mkdir(workspaceDirectory);
  const options = { localDirectory, workspaceDirectory, workspaceId: 'synthetic-workspace' };
  let queue = await SqliteIngestionQueue.open(options); let scheduler;
  let now = NOW; let designated = 'device-a'; const processed = [];
  const adapter = new SyntheticSourceAdapter({ now: NOW });
  const settings = { adapters: [adapter], deviceId: 'device-a', ingestionDeviceId: () => designated, now: () => now,
    relevance: () => ({ userId: 'synthetic-user', terms: ['Vendor evaluation'], linkedThreadIds: [], excludedAuthorIds: [] }),
    process: async (item, context) => { context.signal.throwIfAborted(); processed.push(item); } };
  const make = (overrides = {}) => scheduler = new IngestionScheduler({ ...settings, queue, ...overrides });
  try { await run({ options, directory, adapter, settings, processed, make, queue: () => queue,
    setNow: value => now = value, designate: value => designated = value,
    reopen: async () => { await scheduler?.close(); queue.close(); queue = await SqliteIngestionQueue.open(options); return make(); } }); }
  finally { await scheduler?.close(); queue.close(); await rm(directory, { recursive: true, force: true }); }
}
test('scenario 1 ingestion: seven days catch up newest-first and freshness stays honest', async () => setup(async f => {
  const labels = [];
  const scheduler = f.make({ process: async item => { labels.push(scheduler.status()); f.processed.push(item); } });
  expect(scheduler.status().state).toBe('disabled'); await scheduler.tick(); expect(f.processed).toHaveLength(0);
  await scheduler.configure('synthetic', ['fixture']); expect(scheduler.status().state).toBe('unknown');
  await scheduler.tick(); expect(f.processed).toHaveLength(7);
  expect(f.processed.map(item => item.happenedAt)).toEqual(Array.from({ length: 7 }, (_, day) => new Date(Date.parse(NOW) - day * DAY_MS).toISOString()));
  expect(labels.every(status => status.state === 'catching-up')).toBe(true);
  expect(labels.map(status => status.pending)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  expect(scheduler.status()).toMatchObject({ state: 'current', checkedAt: NOW, pending: 0 });
  await scheduler.tick(); expect(f.processed).toHaveLength(7);
  const restarted = await f.reopen(); expect(restarted.status().state).toBe('current');
  f.setNow('2026-01-08T12:02:00.000Z'); await restarted.tick(); expect(f.processed).toHaveLength(7);
}));
test('pages commit atomically with cursors; discovery completes before extraction and resumes after restart', async () => setup(async f => {
  const adapter = { ...f.adapter, id: 'synthetic', scopes: () => f.adapter.scopes(), read: (...args) => f.adapter.read(...args), permalink: () => null,
    pull: (scope, cursor, limits) => f.adapter.pull(scope, cursor, { ...limits, limit: 2 }) };
  const first = await adapter.pull({ id: 'fixture' }, null, { since: '2026-01-01', limit: 2, signal: new AbortController().signal });
  f.queue().configure('synthetic', [{ id: 'fixture', label: 'Fixture' }]); f.queue().begin('synthetic', 'fixture');
  f.queue().recordPage('synthetic', 'fixture', first, NOW);
  expect(f.queue().scopes()[0]).toMatchObject({ cursor: null, next: first.next, checkedAt: null, scanning: true });
  const scheduler = await f.reopen(); await scheduler.close();
  const resumed = f.make({ adapters: [adapter] }); await resumed.tick(); expect(f.processed).toHaveLength(7);
  expect(resumed.status().state).toBe('current');
  const badPage = { items: [{ ...first.items[0], scopeId: 'unselected' }], next: null, checkpoint: 'bad' };
  expect(() => f.queue().recordPage('synthetic', 'fixture', badPage, NOW)).toThrow('INVALID_SOURCE_PAGE');
  expect(f.queue().scopes()[0].cursor).not.toBe('bad');
}));
test('no extraction means durable pending refs, never up to date or retained full source text', async () => setup(async f => {
  const scheduler = f.make({ process: undefined }); await scheduler.configure('synthetic', ['fixture']); await scheduler.tick();
  expect(scheduler.status()).toMatchObject({ state: 'awaiting-extraction', pending: 7 });
  const bytes = await readFile(path.join(f.options.localDirectory, 'ingestion.sqlite'));
  expect(bytes.includes(Buffer.from('I will review the synthetic update'))).toBe(false);
  const restarted = await f.reopen(); await restarted.tick(); expect(f.processed).toHaveLength(7);
}));
test('scope opt-in/revocation, exclusions and deterministic relevance leave no unsorted backlog', async () => setup(async f => {
  const scheduler = f.make({ relevance: () => ({ userId: 'other', terms: [], linkedThreadIds: [], excludedAuthorIds: ['synthetic-user'] }) });
  await expect(scheduler.configure('synthetic', ['private'])).rejects.toThrow('UNKNOWN_SOURCE_SCOPE');
  await scheduler.configure('synthetic', ['fixture']); await scheduler.tick(); expect(f.processed).toHaveLength(0);
  expect(scheduler.status()).toMatchObject({ state: 'current', pending: 0 });
  await scheduler.configure('synthetic', []); expect(f.queue().scopes()).toEqual([]); expect(f.queue().counts().pending).toBe(0);
}));
test('P11 blocks viewer pulls and a mid-request device handover discards returned work', async () => setup(async f => {
  let release; const pull = vi.fn(() => new Promise(resolve => release = resolve));
  const adapter = { id: 'synthetic', scopes: () => f.adapter.scopes(), pull, read: (...args) => f.adapter.read(...args), permalink: () => null };
  const scheduler = f.make({ adapters: [adapter] }); await scheduler.configure('synthetic', ['fixture']);
  f.designate('device-b'); await scheduler.tick(); expect(pull).not.toHaveBeenCalled(); expect(scheduler.status().state).toBe('viewer');
  f.designate('device-a'); const run = scheduler.tick(); await Promise.resolve(); f.designate('device-b');
  release(await f.adapter.pull({ id: 'fixture' }, null, { since: '2026-01-01', limit: 50, signal: new AbortController().signal })); await run;
  expect(f.queue().pending()).toEqual([]); expect(f.processed).toHaveLength(0);
}));
test('connector failures back off and do not claim freshness; independent scopes can still pull', async () => setup(async f => {
  const failing = { id: 'broken', scopes: async () => [{ id: 'fixture', label: 'Broken' }], pull: vi.fn(async () => { throw new Error('secret auth details'); }), read: async () => null, permalink: () => null };
  const scheduler = f.make({ adapters: [f.adapter, failing] }); await scheduler.configure('synthetic', ['fixture']); await scheduler.configure('broken', ['fixture']);
  await scheduler.tick(); expect(scheduler.status()).toMatchObject({ state: 'reconnect', pending: 0 });
  expect(f.processed).toHaveLength(7); expect(f.queue().scopes()[0].error).toBe('SOURCE_UNAVAILABLE'); await scheduler.tick(); expect(failing.pull).toHaveBeenCalledTimes(1);
  f.setNow('2026-01-08T12:01:00.000Z'); await scheduler.tick(); expect(failing.pull).toHaveBeenCalledTimes(2);
}));
test('single-flight tick; pause cancels in-flight calls; processor failure is retained without automatic replay', async () => setup(async f => {
  let entered; const started = new Promise(resolve => entered = resolve);
  const scheduler = f.make({ process: async (_item, { signal }) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  await scheduler.configure('synthetic', ['fixture']); const run = scheduler.tick(); expect(scheduler.tick()).toBe(run);
  await started; scheduler.pause(); await run; expect(scheduler.status()).toMatchObject({ state: 'paused', pending: 7 });
  await scheduler.close(); const failed = f.make({ process: async () => { throw new Error('synthetic failure'); } });
  await failed.tick(); expect(failed.status()).toMatchObject({ state: 'failed', failed: 7, pending: 0 });
  await failed.tick(); expect(failed.status().failed).toBe(7);
}));
test('content edits enqueue new hash; repeated pages and canonical handover receipts dedupe', async () => setup(async f => {
  const scheduler = f.make(); await scheduler.configure('synthetic', ['fixture']); await scheduler.tick();
  const item = { ...f.processed[0], text: 'Vendor evaluation: updated synthetic statement' };
  f.queue().recordPage('synthetic', 'fixture', { items: [item, item], next: null, checkpoint: 'edited' }, NOW);
  expect(f.queue().pending()).toHaveLength(1);
  await scheduler.close(); const handedOver = f.make({ recordedSources: () => [{ connector: item.connector, remoteId: item.remoteId, contentHash: `sha256:${f.queue().digest(item.text)}` }] });
  await handedOver.tick(); expect(f.processed).toHaveLength(7); expect(f.queue().pending()).toHaveLength(0);
}));
test('queue refuses workspace paths, symlinks and foreign-workspace reuse', async () => setup(async f => {
  await expect(SqliteIngestionQueue.open({ ...f.options, localDirectory: f.options.workspaceDirectory })).rejects.toThrow('QUEUE_INSIDE_WORKSPACE');
  await expect(SqliteIngestionQueue.open({ ...f.options, workspaceId: 'other-workspace' })).rejects.toThrow('QUEUE_WORKSPACE_MISMATCH');
  const other = path.join(f.directory, 'other'); await mkdir(other); const sentinel = path.join(f.directory, 'sentinel'); await writeFile(sentinel, 'synthetic sentinel');
  await symlink(sentinel, path.join(other, 'ingestion.sqlite'));
  await expect(SqliteIngestionQueue.open({ ...f.options, localDirectory: other })).rejects.toThrow('INVALID_QUEUE_FILE');
  expect(await readFile(sentinel, 'utf8')).toBe('synthetic sentinel');
}));
test('core defaults off and exposes freshness without changing the portfolio or enabling inference', async () => {
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts'); const directory = await mkdtemp(path.join(tmpdir(), 'fi1-core-')); let host;
  try {
    host = await openWorkspaceHost({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', create: true });
    expect(await host.query('status.freshness', {})).toMatchObject({ state: 'disabled', pending: 0 }); expect(host.ingestionActive()).toBe(false);
    const portfolio = await host.query('portfolio.list', {}); await host.close();
    host = await openWorkspaceHost({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', ingestion: { adapters: [new SyntheticSourceAdapter({ now: NOW })], scopes: { synthetic: ['fixture'] } } });
    expect(await host.query('status.freshness', {})).toMatchObject({ state: 'viewer' }); expect(host.ingestionActive()).toBe(false); expect(await host.query('portfolio.list', {})).toEqual(portfolio);
    const deviceId = (await host.query('history.list', {}))[0].deviceId;
    expect(await host.execute({ name: 'settings.setIngestionDevice', args: { ingestionDeviceId: deviceId } })).toMatchObject({ ok: true });
    await host.close();
    host = await openWorkspaceHost({ workspaceDirectory: path.join(directory, 'workspace'), localDirectory: path.join(directory, 'local'), userEntityId: '08000000-0000-7000-8000-000000000001', deviceLabel: 'Synthetic Mac', ingestion: { adapters: [new SyntheticSourceAdapter({ now: new Date().toISOString() })], scopes: { synthetic: ['fixture'] } } });
    host.configureBackground({ wakeGraceMs: 0 });
    host.observeSystem({ awake: true, wakeGeneration: 0, power: 'ac', batteryPercent: 80, thermal: 'nominal', availableMemoryBytes: 8000000000, architecture: 'intel' });
    await vi.waitFor(async () => expect(await host.query('status.freshness', {})).toMatchObject({ state: 'awaiting-extraction', pending: 7 }), { timeout: 3000 });
    expect(host.ingestionActive()).toBe(true); expect(await host.query('portfolio.list', {})).toEqual(portfolio);
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('duplicate messages across scopes process once; receipts survive repeat pages and text normalization', async () => setup(async f => {
  f.queue().configure('synthetic', [{ id: 'fixture', label: 'Fixture' }, { id: 'second', label: 'Second' }]);
  const page = await f.adapter.pull({ id: 'fixture' }, null, { since: '2026-01-01', limit: 1, signal: new AbortController().signal });
  const source = page.items[0];
  f.queue().recordPage('synthetic', 'fixture', { items: [source], next: null, checkpoint: 'a' }, NOW);
  f.queue().recordPage('synthetic', 'second', { items: [{ ...source, scopeId: 'second' }], next: null, checkpoint: 'b' }, NOW);
  const scheduler = f.make(); await scheduler.tick(); expect(f.processed).toHaveLength(1); expect(f.queue().pending()).toHaveLength(0);
  f.queue().recordPage('synthetic', 'second', { items: [{ ...source, scopeId: 'second', text: `  ${source.text}\r\n` }], next: null, checkpoint: 'c' }, NOW);
  expect(f.queue().pending()).toHaveLength(0);
}));
test('a source deadline aborts transport and records bounded retry state', async () => setup(async f => {
  vi.useFakeTimers();
  try {
    let signal;
    const adapter = { id: 'synthetic', scopes: () => f.adapter.scopes(), pull: (_scope, _cursor, limits) => { signal = limits.signal; return new Promise(() => {}); }, read: async () => null, permalink: () => null };
    const scheduler = f.make({ adapters: [adapter] }); await scheduler.configure('synthetic', ['fixture']);
    const run = scheduler.tick(); await vi.advanceTimersByTimeAsync(60_000); await run;
    expect(signal.aborted).toBe(true); expect(scheduler.status().state).toBe('reconnect');
    expect(f.queue().scopes()[0]).toMatchObject({ failures: 1, retryAt: '2026-01-08T12:00:30.000Z' });
  } finally { vi.useRealTimers(); }
}));
test('a failed SQL batch rolls back both item inserts and the cursor', async () => setup(async f => {
  const { DatabaseSync } = await import('node:sqlite');
  f.queue().configure('synthetic', [{ id: 'fixture', label: 'Fixture' }]);
  const database = new DatabaseSync(path.join(f.options.localDirectory, 'ingestion.sqlite'));
  try {
    database.exec("CREATE TRIGGER synthetic_fault BEFORE INSERT ON items WHEN NEW.remote_id='day-1' BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;");
    const page = await f.adapter.pull({ id: 'fixture' }, null, { since: '2026-01-01', limit: 2, signal: new AbortController().signal });
    expect(() => f.queue().recordPage('synthetic', 'fixture', page, NOW)).toThrow('synthetic fault');
    expect(f.queue().pending()).toEqual([]); expect(f.queue().scopes()[0]).toMatchObject({ cursor: null, next: null, checkedAt: null });
  } finally { database.close(); }
}));

test('a fresh handover queue skips schema-valid canonical source receipts before extraction',async()=>setup(async f=>{
 const page=await f.adapter.pull({id:'fixture'},null,{since:'2026-01-01',limit:50,signal:new AbortController().signal});
 const canonical=page.items.map(item=>({connector:item.connector,remoteId:item.remoteId,contentHash:`sha256:${f.queue().digest(item.text)}`}));
 expect(canonical).toHaveLength(7);expect(canonical.every(item=>/^sha256:[a-f0-9]{64}$/.test(item.contentHash))).toBe(true);
 const scheduler=f.make({recordedSources:()=>canonical});await scheduler.configure('synthetic',['fixture']);await scheduler.tick();
 expect(f.processed).toHaveLength(0);expect(f.queue().pending()).toHaveLength(0);
}));
