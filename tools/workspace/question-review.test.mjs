import { expect, test } from 'vitest';
import { projectQuestionReview } from '../../packages/domain/src/index.ts';
import { readJson } from '../reference/schemas.mjs';
const fixture = () => readJson('fixtures/states/portfolio.state.json').state;
test('question review scopes initiative/node/edge and names context without exposing commands as copy', () => {
  const state = fixture(); const question = state.questions[0];
  const entries = projectQuestionReview(state, {}); expect(entries).toHaveLength(3);
  const entry = entries.find(entry => entry.question.id === question.id);
  expect(entry.initiative.title).toBe(state.initiatives.find(item => item.id === question.initiativeId).title);
  expect(entry.context.label).toContain('Relationship'); expect(entry.context.href).toContain(`/inspect/edge/${question.target.id}`);
  expect(projectQuestionReview(state, { target: question.target })).toEqual([entry]);
  expect(projectQuestionReview(state, { initiativeId: state.initiatives[3].id })).toEqual([]);
  const node = state.nodes.find(item => item.initiativeId === question.initiativeId);
  state.questions.push({ ...question, id: '06000000-0000-7000-8000-000000000999', target: { kind: 'node', id: node.id } });
  expect(projectQuestionReview(state, { target: { kind: 'node', id: node.id } })[0].context.label).toContain(node.title);
});
test('review evidence respects cache policy, ranges, source clocks, and safe original links', () => {
  const state = fixture(); const question = state.questions[0]; const source = state.sources.find(source => source.id === question.evidenceRefs[0].sourceId);
  source.excerpt = 'before synthetic quote after'; source.cachePolicy = 'excerpt'; source.permalink = 'https://example.test/synthetic';
  question.evidenceRefs[0].range = { start: 7, end: 22 };
  let evidence = projectQuestionReview(state, { target: question.target })[0].evidence[0];
  expect(evidence).toMatchObject({ excerpt: 'synthetic quote', permalink: source.permalink, happenedAt: source.happenedAt, ingestedAt: source.ingestedAt });
  source.cachePolicy = 'metadata'; source.permalink = 'javascript:alert(1)'; evidence = projectQuestionReview(state, { target: question.target })[0].evidence[0];
  expect(evidence).not.toHaveProperty('excerpt'); expect(evidence).not.toHaveProperty('permalink');
  source.permalink = 'https://synthetic:secret@example.test'; expect(projectQuestionReview(state, { target: question.target })[0].evidence[0]).not.toHaveProperty('permalink');
});
test('open is the default and deferred/resolved/obsolete remain inspectable by state', () => {
  const state = fixture(); const question = state.questions[0]; question.state = 'deferred';
  expect(projectQuestionReview(state, {}).some(entry => entry.question.id === question.id)).toBe(false);
  expect(projectQuestionReview(state, { state: 'deferred' })[0].question.id).toBe(question.id);
  question.state = 'resolved'; expect(projectQuestionReview(state, { state: 'resolved' })).toHaveLength(1);
  question.state = 'obsolete'; expect(projectQuestionReview(state, { state: 'obsolete' })).toHaveLength(1);
});
