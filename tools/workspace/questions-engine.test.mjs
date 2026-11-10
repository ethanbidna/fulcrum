import { expect, test } from 'vitest';
import { Domain, planQuestion, obsoleteQuestions, replayEvents, syncQuestions } from '../../packages/domain/src/index.ts';
import { questionId } from '../../packages/store/src/index.ts';
import { loadValidators, readJson } from '../reference/schemas.mjs';
import { fold, fromStateDocument } from '../reference/fold.mjs';
const validators = loadValidators();
const id = (prefix, n) => `${prefix}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-11-09T18:00:00Z';
function setup() {
  const snapshot = readJson('fixtures/states/portfolio.state.json'); snapshot.state.questions = [];
  let seq = 0;
  const errors = validator => value => validator(value) ? [] : structuredClone(validator.errors);
  const ports = { newId: () => id('09', ++seq + 1000), now: () => at, deviceId: snapshot.state.settings.ingestionDeviceId,
    userEntityId: snapshot.state.entities.find(entity => entity.type === 'person').id,
    validateState: errors(validators.workspaceState), validateEvent: errors(validators.changeEvent),
    commit: async drafts => drafts.map(draft => ({ ...structuredClone(draft), seq: ++seq, hlc: `1794247200000-${String(seq).padStart(4, '0')}` })) };
  const domain = new Domain(snapshot, [], ports);
  const initiative = snapshot.state.initiatives[0];
  const candidate = { initiativeId: initiative.id, target: { kind: 'initiative', id: initiative.id, field: 'title' },
    prompt: 'Which title should be used?', reason: 'conflicting_sources', materiality: 'medium', dedupeKey: 'synthetic:title',
    evidenceRefs: [], resolutions: [{ id: 'keep', label: 'Keep current title', commands: [] },
      { id: 'apply', label: 'Use source title', commands: [{ name: 'initiative.update', args: { id: initiative.id, patch: { title: 'Synthetic revision' } } }] }] };
  const raise = record => domain.execute({ name: 'question.raise', args: { record }, actor: 'system' });
  return { snapshot, domain, candidate, ports, raise };
}
const passed = result => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
test('UUIDv5 question identities are stable and namespace scoped', () => {
  expect(questionId('synthetic:title')).toBe('18a1ba81-92aa-5b16-94ed-1f417f749de3');
  expect(questionId('synthetic:title')).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  expect(questionId('synthetic:other')).not.toBe(questionId('synthetic:title'));
});
test('materiality and executable choice gates abstain before raising', () => {
  const f = setup(); const plan = candidate => planQuestion(f.snapshot, candidate, questionId, at);
  expect(plan({ ...f.candidate, materiality: 'low' })).toBeUndefined();
  expect(plan({ ...f.candidate, resolutions: [f.candidate.resolutions[0]] })).toBeUndefined();
  expect(plan({ ...f.candidate, resolutions: [{ id: 'a', label: 'Bad', commands: [{ name: 'shell.exec', args: {} }] }, f.candidate.resolutions[0]] })).toBeUndefined();
  expect(plan(f.candidate)).toMatchObject({ id: questionId(f.candidate.dedupeKey), state: 'open' });
});
test('similar questions consolidate evidence without losing a future deferral', async () => {
  const f = setup(); f.candidate.evidenceRefs = [{ sourceId: f.snapshot.state.sources[0].id }]; const first = planQuestion(f.snapshot, f.candidate, questionId, at); passed(await f.raise(first));
  passed(await f.domain.execute({ name: 'question.defer', args: { id: first.id, deferredUntil: '2026-11-10T18:00:00Z' }, actor: 'user' }));
  const next = planQuestion(f.domain.getSnapshot(), { ...f.candidate, prompt: 'A paraphrased title question', dedupeKey: 'other-key', evidenceRefs: [{ sourceId: f.snapshot.state.sources[1].id }] }, questionId, at);
  expect(next.id).toBe(first.id); passed(await f.raise(next));
  expect(f.domain.getSnapshot().state.questions).toHaveLength(1);
  expect(f.domain.getSnapshot().state.questions[0].evidenceRefs).toHaveLength(2);
  expect(f.domain.getSnapshot().state.questions[0]).toMatchObject({ state: 'deferred', deferredUntil: '2026-11-10T18:00:00Z' });
});
test('direct duplicate raise preserves deferral and rejects cross-target keys', async () => {
  const f = setup(); const record = planQuestion(f.snapshot, f.candidate, questionId, at); passed(await f.raise(record));
  passed(await f.domain.execute({ name: 'question.defer', args: { id: record.id, deferredUntil: null }, actor: 'user' }));
  passed(await f.raise(record)); expect(f.domain.getSnapshot().state.questions[0].state).toBe('deferred');
  expect(await f.raise({ ...record, target: { kind: 'initiative', id: f.snapshot.state.initiatives[1].id }, initiativeId: f.snapshot.state.initiatives[1].id })).toMatchObject({ ok: false });
});
test('closed questions cannot be deferred or silently re-raised', async () => {
  const f = setup(); const record = planQuestion(f.snapshot, f.candidate, questionId, at); passed(await f.raise(record));
  passed(await f.domain.execute({ name: 'question.resolve', args: { id: record.id, resolutionId: 'keep' }, actor: 'user' }));
  expect(planQuestion(f.domain.getSnapshot(), f.candidate, questionId, at)).toBeUndefined();
  expect(await f.domain.execute({ name: 'question.defer', args: { id: record.id, deferredUntil: null }, actor: 'user' })).toMatchObject({ ok: false });
});
test('production replay detects the same concurrent writes as the reference fold', () => {
  const f = setup(); const initiative = f.snapshot.state.initiatives[0];
  const events = ['First', 'Second'].map((title, index) => ({ v: 1, eventId: id('09', index + 1), deviceId: id('10', index + 1), seq: 1,
    hlc: `1794247200000-000${index}`, at, actor: 'user', command: { name: 'initiative.update', args: { id: initiative.id, patch: { title } } },
    ops: [{ op: 'set', kind: 'initiative', id: initiative.id, field: 'title', value: title, baseEventId: null }] }));
  const replay = replayEvents(f.snapshot, events);
  expect(replay.conflicts).toEqual(fold(events, { base: fromStateDocument(f.snapshot.state) }).conflicts);
  const questions = syncQuestions(replay, questionId); expect(questions).toHaveLength(1);
  expect(questions[0]).toMatchObject({ name: 'question.raise', actor: 'system', args: { record: { id: questionId(`sync:initiative:${initiative.id}:title`), reason: 'sync_conflict' } } });
  const domain = new Domain(f.snapshot, events, f.ports); return (async () => {
    passed(await domain.execute(questions[0]));
    const question = domain.getSnapshot().state.questions[0];
    passed(await domain.execute({ name: 'question.resolve', args: { id: question.id, resolutionId: 'other' }, actor: 'user' }));
    expect(domain.getSnapshot().state.initiatives[0].title).toBe('First');
    expect(syncQuestions(replayEvents(f.snapshot, domain.history()), questionId)).toEqual([]);
  })();
});
test('only newer accepted canonical evidence makes a contextual question obsolete', async () => {
  const f = setup(); const old = { ...f.snapshot.state.sources[0], id: id('04', 950), happenedAt: '2026-11-08T10:00:00Z' };
  const newer = { ...old, id: id('04', 951), happenedAt: '2026-11-09T10:00:00Z' };
  f.snapshot.state.sources.push(old, newer);
  const record = { ...planQuestion(f.snapshot, f.candidate, questionId, at), evidenceRefs: [{ sourceId: old.id }] }; f.snapshot.state.questions.push(record);
  const claim = { id: id('05', 950), target: f.candidate.target, predicate: 'title', value: f.snapshot.state.initiatives[0].title,
    certainty: 'explicit', status: 'applied', observedAt: at, evidenceRefs: [{ sourceId: newer.id }] };
  f.snapshot.state.assertions.push(claim);
  expect(obsoleteQuestions(f.snapshot)).toEqual([{ name: 'question.markObsolete', args: { id: record.id }, actor: 'system', evidenceRefs: [{ sourceId: newer.id }] }]);
  claim.status = 'suggested'; expect(obsoleteQuestions(f.snapshot)).toEqual([]);
  claim.status = 'applied'; newer.happenedAt = old.happenedAt; expect(obsoleteQuestions(f.snapshot)).toEqual([]);
});
test('write after deletion raises one contextual restore choice and commits restoration atomically', async () => {
  const f = setup(); const node = f.snapshot.state.nodes.find(node => node.type === 'task');
  const deleted = await f.domain.execute({ name: 'node.delete', args: { id: node.id }, actor: 'user' }); passed(deleted);
  const deletion = f.domain.history()[0];
  const attempted = { v: 1, eventId: id('09', 9990), deviceId: id('10', 2), seq: 1, hlc: '1794247200001-0000', at, actor: 'user',
    command: { name: 'node.update', args: { id: node.id, patch: { title: 'Offline title' } } },
    ops: [{ op: 'set', kind: 'node', id: node.id, field: 'title', value: 'Offline title', baseEventId: null }] };
  const commit = f.ports.commit;
  f.ports.commit = async drafts => (await commit(drafts)).map(event => ({ ...event, hlc: `1794247200100-${String(event.seq).padStart(4, '0')}` }));
  const domain = new Domain(f.snapshot, [deletion, attempted], f.ports);
  const questions = domain.questionMaintenance(questionId); expect(questions).toHaveLength(1);
  passed(await domain.execute(questions[0]));
  const question = domain.getSnapshot().state.questions[0]; expect(question.target).toEqual({ kind: 'initiative', id: node.initiativeId });
  const count = domain.history().length;
  expect(await domain.execute({ name: 'question.resolve', args: { id: question.id, resolutionId: 'restore' }, actor: 'ai' })).toMatchObject({ ok: false });
  passed(await domain.execute({ name: 'question.resolve', args: { id: question.id, resolutionId: 'restore' }, actor: 'user' }));
  expect(domain.history()).toHaveLength(count + 1);
  expect(domain.history().at(-1).undoOf).toBe(deletion.eventId);
  expect(domain.getSnapshot().state.nodes.find(record => record.id === node.id)).toEqual(node);
  expect(domain.getSnapshot().state.questions.find(record => record.id === question.id).state).toBe('resolved');
  expect(domain.questionMaintenance(questionId)).toEqual([]);
  const reference = fold(domain.history(), { base: fromStateDocument(f.snapshot.state) });
  expect(reference.state.nodes.get(node.id)).toEqual(node);
});
test('sync choices reject later edits and maintenance makes the old question obsolete', async () => {
  const f = setup(); const initiative = f.snapshot.state.initiatives[0];
  const events = ['First', 'Second'].map((title, index) => ({ v: 1, eventId: id('09', index + 1), deviceId: id('10', index + 1), seq: 1,
    hlc: `1794247200000-000${index}`, at, actor: 'user', command: { name: 'initiative.update', args: { id: initiative.id, patch: { title } } },
    ops: [{ op: 'set', kind: 'initiative', id: initiative.id, field: 'title', value: title, baseEventId: null }] }));
  const domain = new Domain(f.snapshot, events, f.ports); passed(await domain.execute(domain.questionMaintenance(questionId)[0]));
  const question = domain.getSnapshot().state.questions[0];
  passed(await domain.execute({ name: 'initiative.update', args: { id: initiative.id, patch: { title: 'Later manual edit' } }, actor: 'user' }));
  expect(await domain.execute({ name: 'question.resolve', args: { id: question.id, resolutionId: 'other' }, actor: 'user' })).toMatchObject({ ok: false, error: { code: 'STALE_BASE' } });
  expect(domain.questionMaintenance(questionId)).toContainEqual({ name: 'question.markObsolete', args: { id: question.id }, actor: 'system' });
  passed(await domain.execute({ name: 'question.defer', args: { id: question.id, deferredUntil: '2026-11-09T17:00:00Z' }, actor: 'user' }));
  for (const command of domain.questionMaintenance(questionId)) passed(await domain.execute(command));
  expect(domain.getSnapshot().state.questions[0].state).toBe('obsolete');
});
test('real core discovers synced conflicts, persists one question, and keeps it settled after restart', async () => {
  const { mkdtemp, mkdir, readdir, readFile, writeFile, rm } = await import('node:fs/promises');
  const path = await import('node:path');
  const { openWorkspaceHost } = await import('../../apps/core/src/workspace.ts');
  const directory = await mkdtemp('/tmp/fa1-'); const workspaceDirectory = path.join(directory, 'workspace');
  const options = { workspaceDirectory, localDirectory: path.join(directory, 'local'), userEntityId: id('08', 1), deviceLabel: 'Synthetic Mac' };
  let host;
  try {
    host = await openWorkspaceHost({ ...options, create: true });
    passed(await host.execute({ name: 'initiative.create', args: { record: { id: id('01', 1), title: 'Original' } } }));
    await host.close(); host = undefined;
    const ms = Date.now() + 1000;
    for (const [index, title] of ['Offline one', 'Offline two'].entries()) {
      const device = id('10', index + 1); const folder = path.join(workspaceDirectory, 'log', device); await mkdir(folder);
      const event = { v: 1, eventId: id('09', index + 1), deviceId: device, seq: 1, hlc: `${ms + index}-0000`, at, actor: 'user',
        command: { name: 'initiative.update', args: { id: id('01', 1), patch: { title } } },
        ops: [{ op: 'set', kind: 'initiative', id: id('01', 1), field: 'title', value: title, baseEventId: null }] };
      await writeFile(path.join(folder, '000000000001.jsonl'), JSON.stringify(event) + '\n');
    }
    host = await openWorkspaceHost(options);
    const questions = await host.query('questions.list', { state: 'open' }); expect(questions).toHaveLength(1);
    expect(questions[0].reason).toBe('sync_conflict');
    passed(await host.execute({ name: 'question.resolve', args: { id: questions[0].id, resolutionId: 'other' } }));
    expect((await host.query('initiative.get', { id: id('01', 1) })).title).toBe('Offline one');
    await host.close(); host = await openWorkspaceHost(options);
    expect(await host.query('questions.list', { state: 'open' })).toEqual([]);
    expect(await host.query('questions.list', { state: 'resolved' })).toHaveLength(1);
    const records = [];
    for (const device of await readdir(path.join(workspaceDirectory, 'log'))) for (const file of await readdir(path.join(workspaceDirectory, 'log', device))) {
      if (file.endsWith('.jsonl')) records.push(...(await readFile(path.join(workspaceDirectory, 'log', device, file), 'utf8')).trim().split('\n').map(JSON.parse));
    }
    expect(records.filter(event => event.command.name === 'question.raise')).toHaveLength(1);
  } finally { await host?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('dated deferrals reopen when due while indefinite deferrals remain quiet', async () => {
  const f = setup(); const question = planQuestion(f.snapshot, f.candidate, questionId, at); passed(await f.raise(question));
  passed(await f.domain.execute({ name: 'question.defer', args: { id: question.id, deferredUntil: '2026-11-09T17:00:00Z' }, actor: 'user' }));
  for (const command of f.domain.questionMaintenance(questionId)) passed(await f.domain.execute(command));
  expect(f.domain.getSnapshot().state.questions[0]).toMatchObject({ state: 'open' });
  expect(f.domain.getSnapshot().state.questions[0]).not.toHaveProperty('deferredUntil');
  passed(await f.domain.execute({ name: 'question.defer', args: { id: question.id, deferredUntil: null }, actor: 'user' }));
  expect(f.domain.questionMaintenance(questionId)).toEqual([]);
  expect(await f.domain.query('questions.list', { state: 'deferred' })).toHaveLength(1);
  await expect(f.domain.query('questions.list', { state: 'invalid' })).rejects.toThrow();
});
test('raising rejects choices that cannot execute against the current graph', async () => {
  const f = setup(); const record = planQuestion(f.snapshot, f.candidate, questionId, at);
  record.resolutions[1].commands = [{ name: 'initiative.update', args: { id: id('01', 999), patch: { title: 'Missing target' } } }];
  expect(await f.raise(record)).toMatchObject({ ok: false }); expect(f.domain.getSnapshot().state.questions).toEqual([]);
});
test('a resolution may delete its contextual edge without leaving a dangling question', async () => {
  const f = setup(); const edge = f.snapshot.state.edges[0];
  const record = { ...planQuestion(f.snapshot, f.candidate, questionId, at), target: { kind: 'edge', id: edge.id }, initiativeId: edge.initiativeId,
    resolutions: [{ id: 'keep', label: 'Keep this link', commands: [] }, { id: 'delete', label: 'Remove this link', commands: [{ name: 'edge.delete', args: { id: edge.id } }] }] };
  passed(await f.raise(record)); passed(await f.domain.execute({ name: 'question.resolve', args: { id: record.id, resolutionId: 'delete' }, actor: 'user' }));
  expect(f.domain.getSnapshot().state.edges.some(record => record.id === edge.id)).toBe(false);
  expect(f.domain.getSnapshot().state.questions).toEqual([]);
});
test('production conflicts satisfy the cross-device golden fixture in either arrival order', async () => {
  const { readWorkspace } = await import('../reference/workspace-reader.mjs');
  const { REPO_ROOT } = await import('../reference/schemas.mjs');
  const path = await import('node:path');
  const expected = readJson('fixtures/scenarios/expectations.json').crossDeviceCollision;
  const { manifest, events } = readWorkspace(path.join(REPO_ROOT, expected.workspace));
  const snapshot = setup().snapshot; snapshot.workspaceId = manifest.workspaceId;
  for (const key of Object.keys(snapshot.state)) snapshot.state[key] = key === 'settings' ? {} : [];
  const replay = replayEvents(snapshot, events);
  expect(replay.conflicts).toEqual(fold(events).conflicts);
  expect(replay.conflicts).toHaveLength(expected.conflicts.length);
  expect(replay.conflicts[0]).toMatchObject(expected.conflicts[0]);
  expect(replayEvents(snapshot, [...events].reverse()).conflicts).toEqual(replay.conflicts);
  expect(syncQuestions(replay, questionId)[0].args.record.dedupeKey).toBe(`sync:initiative:${expected.finalInitiative.id}:moscow`);
});
