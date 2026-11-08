import { expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SqliteReadIndex } from '../../packages/index/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
const validators = loadValidators();
const fixture = () => readJson('fixtures/states/portfolio.state.json');
const id = (prefix, number) => `${prefix}000000-0000-7000-8000-${String(number).padStart(12, '0')}`;
async function setup(run, overrides = {}) {
  const directory = await mkdtemp('/tmp/fc7-'); const localDirectory = path.join(directory, 'local'); const workspaceDirectory = path.join(directory, 'workspace');
  await mkdir(localDirectory, { mode: 0o700 }); await mkdir(workspaceDirectory); let snapshot = fixture(); let index;
  const progress = []; const options = { localDirectory, workspaceDirectory, getSnapshot: () => { expect(validators.workspaceState(snapshot), JSON.stringify(validators.workspaceState.errors)).toBe(true); return snapshot; }, onProgress: value => progress.push(value), ...overrides };
  try { index = await SqliteReadIndex.open(options); await run({ index, progress, options, directory, snapshot: () => snapshot, setSnapshot: value => { snapshot = value; } }); }
  finally { await index?.close(); await rm(directory, { recursive: true, force: true }); }
}
test('real FTS5 indexes initiatives, nodes, aliases and source titles/excerpts', async () => setup(async f => {
  expect((await f.index.search('Vendor evaluation')).some(hit => hit.kind === 'initiative')).toBe(true);
  expect((await f.index.search('Legal')).some(hit => hit.kind === 'entity')).toBe(true);
  expect(f.index.status()).toMatchObject({ phase: 'ready' });
  expect(f.progress[0]).toMatchObject({ phase: 'rebuilding', completed: 0 });
  expect(f.progress.at(-1).completed).toBe(f.progress.at(-1).total);
}));
test('incremental application replaces old text and removes tombstoned records', async () => setup(async f => {
  const snapshot = f.snapshot(); const node = snapshot.state.nodes[0]; node.title = 'Quasar synthetic update';
  await f.index.apply({ eventId: id('09', 1), ops: [{ op: 'set', kind: 'node', id: node.id, field: 'title', value: node.title, baseEventId: null }] });
  expect((await f.index.search('Quasar')).map(hit => hit.id)).toContain(node.id);
  snapshot.state.nodes = snapshot.state.nodes.filter(record => record.id !== node.id);
  await f.index.apply({ eventId: id('09', 2), ops: [{ op: 'tombstone', kind: 'node', id: node.id }] });
  expect(await f.index.search('Quasar')).toEqual([]);
}));
test('cachePolicy none never indexes excerpts, including after revocation', async () => setup(async f => {
  const source = f.snapshot().state.sources[0]; source.excerpt = 'Nebulasecret excerpt'; source.cachePolicy = 'excerpt';
  await f.index.rebuild(f.snapshot()); expect((await f.index.search('Nebulasecret', { includeExcerpts: true })).some(hit => hit.id === source.id)).toBe(true);
  source.cachePolicy = 'none'; await f.index.apply({ eventId: id('09', 3), ops: [] }); expect(await f.index.search('Nebulasecret', { includeExcerpts: true })).toEqual([]);
}));
test('deleting the index and reopening rebuilds it with count progress', async () => setup(async f => {
  await f.index.close(); await rm(path.join(f.options.localDirectory, 'index.sqlite')); const progress = [];
  const reopened = await SqliteReadIndex.open({ ...f.options, onProgress: value => progress.push(value) });
  try { expect((await reopened.search('Vendor')).length).toBeGreaterThan(0); expect(progress.some(item => item.phase === 'rebuilding')).toBe(true); }
  finally { await reopened.close(); }
}));
test('corrupt cache is preserved and rebuilt without changing the workspace', async () => setup(async f => {
  await f.index.close(); await writeFile(path.join(f.options.localDirectory, 'index.sqlite'), 'synthetic corrupt cache');
  const reopened = await SqliteReadIndex.open(f.options);
  try { expect((await reopened.search('Vendor')).length).toBeGreaterThan(0); expect(await readFile(path.join(f.options.localDirectory, 'index.sqlite.invalid'), 'utf8')).toBe('synthetic corrupt cache'); }
  finally { await reopened.close(); }
}));
test('query text is literal and empty or invalid scopes fail safely', async () => setup(async f => {
  expect(await f.index.search('')).toEqual([]); expect(await f.index.search('" OR 1=1 --')).toEqual([]);
  expect(await f.index.search('Vendor', { initiativeIds: [] })).toEqual([]);
  await expect(f.index.search('Vendor', { limit: -1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
}));
test('scope changes update shared source membership without cloning records', async () => setup(async f => {
  const snapshot = f.snapshot(); const source = snapshot.state.sources[0]; source.title = 'Nebulapointer';
  snapshot.state.initiatives[0].evidenceRefs = [{ sourceId: source.id }];
  await f.index.rebuild(snapshot);
  expect((await f.index.search('Nebulapointer', { initiativeIds: [snapshot.state.initiatives[0].id] }))).toHaveLength(1);
  expect(await f.index.search('Nebulapointer', { initiativeIds: [id('01', 999)] })).toEqual([]);
}));
test('source excerpt opt-in cannot be bypassed by query syntax', async () => setup(async f => {
  const source = f.snapshot().state.sources[0]; source.excerpt = 'Stellarconfidential'; source.cachePolicy = 'excerpt';
  await f.index.rebuild(f.snapshot());
  expect(await f.index.search('Stellarconfidential')).toEqual([]);
  expect(await f.index.search('body:Stellarconfidential')).toEqual([]);
  const hits = await f.index.search('Stellarconfidential', { includeExcerpts: true });
  expect(hits).toContainEqual(expect.objectContaining({ id: source.id, untrustedExcerpt: expect.stringContaining('Stellarconfidential') }));
}));
test('replaying an old change uses current canonical state rather than patching stale values', async () => setup(async f => {
  const node = f.snapshot().state.nodes[0]; node.title = 'Quasarcurrent';
  const old = { eventId: id('09', 9), ops: [{ op: 'set', kind: 'node', id: node.id, field: 'title', value: 'Nebulaold', baseEventId: null }] };
  await f.index.apply(old); await f.index.apply(old);
  expect(await f.index.search('Nebulaold')).toEqual([]); expect(await f.index.search('Quasarcurrent')).toHaveLength(1);
}));
test('local path and symlink guards preserve the portable workspace layout', async () => {
  const { symlink, access } = await import('node:fs/promises'); const directory = await mkdtemp('/tmp/fc7-');
  const workspaceDirectory = path.join(directory, 'workspace'); await mkdir(workspaceDirectory); const snapshot = fixture();
  try {
    await expect(SqliteReadIndex.open({ localDirectory: workspaceDirectory, workspaceDirectory, getSnapshot: () => snapshot })).rejects.toThrow();
    await expect(access(path.join(workspaceDirectory, 'index.sqlite'))).rejects.toThrow();
    const localDirectory = path.join(directory, 'local'); await mkdir(localDirectory); const target = path.join(directory, 'sentinel'); await writeFile(target, 'synthetic sentinel'); await symlink(target, path.join(localDirectory, 'index.sqlite'));
    await expect(SqliteReadIndex.open({ localDirectory, workspaceDirectory, getSnapshot: () => snapshot })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('synthetic sentinel');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('progress observers cannot break a rebuild and query scopes filter record kinds', async () => setup(async f => {
  const hits = await f.index.search('Legal', { kinds: ['entity'] }); expect(hits.length).toBeGreaterThan(0); expect(hits.every(hit => hit.kind === 'entity')).toBe(true);
}, { onProgress: () => { throw new Error('synthetic observer failure'); } }));
test('core search follows acknowledged commands and rebuilds after index deletion', async () => {
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts');
  const directory = await mkdtemp('/tmp/fc7-'); const workspaceDirectory = path.join(directory, 'workspace'); const localDirectory = path.join(directory, 'local'); let host;
  const progress = []; const options = { workspaceDirectory, localDirectory, userEntityId: id('08', 1), deviceLabel: 'Synthetic Mac', create: true, onIndexProgress: value => progress.push(value) };
  try {
    host = await openWorkspaceHost(options);
    expect(await host.execute({ name: 'initiative.create', args: { record: { id: id('01', 1), title: 'Nebulacore initiative' } } })).toMatchObject({ ok: true });
    expect(await host.query('search', { text: 'Nebulacore' })).toHaveLength(1);
    expect(await host.execute({ name: 'initiative.update', args: { id: id('01', 1), patch: { title: 'Quasarcore initiative' } } })).toMatchObject({ ok: true });
    expect(await host.query('search', { text: 'Nebulacore' })).toEqual([]); expect(await host.query('search', { text: 'Quasarcore' })).toHaveLength(1);
    await host.close(); await rm(path.join(localDirectory, 'index.sqlite')); progress.length = 0;
    host = await openWorkspaceHost({ ...options, create: false });
    expect(await host.query('search', { text: 'Quasarcore' })).toHaveLength(1); expect(await host.query('status.index', {})).toMatchObject({ phase: 'ready' });
    expect(progress.some(value => value.phase === 'rebuilding')).toBe(true);
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('missing cache never revokes an acknowledged write or serves stale search', async () => {
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts'); const directory = await mkdtemp('/tmp/fc7-'); let host;
  const workspaceDirectory = path.join(directory, 'workspace'); const localDirectory = path.join(directory, 'local');
  try {
    host = await openWorkspaceHost({ workspaceDirectory, localDirectory, userEntityId: id('08', 1), deviceLabel: 'Synthetic Mac', create: true });
    await rm(path.join(localDirectory, 'index.sqlite'));
    expect(await host.execute({ name: 'initiative.create', args: { record: { id: id('01', 1), title: 'Persisted without cache' } } })).toMatchObject({ ok: true });
    expect(await host.query('portfolio.list', {})).toMatchObject([{ initiative: { title: 'Persisted without cache' } }]);
    await expect(host.query('search', { text: 'Persisted' })).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' });
    expect(await host.query('status.index', {})).toMatchObject({ phase: 'unavailable' });
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
