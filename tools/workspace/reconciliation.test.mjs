import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { reconcile, proofFor } from '../../packages/ingest/src/reconciliation.ts';
import { Domain, suggestionSignature } from '../../packages/domain/src/index.ts';
import { StructuredModelRuntime } from '../../packages/llm/src/index.ts';
import { loadValidators, readJson } from '../reference/schemas.mjs';
const validators = loadValidators();
const id = (prefix, n) => `${prefix}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const stableId = key => id('09', parseInt(createHash('sha256').update(key).digest('hex').slice(0, 9), 16));
const at = '2026-11-09T18:00:00Z';
function setup(options = {}) {
  const snapshot = readJson('fixtures/states/portfolio.state.json'); snapshot.state.questions = [];
  const user = snapshot.state.entities.find(record => record.type === 'person');
  const colleague = { id: id('08', 901), type: 'person', label: 'colleague-b', aliases: ['Reviewer'] }; snapshot.state.entities.push(colleague);
  const initiative = snapshot.state.initiatives[0];
  const text = options.text ?? 'I will prepare synthetic samples.';
  const source = { id: id('04', 901), connector: 'synthetic', remoteId: 'synthetic:reconcile', senderEntityId: options.external ? colleague.id : user.id,
    happenedAt: '2026-11-09T17:00:00Z', ingestedAt: at, cachePolicy: 'excerpt', excerpt: text, contentHash: `sha256:${createHash('sha256').update(text).digest('hex')}` };
  snapshot.state.sources.push(source);
  let event = 1000; let sequence = 0; let activePlan;
  const errors = validate => value => validate(value) ? [] : structuredClone(validate.errors);
  const ports = { newId: () => id('09', event++), now: () => at, deviceId: snapshot.state.settings.ingestionDeviceId, userEntityId: user.id,
    reconciliationProof: command => activePlan && proofFor(activePlan, command),
    validateState: errors(validators.workspaceState), validateEvent: errors(validators.changeEvent),
    commit: async drafts => drafts.map(draft => ({ ...structuredClone(draft), seq: ++sequence, hlc: `1794247200000-${String(sequence).padStart(4, '0')}` })) };
  const domain = new Domain(snapshot, [], ports);
  const plan = (candidates, extra = {}) => {
    activePlan = reconcile({ candidates: candidates.map(candidate => ({ span: { start: 0, end: text.length }, ...candidate })), resolutions: [{ mention: { text: 'colleague-b' }, status: 'resolved', entityId: colleague.id }],
      snapshot: domain.getSnapshot(), rejections: domain.getSnapshot().state.rejections, sourceId: source.id, sourceText: text, initiativeId: initiative.id,
      userEntityId: user.id, runId: 'synthetic-run', observedAt: at, idForKey: stableId, ...extra });
    return activePlan;
  };
  const apply = async result => { activePlan = result; const applied = []; for (const command of [...result.commands, ...result.suggestions, ...result.questions]) { const value = await domain.execute(command); expect(value, JSON.stringify(value)).toMatchObject({ ok: true }); applied.push(value); } return applied; };
  return { snapshot, domain, source, user, colleague, initiative, plan, apply, ports };
}
const state = f => f.domain.getSnapshot().state;
const targetNode = f => state(f).nodes.find(record => record.type === 'task');
test('scenario 2: explicit user commitment creates one evidenced Task, repeat updates before create, run undo works', async () => {
  const f = setup(); const candidate = { kind: 'user_commitment', text: 'Prepare synthetic samples' };
  const plan = f.plan([candidate, candidate]); await f.apply(plan);
  const created = state(f).nodes.filter(record => record.title === candidate.text); expect(created).toHaveLength(1); expect(created[0]).not.toHaveProperty('responsibleEntityId');
  expect(created[0].evidenceRefs).toContainEqual(expect.objectContaining({ sourceId: f.source.id }));
  const assertion = state(f).assertions.find(record => record.target.id === created[0].id); expect(assertion).toMatchObject({ predicate: 'user_commitment', certainty: 'explicit', value: { speakerEntityId: f.user.id, unambiguous: true } });
  expect(f.plan([candidate]).commands.filter(command => command.name === 'node.create')).toEqual([]);
  expect(f.domain.history().every(event => event.runId === 'synthetic-run' && event.evidenceRefs.length)).toBe(true);
  expect(await f.domain.execute({ name: 'run.undo', actor: 'user', args: { runId: 'synthetic-run' } })).toMatchObject({ ok: true });
  expect(state(f).nodes.some(record => record.id === created[0].id)).toBe(false);
});
test('scenario 3: colleague promise is a Dependency; a colleague cannot supply a user commitment', async () => {
  const f = setup({ external: true });
  await f.apply(f.plan([{ kind: 'external_commitment', who: 'colleague-b', text: 'Package synthetic samples' }, { kind: 'user_commitment', text: 'Invent a user task' }]));
  expect(state(f).nodes.find(record => record.title === 'Package synthetic samples')).toMatchObject({ type: 'dependency', responsibleEntityId: f.colleague.id });
  expect(state(f).nodes.some(record => record.title === 'Invent a user task')).toBe(false);
});
test('unresolved identity abstains and existing work receives evidence without duplicate nodes', async () => {
  const f = setup({ external: true }); const node = targetNode(f);
  const plan = f.plan([{ kind: 'external_commitment', who: 'Unknown reviewer', text: 'Unresolved work' }, { kind: 'user_commitment', text: node.title }]);
  expect(plan.commands.filter(command => command.name === 'node.create')).toEqual([]);
  const user = setup(); const existing = targetNode(user); const count = state(user).nodes.length;
  await user.apply(user.plan([{ kind: 'user_commitment', text: existing.title }])); expect(state(user).nodes).toHaveLength(count);
  expect(state(user).nodes.find(record => record.id === existing.id).evidenceRefs.map(ref => ref.sourceId)).toContain(user.source.id);
});
test('scenario 4: new initiative stays proposed and its contextual choices require user authority', async () => {
  const f = setup(); await f.apply(f.plan([{ kind: 'new_initiative', title: 'Synthetic launch proposal', rationale: 'Evaluate an idea' }]));
  const proposal = state(f).initiatives.find(record => record.title === 'Synthetic launch proposal'); expect(proposal.lifecycle).toBe('proposed');
  const question = state(f).questions.find(record => record.initiativeId === proposal.id); expect(question.reason).toBe('proposed_initiative');
  expect(await f.domain.execute({ name: 'question.resolve', actor: 'ai', evidenceRefs: [{ sourceId: f.source.id }], args: { id: question.id, resolutionId: 'approve' } })).toMatchObject({ ok: false });
});
test('scenario 5: priority opinions preserve protected MoSCoW and produce one suggestion/question', async () => {
  const f = setup(); const before = f.initiative.moscow; const value = before === 'must_do' ? 'could_do' : 'must_do';
  const candidate = { kind: 'priority_opinion', targetHint: f.initiative.title, value, who: 'colleague-b' };
  await f.apply(f.plan([candidate, candidate]));
  expect(state(f).initiatives[0].moscow).toBe(before);
  expect(state(f).assertions.filter(record => record.target.id === f.initiative.id && record.value === value && record.status === 'suggested')).toHaveLength(1);
  expect(state(f).questions.filter(record => record.reason === 'protected_field_challenge')).toHaveLength(1);
});
test('scenario 8: material conflict preserves both claims, chronology and user-confirmed choice', async () => {
  const f = setup(); const node = targetNode(f);
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'done' }]));
  const oldSource = f.source; const source = { ...oldSource, id: id('04', 902), remoteId: 'synthetic:conflict', happenedAt: '2026-11-09T17:30:00Z' };
  expect(await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source } })).toMatchObject({ ok: true });
  const plan = f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }], { sourceId: source.id }); await f.apply(plan);
  expect(state(f).nodes.find(record => record.id === node.id).state).toBe('done');
  expect(state(f).assertions.filter(record => record.target.id === node.id && record.predicate === 'state' && record.status === 'conflicting')).toHaveLength(2);
  const question = state(f).questions.find(record => record.reason === 'conflicting_sources'); expect(new Set(question.evidenceRefs.map(ref => ref.sourceId))).toEqual(new Set([oldSource.id, source.id]));
  expect(await f.domain.execute({ name: 'question.resolve', actor: 'user', args: { id: question.id, resolutionId: 'keep' } })).toMatchObject({ ok: true });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }], { sourceId: source.id }));
  expect(state(f).questions.filter(record => ['open', 'deferred'].includes(record.state))).toEqual([]);
  expect(state(f).nodes.find(record => record.id === node.id).state).toBe('done');
});
test('newer matching evidence makes a contextual conflict question obsolete without choosing for the user', async () => {
  const f = setup(); const node = targetNode(f); await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'done' }]));
  const source2 = { ...f.source, id: id('04', 902), remoteId: 'synthetic:contradiction', happenedAt: '2026-11-09T17:30:00Z' };
  await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source2 } });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }], { sourceId: source2.id }));
  const source3 = { ...f.source, id: id('04', 903), remoteId: 'synthetic:settled', happenedAt: '2026-11-09T17:45:00Z' };
  await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source3 } });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'done' }], { sourceId: source3.id }));
  expect(state(f).questions.find(record => record.reason === 'conflicting_sources').state).toBe('obsolete');
});
test('nonmaterial dates use event time, supersede prior claims, and ignore stale or invalid values', async () => {
  const f = setup(); const node = targetNode(f);
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-01' }]));
  const newer = { ...f.source, id: id('04', 902), remoteId: 'synthetic:newer', happenedAt: '2026-11-09T17:30:00Z' }; await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: newer } });
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-02' }], { sourceId: newer.id }));
  expect(state(f).nodes.find(record => record.id === node.id).targetDate).toBe('2026-12-02');
  expect(state(f).assertions.some(record => record.target.id === node.id && record.predicate === 'targetDate' && record.status === 'superseded' && record.supersededBy)).toBe(true);
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-03' }, { kind: 'date', targetHint: node.title, date: '2026-02-30' }]));
  expect(state(f).nodes.find(record => record.id === node.id).targetDate).toBe('2026-12-02');
});
test('manual fields and rejection signatures win; newer evidence must be explicit to revisit a rejection', async () => {
  const f = setup(); const node = targetNode(f);
  await f.domain.execute({ name: 'node.setState', actor: 'user', args: { id: node.id, state: 'done' } });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }]));
  expect(state(f).nodes.find(record => record.id === node.id).state).toBe('done'); expect(state(f).questions).toHaveLength(1);
  const rejected = f.plan([{ kind: 'user_commitment', text: 'Rejected synthetic task' }]); const create = rejected.commands.find(command => command.name === 'node.create');
  const rejections = [{ signature: suggestionSignature({ name: create.name, args: create.args }), rejectedAt: at, untilNewEvidence: false }];
  expect(f.plan([{ kind: 'user_commitment', text: 'Rejected synthetic task' }], { rejections }).commands).toEqual([]);
});
test('decisions use actual option IDs; relationships update existing edges and reject cycles', async () => {
  const f = setup(); const decision = state(f).nodes.find(record => record.type === 'decision');
  await f.apply(f.plan([{ kind: 'decision_made', targetHint: decision.title, optionHint: decision.options[0].label }]));
  expect(state(f).nodes.find(record => record.id === decision.id).outcome).toBe(decision.options[0].id);
  const edge = state(f).edges.find(record => record.type === 'depends_on'); const from = state(f).nodes.find(record => record.id === edge.fromId); const to = state(f).nodes.find(record => record.id === edge.toId);
  const count = state(f).edges.length;
  await f.apply(f.plan([{ kind: 'relationship', fromHint: from.title, toHint: to.title, type: 'depends_on' }, { kind: 'relationship', fromHint: to.title, toHint: from.title, type: 'depends_on' }]));
  expect(state(f).edges).toHaveLength(count);
});
test('plans are pure/deterministic and proof lookup cannot authorize a modified command', () => {
  const f = setup(); const input = [{ kind: 'user_commitment', text: 'Deterministic synthetic work' }]; const before = f.domain.getSnapshot();
  const first = f.plan(input); const second = f.plan(input); expect(first).toEqual(second); expect(f.domain.getSnapshot()).toEqual(before);
  const command = first.commands.find(record => record.name === 'node.create'); expect(proofFor(first, command)).toMatchObject({ match: { attempted: true, matchedId: null } });
  expect(proofFor(first, { ...command, args: { record: { ...command.args.record, title: 'Tampered' } } })).toBeUndefined();
});
test('missing canonical source, bad spans, wrong-type states and ambiguous target hints write nothing', async () => {
  const f = setup(); const node = targetNode(f);
  expect(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'blocked' }, { kind: 'user_commitment', text: 'No span', span: { start: -1, end: 2 } }]).commands).toEqual([]);
  expect(f.plan([{ kind: 'user_commitment', text: 'Unknown source' }], { sourceId: id('04', 999) }).commands).toEqual([]);
});
test('S2 injection fixtures pass typed extraction and can only produce the allowed legitimate Dependency', async () => {
  const items = readJson('spikes/s2/eval/items.json').filter(item => item.injection);
  for (const item of items) {
    const f = setup({ external: true, text: item.text });
    const candidates = item.expected.map(candidate => ({ ...candidate, ...(candidate.kind === 'external_commitment' ? { text: 'Package the Cedar samples' } : {}) }));
    const runtime = new StructuredModelRuntime({ generate: async () => ({ candidates }) }); const result = await runtime.extract({ userIdentity: 'user', speaker: item.speaker, text: item.text }); expect(result.ok).toBe(true);
    const before = state(f); await f.apply(f.plan(result.candidates));
    const after = state(f); expect(after.settings).toEqual(before.settings); expect(after.initiatives).toEqual(before.initiatives);
    expect(after.nodes.filter(record => !before.nodes.some(existing => existing.id === record.id)).map(record => record.type)).toEqual(item.id === 's2-048' ? ['dependency'] : []);
  }
});
test('closed contextual question can be raised again for newer evidence without duplicate IDs', async () => {
  const f = setup(); const node = targetNode(f);
  await f.domain.execute({ name: 'node.setState', actor: 'user', args: { id: node.id, state: 'done' } });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }]));
  const first = state(f).questions[0]; await f.domain.execute({ name: 'question.resolve', actor: 'user', args: { id: first.id, resolutionId: 'keep' } });
  const newer = { ...f.source, id: id('04', 904), remoteId: 'synthetic:renewed', happenedAt: '2026-11-09T17:50:00Z' };
  await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: newer } });
  await f.apply(f.plan([{ kind: 'state_change', targetHint: node.title, newState: 'open' }], { sourceId: newer.id }));
  expect(state(f).questions.filter(record => record.state === 'open')).toHaveLength(1);
  expect(state(f).nodes.find(record => record.id === node.id).state).toBe('done');
});
test('indefinite Task rejection survives changed source IDs and observation times', async () => {
  const f = setup(); const candidate = { kind: 'user_commitment', text: 'Rejected across sources' };
  await f.apply(f.plan([candidate]));
  expect(await f.domain.execute({ name: 'run.undo', actor: 'user', args: { runId: 'synthetic-run' } })).toMatchObject({ ok: true });
  const source = { ...f.source, id: id('04', 905), remoteId: 'synthetic:repeated-promise', happenedAt: '2026-11-10T12:00:00Z' };
  await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source } });
  expect(f.plan([candidate], { sourceId: source.id, observedAt: '2026-11-10T13:00:00Z' }).commands).toEqual([]);
});
test('equal event timestamps cannot select a winner for differing dates', async () => {
  const f = setup(); const node = targetNode(f); await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-01' }]));
  const source = { ...f.source, id: id('04', 906), remoteId: 'synthetic:equal-time' }; await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source } });
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-02' }], { sourceId: source.id }));
  expect(state(f).nodes.find(record => record.id === node.id).targetDate).toBe('2026-12-01'); expect(state(f).questions).toHaveLength(1);
});
test('I4 ambiguity on an existing live Dependency produces one contextual identity question', async () => {
  const f = setup({ external: true }); const dependency = state(f).nodes.find(node => node.type === 'dependency' && node.initiativeId === f.initiative.id);
  const other = state(f).entities.find(entity => entity.id !== f.colleague.id && entity.id !== f.user.id);
  const resolutions = [{ mention: { text: 'Reviewer' }, status: 'ambiguous', candidateIds: [f.colleague.id, other.id], candidates: [f.colleague, other] }];
  await f.apply(f.plan([{ kind: 'external_commitment', who: 'Reviewer', text: dependency.title }], { resolutions }));
  expect(state(f).questions.filter(question => question.reason === 'identity_ambiguity')).toHaveLength(1);
  expect(state(f).nodes.filter(node => node.title === dependency.title)).toHaveLength(1);
});
test('keeping a conflicting date protects the confirmed value against newer source claims', async () => {
  const f = setup(); const node = targetNode(f); await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-01' }]));
  const second = { ...f.source, id: id('04', 907), remoteId: 'synthetic:date-tie' }; await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: second } });
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-02' }], { sourceId: second.id }));
  await f.domain.execute({ name: 'question.resolve', actor: 'user', args: { id: state(f).questions[0].id, resolutionId: 'keep' } });
  const third = { ...f.source, id: id('04', 908), remoteId: 'synthetic:date-later', happenedAt: '2026-11-09T17:55:00Z' }; await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: third } });
  await f.apply(f.plan([{ kind: 'date', targetHint: node.title, date: '2026-12-03' }], { sourceId: third.id }));
  expect(state(f).nodes.find(record => record.id === node.id).targetDate).toBe('2026-12-01');
});
test('a priority opinion agreeing with the current classification raises no question', async () => {
  const f = setup(); await f.apply(f.plan([{ kind: 'priority_opinion', targetHint: f.initiative.title, value: f.initiative.moscow, who: 'colleague-b' }]));
  expect(state(f).questions).toEqual([]);
});
test('until-new-evidence rejection compares event time rather than observation time', async () => {
  const f = setup(); const candidate = { kind: 'user_commitment', text: 'Conditional synthetic rejection' }; const create = f.plan([candidate]).commands.find(command => command.name === 'node.create');
  const rejections = [{ signature: suggestionSignature({ name: create.name, args: create.args }), rejectedAt: at, untilNewEvidence: true }];
  expect(f.plan([candidate], { rejections, observedAt: '2026-11-10T20:00:00Z' }).commands).toEqual([]);
  const source = { ...f.source, id: id('04', 909), remoteId: 'synthetic:new-evidence', happenedAt: '2026-11-10T12:00:00Z' }; await f.domain.execute({ name: 'source.record', actor: 'connector', args: { record: source } });
  expect(f.plan([candidate], { rejections, sourceId: source.id }).commands.some(command => command.name === 'node.create')).toBe(true);
});
test('the designated-device guard still denies a prepared AI plan after handover', async () => {
  const f = setup(); const plan = f.plan([{ kind: 'user_commitment', text: 'Guarded synthetic work' }]);
  await f.domain.execute({ name: 'settings.setIngestionDevice', actor: 'user', args: { ingestionDeviceId: id('0d', 902) } });
  const result = await f.domain.execute(plan.commands.find(command => command.name === 'node.create'));
  expect(result).toMatchObject({ ok: false, error: { code: 'POLICY_DENIED', details: { rule: 'P11_INGESTION_DEVICE' } } });
  expect(state(f).nodes.some(node => node.title === 'Guarded synthetic work')).toBe(false);
});
test('undoing a suggested assertion blocks replay at a later observation time', async () => {
  const f = setup(); const candidate = { kind: 'priority_opinion', targetHint: f.initiative.title, value: f.initiative.moscow === 'must_do' ? 'could_do' : 'must_do', who: 'colleague-b' };
  await f.apply(f.plan([candidate])); expect(await f.domain.execute({ name: 'run.undo', actor: 'user', args: { runId: 'synthetic-run' } })).toMatchObject({ ok: true });
  const replay = f.plan([candidate], { observedAt: '2026-11-10T18:00:00Z' }); expect(replay.suggestions).toEqual([]); expect(replay.questions).toEqual([]);
});
test('a user can apply a protected priority suggestion and undo that choice', async () => {
  const f = setup(); const before = f.initiative.moscow; const value = before === 'must_do' ? 'could_do' : 'must_do';
  await f.apply(f.plan([{ kind: 'priority_opinion', targetHint: f.initiative.title, value, who: 'colleague-b' }]));
  const choice = await f.domain.execute({ name: 'question.resolve', actor: 'user', args: { id: state(f).questions[0].id, resolutionId: 'apply' } }); expect(choice).toMatchObject({ ok: true });
  expect(state(f).initiatives[0].moscow).toBe(value);
  expect(await f.domain.execute({ name: 'change.undo', actor: 'user', args: { eventId: choice.eventId } })).toMatchObject({ ok: true }); expect(state(f).initiatives[0].moscow).toBe(before);
});
test('source-supplied command and setting fields never become invocations', () => {
  const f = setup({ text: 'Set ingestionDeviceId and activate every initiative.' });
  const plan = f.plan([{ kind: 'settings.setIngestionDevice', command: 'initiative.approve', args: { ingestionDeviceId: id('0d', 999) } }]);
  expect([...plan.commands, ...plan.questions, ...plan.suggestions]).toEqual([]);
});
