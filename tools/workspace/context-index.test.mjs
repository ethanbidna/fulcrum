import { expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { SqliteContextIndex, snapshotEpisodes } from '../../packages/context/src/index.ts';
import { identityQuestion } from '../../packages/ingest/src/identity.ts';
import { Domain } from '../../packages/domain/src/index.ts';
import { readJson, loadValidators } from '../reference/schemas.mjs';
const validators = loadValidators();
const aliases = readJson('fixtures/scenarios/identity.json');
const fixture = () => { const snapshot = readJson('fixtures/states/portfolio.state.json'); snapshot.state.entities.push(...structuredClone(aliases.entities)); return snapshot; };
const id = (prefix, n) => `${prefix}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
async function setup(run) {
  const directory = await mkdtemp('/tmp/fi4-'); const localDirectory = path.join(directory, 'local'); const workspaceDirectory = path.join(directory, 'workspace');
  await mkdir(localDirectory, { mode: 0o700 }); await mkdir(workspaceDirectory);
  const snapshot = fixture(); const options = { localDirectory, workspaceDirectory, workspaceId: snapshot.workspaceId }; let index;
  try { index = await SqliteContextIndex.open(options); await index.rebuild(snapshotEpisodes(snapshot)); await run({ index, options, snapshot }); }
  finally { await index?.close(); await rm(directory, { recursive: true, force: true }); }
}
test('scenario 6 resolves person/project aliases and connector-scoped IDs, otherwise abstains', () => setup(async ({ index }) => {
  const results = await index.resolveEntities(aliases.mentions);
  for (let position = 0; position < results.length; position++) expect(results[position]).toMatchObject(aliases.expected[position]);
  expect(await index.resolveEntities([{ text: 'Northish' }, { text: 'North', externalId: { connector: 'slack', remoteId: 'unknown' } }])).toMatchObject([{ status: 'unresolved' }, { status: 'unresolved' }]);
}));
test('merged IDs/aliases follow one live identity; cycles, dangling merges and type mismatch abstain', () => setup(async ({ index }) => {
  const [north, south] = structuredClone(aliases.entities);
  await index.ingest({ kind: 'entity', record: { ...north, mergedInto: south.id } });
  expect(await index.resolveEntities([{ text: 'North' }, { text: 'North', type: 'team' }])).toMatchObject([{ status: 'resolved', entityId: south.id }, { status: 'unresolved' }]);
  await index.ingest({ kind: 'entity', record: { ...south, mergedInto: north.id } });
  expect(await index.resolveEntities([{ text: 'North' }])).toMatchObject([{ status: 'unresolved' }]);
  await index.ingest({ kind: 'entity', record: { ...north, mergedInto: id('08', 999) } });
  expect(await index.resolveEntities([{ text: 'North' }])).toMatchObject([{ status: 'unresolved' }]);
}));
test('target history retains conflicting claims, both clocks, validity and source provenance', () => setup(async ({ index, snapshot }) => {
  const assertion = snapshot.state.assertions[0]; const target = assertion.target;
  const source = snapshot.state.sources.find(item => item.id === assertion.evidenceRefs[0].sourceId);
  const later = { ...source, id: id('04', 901), remoteId: 'synthetic:later', happenedAt: '2026-11-08T10:00:00Z', ingestedAt: '2026-11-09T10:00:00Z' };
  const claim = { ...assertion, id: id('05', 901), value: 'Conflicting synthetic claim', evidenceRefs: [{ sourceId: later.id }], observedAt: '2026-11-09T10:01:00Z', validFrom: later.happenedAt, status: 'conflicting' };
  await index.ingest({ kind: 'source', record: later }); await index.ingest({ kind: 'assertion', record: claim });
  const related = await index.related(target, 20);
  expect(related.assertions).toContainEqual(claim); expect(related.assertions).toContainEqual(assertion);
  expect(related.sources).toContainEqual(later); expect(related.sources).toContainEqual(source);
  expect(related.assertions[0].id).toBe(claim.id);
  expect((await index.related({ kind: 'node', id: id('02', 999) }, 5)).assertions).toEqual([]);
}));
test('FTS matches titles/aliases/permitted excerpts with literal queries and bounded results', () => setup(async ({ index, snapshot }) => {
  const source = { ...snapshot.state.sources[0], title: 'Quasartitle', excerpt: 'Nebulaexcerpt', cachePolicy: 'excerpt' };
  await index.ingest({ kind: 'source', record: source });
  expect((await index.related({ kind: 'text', text: 'Pilot' }, 5)).entities.map(item => item.id)).toContain(aliases.entities[2].id);
  expect((await index.related({ kind: 'text', text: 'Nebulaexcerpt' }, 5)).sources).toContainEqual(source);
  await index.ingest({ kind: 'source', record: { ...source, cachePolicy: 'none' } });
  expect((await index.related({ kind: 'text', text: 'Nebulaexcerpt' }, 5)).sources).toEqual([]);
  const hit = (await index.related({ kind: 'text', text: 'Quasartitle' }, 1)).sources[0]; expect(hit).not.toHaveProperty('excerpt');
  expect(await index.related({ kind: 'text', text: '" OR 1=1 --' }, 5)).toEqual({ entities: [], targets: [], sources: [], assertions: [] });
  await expect(index.related({ kind: 'text', text: 'Pilot' }, -1)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
}));
test('entity-related history uses canonical bindings and source senders', () => setup(async ({ index, snapshot }) => {
  const source = { ...snapshot.state.sources[0], senderEntityId: aliases.entities[0].id };
  await index.ingest({ kind: 'source', record: source });
  expect((await index.related({ kind: 'entity', id: aliases.entities[0].id }, 10)).sources.map(record => record.id)).toContain(source.id);
}));
test('rebuild removes old aliases, excerpts and tombstones; failed rebuild rolls back', () => setup(async ({ index, snapshot }) => {
  snapshot.state.entities = snapshot.state.entities.filter(record => record.id !== aliases.entities[2].id);
  await index.rebuild(snapshotEpisodes(snapshot));
  expect(await index.resolveEntities([{ text: 'Pilot' }])).toMatchObject([{ status: 'unresolved' }]);
  async function* broken() { yield { kind: 'entity', record: aliases.entities[2] }; throw new Error('synthetic interrupted replay'); }
  await expect(index.rebuild(broken())).rejects.toThrow('synthetic interrupted replay');
  expect(await index.resolveEntities([{ text: 'Pilot' }])).toMatchObject([{ status: 'unresolved' }]);
  expect(await index.resolveEntities([{ text: 'North' }])).toMatchObject([{ status: 'resolved' }]);
}));
test('cache deletion/reopen/replay on another machine gives identical results', () => setup(async ({ index, options, snapshot }) => {
  const expected = await index.resolveEntities(aliases.mentions); await index.close(); await rm(path.join(options.localDirectory, 'context.sqlite'));
  const reopened = await SqliteContextIndex.open(options);
  try { await reopened.rebuild(snapshotEpisodes(snapshot)); expect(await reopened.resolveEntities(aliases.mentions)).toEqual(expected); }
  finally { await reopened.close(); }
}));
test('invalid storage paths never write in workspace or through symlinks', () => setup(async ({ options }) => {
  await expect(SqliteContextIndex.open({ ...options, localDirectory: options.workspaceDirectory })).rejects.toThrow();
  const other = path.join(options.localDirectory, 'other'); await mkdir(other);
  const sentinel = path.join(other, 'sentinel'); await writeFile(sentinel, 'synthetic sentinel'); await symlink(sentinel, path.join(other, 'context.sqlite'));
  await expect(SqliteContextIndex.open({ ...options, localDirectory: other })).rejects.toThrow();
  expect(await readFile(sentinel, 'utf8')).toBe('synthetic sentinel');
}));
test('scenario 6 material ambiguity raises exactly one contextual domain question; selection and undo work', () => setup(async ({ index, snapshot }) => {
  const dependency = snapshot.state.nodes.find(record => record.type === 'dependency'); const source = snapshot.state.sources[0];
  const [resolution] = await index.resolveEntities([{ text: 'Reviewer', type: 'person' }]);
  let sequence = 0; let nextId = 1000;
  const errors = validator => value => validator(value) ? [] : structuredClone(validator.errors);
  const domain = new Domain(snapshot, [], { newId: () => id('09', nextId++), now: () => '2026-11-09T18:00:00Z', deviceId: snapshot.state.settings.ingestionDeviceId,
    userEntityId: snapshot.state.entities.find(record => record.type === 'person').id,
    validateState: errors(validators.workspaceState), validateEvent: errors(validators.changeEvent),
    commit: async drafts => drafts.map(draft => ({ ...structuredClone(draft), seq: ++sequence, hlc: `1794247200000-${String(sequence).padStart(4, '0')}` })) });
  const input = { resolution, dependency, evidenceRefs: [{ sourceId: source.id }], materiality: 'medium' };
  const command = identityQuestion({ ...input, id: id('06', 901) });
  expect(command).toMatchObject({ name: 'question.raise', args: { record: { reason: 'identity_ambiguity', target: { kind: 'node', id: dependency.id } } } });
  expect(identityQuestion({ ...input, id: id('06', 902), materiality: 'low' })).toBeNull();
  for (const questionId of [901, 902]) expect(await domain.execute({ ...identityQuestion({ ...input, id: id('06', questionId) }), actor: 'ai', evidenceRefs: input.evidenceRefs })).toMatchObject({ ok: true });
  const questions = domain.getSnapshot().state.questions.filter(record => record.reason === 'identity_ambiguity'); expect(questions).toHaveLength(1);
  const selected = await domain.execute({ name: 'question.resolve', actor: 'user', args: { id: questions[0].id, resolutionId: aliases.entities[1].id } }); expect(selected).toMatchObject({ ok: true });
  expect(domain.getSnapshot().state.nodes.find(record => record.id === dependency.id).responsibleEntityId).toBe(aliases.entities[1].id);
  expect(await domain.execute({ name: 'change.undo', actor: 'user', args: { eventId: selected.eventId } })).toMatchObject({ ok: true });
  expect(domain.getSnapshot().state.nodes.find(record => record.id === dependency.id).responsibleEntityId).toBe(dependency.responsibleEntityId);
}));

test('core keeps context current after commands and missing-cache failure preserves acknowledged writes', async () => {
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp('/tmp/fi4-core-'); const workspaceDirectory = path.join(directory, 'workspace'); const localDirectory = path.join(directory, 'local'); let host;
  try {
    host = await openWorkspaceHost({ workspaceDirectory, localDirectory, create: true, userEntityId: id('08', 1), deviceLabel: 'Synthetic Mac' });
    expect(await host.execute({ name: 'entity.create', args: { record: aliases.entities[0] } })).toMatchObject({ ok: true });
    const file = path.join(localDirectory, 'context.sqlite');
    const database = new DatabaseSync(file, { readOnly: true });
    try { expect(database.prepare("SELECT label FROM aliases WHERE entity_id=?").all(aliases.entities[0].id).map(row => row.label)).toContain('north'); }
    finally { database.close(); }
    await rm(file);
    expect(await host.execute({ name: 'initiative.create', args: { record: { id: id('01', 901), title: 'Persisted with missing context' } } })).toMatchObject({ ok: true });
    await host.close(); host = undefined;
    host = await openWorkspaceHost({ workspaceDirectory, localDirectory, userEntityId: id('08', 1), deviceLabel: 'Synthetic Mac' });
    expect(await host.query('portfolio.list', {})).toMatchObject([{ initiative: { title: 'Persisted with missing context' } }]);
    const reopened = new DatabaseSync(file, { readOnly: true });
    try { expect(reopened.prepare("SELECT label FROM aliases WHERE entity_id=?").all(aliases.entities[0].id).map(row => row.label)).toContain('north'); }
    finally { reopened.close(); }
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('FTS alias hits retrieve the same bound context as entity IDs', () => setup(async ({ index, snapshot }) => {
  const source = { ...snapshot.state.sources[0], senderEntityId: aliases.entities[0].id };
  await index.ingest({ kind: 'source', record: source });
  expect((await index.related({ kind: 'text', text: 'North' }, 10)).sources.map(record => record.id)).toContain(source.id);
}));
test('event chronology compares instants across timestamp offsets', () => setup(async ({ index, snapshot }) => {
  const assertion = snapshot.state.assertions[0]; const original = snapshot.state.sources.find(source => source.id === assertion.evidenceRefs[0].sourceId);
  const first = { ...original, happenedAt: '2026-11-09T10:00:00+02:00' };
  const second = { ...original, id: id('04', 902), remoteId: 'synthetic:offset', happenedAt: '2026-11-09T09:00:00Z' };
  const later = { ...assertion, id: id('05', 902), evidenceRefs: [{ sourceId: second.id }], observedAt: '2026-11-09T12:00:00Z' };
  await index.ingest({ kind: 'source', record: first }); await index.ingest({ kind: 'source', record: second }); await index.ingest({ kind: 'assertion', record: later });
  expect((await index.related(assertion.target, 10)).assertions[0].id).toBe(later.id);
}));
test('cache corruption is preserved for diagnosis and workspace reuse clears identities', () => setup(async ({ index, options, snapshot }) => {
  const { readdir } = await import('node:fs/promises');
  await index.close(); await writeFile(path.join(options.localDirectory, 'context.sqlite'), 'synthetic invalid cache');
  const recovered = await SqliteContextIndex.open(options);
  try { await recovered.rebuild(snapshotEpisodes(snapshot)); expect(await recovered.resolveEntities([{ text: 'North' }])).toMatchObject([{ status: 'resolved' }]); }
  finally { await recovered.close(); }
  expect((await readdir(options.localDirectory)).some(file => file.startsWith('context.sqlite.invalid-'))).toBe(true);
  const other = await SqliteContextIndex.open({ ...options, workspaceId: id('00', 999) });
  try { expect(await other.resolveEntities([{ text: 'North' }])).toMatchObject([{ status: 'unresolved' }]); }
  finally { await other.close(); }
}));
