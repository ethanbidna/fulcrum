import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadValidators, readJson } from '../reference/schemas.mjs';
import { readWorkspace } from '../reference/workspace-reader.mjs';
import path from 'node:path';
import { REPO_ROOT } from '../reference/schemas.mjs';

const v = loadValidators();
const errorsOf = validate => JSON.stringify(validate.errors, null, 2);
const portfolio = () => structuredClone(readJson('fixtures/states/portfolio.state.json'));
const nodeById = (doc, id) => doc.state.nodes.find(n => n.id === id);
const TASK_ID = '02000000-0000-7000-8000-000000000003';

test('portfolio fixture matches workspace-state schema', () => {
  assert.ok(v.workspaceState(portfolio()), errorsOf(v.workspaceState));
});

test('workspace-example manifest, events and checkpoint match schemas', () => {
  const ws = readWorkspace(path.join(REPO_ROOT, 'fixtures/workspace-example'));
  assert.ok(v.workspace(ws.manifest), errorsOf(v.workspace));
  for (const event of ws.events) assert.ok(v.changeEvent(event), errorsOf(v.changeEvent));
  for (const cp of ws.checkpoints) assert.ok(v.workspaceState(cp.body), errorsOf(v.workspaceState));
});

test('a Task cannot carry an external assignee', () => {
  for (const field of ['responsibleEntityId', 'assignee', 'owner']) {
    const task = { ...nodeById(portfolio(), TASK_ID), [field]: '08000000-0000-7000-8000-000000000001' };
    assert.equal(v.flowObject(task), false, `task with ${field} must be rejected`);
  }
});

test('a Dependency may name a responsible entity', () => {
  const dep = nodeById(portfolio(), '02000000-0000-7000-8000-000000000005');
  assert.ok(v.flowObject(dep), errorsOf(v.flowObject));
});

test('MoSCoW accepts only Must/Should/Could/Won\'t Do', () => {
  const initiative = portfolio().state.initiatives[0];
  for (const moscow of ['must_have', 'high', 'p1']) assert.equal(v.initiative({ ...initiative, moscow }), false);
  for (const moscow of ['must_do', 'should_do', 'could_do', 'wont_do', null]) assert.ok(v.initiative({ ...initiative, moscow }), errorsOf(v.initiative));
});

test('initiatives have no percent-complete field', () => {
  const initiative = { ...portfolio().state.initiatives[0], percentComplete: 40 };
  assert.equal(v.initiative(initiative), false);
});

test('a Question offers 2-3 resolutions', () => {
  const q = portfolio().state.questions[0];
  assert.equal(v.question({ ...q, resolutions: q.resolutions.slice(0, 1) }), false);
  assert.ok(v.question(q), errorsOf(v.question));
});

test('fixtures contain only synthetic identifiers and no email addresses', async () => {
  const { execFileSync } = await import('node:child_process');
  const files = execFileSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'fixtures'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const fs = await import('node:fs');
  const SYNTHETIC_UUID = /^[0-9a-f]{2}000000-0000-7000-8000-[0-9a-f]{12}$/;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  for (const file of files) {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const id of text.match(UUID) ?? []) assert.match(id, SYNTHETIC_UUID, `${file}: non-synthetic id ${id}`);
    assert.doesNotMatch(text, EMAIL, `${file} contains an email address`);
  }
});

test('there is no "initiative" node type (the initiative is the canvas)', () => {
  const node = { ...nodeById(portfolio(), TASK_ID), type: 'initiative' };
  assert.equal(v.flowObject(node), false);
});
