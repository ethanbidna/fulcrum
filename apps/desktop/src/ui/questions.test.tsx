// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard, projectQuestionReview } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import { QuestionsCenter, ContextualQuestions } from './questions.js';
const fixture = () => JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
afterEach(cleanup);
function setup() {
  const state = fixture();
  const query = vi.fn().mockImplementation(async (_name, args) => projectQuestionReview(state, args));
  const execute = vi.fn().mockImplementation(async command => {
    const question = state.questions.find(question => question.id === command.args.id);
    if (question) question.state = command.name === 'question.defer' ? 'deferred' : 'resolved';
    return { ok: true, eventId: 'synthetic-event' };
  });
  return { state, query, execute, board: projectBoard(state, [], { now: '2026-11-09T18:00:00Z' }) };
}
test('quiet list groups by initiative, links context/evidence, and resolves once through the shared command', async () => {
  const f = setup(); render(<QuestionsCenter {...f} />);
  const question = f.state.questions[0]!;
  await screen.findByText(question.prompt);
  expect(screen.getByRole('heading', { name: 'Vendor evaluation' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'View context' })).toHaveLength(3);
  const article = screen.getByRole('article', { name: question.prompt });
  expect(article.textContent).not.toContain('edge.delete');
  fireEvent.click(screen.getByRole('button', { name: question.resolutions[0]!.label }));
  await screen.findByText('Answer saved.');
  expect(f.execute).toHaveBeenCalledExactlyOnceWith({ name: 'question.resolve', args: { id: question.id, resolutionId: question.resolutions[0]!.id } });
  await waitFor(() => expect(screen.queryByText(question.prompt)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(f.execute).toHaveBeenLastCalledWith({ name: 'change.undo', args: { eventId: 'synthetic-event' } }));
});
test('defer stays inline, supports an indefinite choice, and is reviewable separately', async () => {
  const f = setup(); const question = f.state.questions[0]!;
  render(<QuestionsCenter {...f} initiativeId={question.initiativeId} />); await screen.findByText(question.prompt);
  fireEvent.click(screen.getByText('Defer')); fireEvent.click(screen.getByRole('button', { name: 'Until I return' }));
  await screen.findByText('Question deferred.');
  expect(f.execute).toHaveBeenCalledWith({ name: 'question.defer', args: { id: question.id, deferredUntil: null } });
  fireEvent.change(screen.getByLabelText('Show questions'), { target: { value: 'deferred' } });
  await screen.findByText(question.prompt); expect(screen.getByText('Deferred until you return')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('failed resolution preserves the question and shows domain guidance without claiming success', async () => {
  const f = setup(); f.execute.mockResolvedValue({ ok: false, error: { code: 'STALE_BASE', message: 'The conflicted field changed after this question' } });
  render(<QuestionsCenter {...f} />); const question = f.state.questions[0]!; await screen.findByText(question.prompt);
  fireEvent.click(screen.getByRole('button', { name: question.resolutions[0]!.label }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('changed after this question');
  expect(screen.getByText(question.prompt)).toBeTruthy(); expect(screen.queryByText('Answer saved.')).toBeNull();
});
test('node/edge question controls read only the selected context', async () => {
  const f = setup(); const question = f.state.questions[0]!;
  render(<ContextualQuestions {...f} initiativeId={question.initiativeId} target={question.target} />);
  await screen.findByText(question.prompt);
  expect(f.query).toHaveBeenCalledWith('questions.review', { initiativeId: question.initiativeId, target: question.target, state: 'open' });
  expect(screen.queryByText(f.state.questions[1]!.prompt)).toBeNull();
});
test('read errors offer retry and an empty view states its scope', async () => {
  const f = setup(); f.query.mockRejectedValueOnce(new Error('synthetic offline'));
  render(<QuestionsCenter {...f} />); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry questions' })); await screen.findByText(f.state.questions[0]!.prompt);
  fireEvent.change(screen.getByLabelText('Show questions'), { target: { value: 'resolved' } });
  await screen.findByText('No answered questions.');
});
test('question scope and context links survive reload and browser hash navigation', async () => {
  const { questionInitiativeFromHash, inspectionFromHash, initiativeFromHash } = await import('./navigation.js');
  const initiativeId = '01000000-0000-7000-8000-000000000001'; const edgeId = '03000000-0000-7000-8000-000000000005';
  expect(questionInitiativeFromHash(`#questions/${initiativeId}`)).toBe(initiativeId);
  expect(questionInitiativeFromHash('#questions/not-an-id')).toBeUndefined();
  const hash = `#initiatives/${initiativeId}/inspect/edge/${edgeId}`;
  expect(initiativeFromHash(hash)).toBe(initiativeId); expect(inspectionFromHash(hash)).toEqual({ kind: 'edge', id: edgeId });
});
test('a pending action blocks repeated answers and transport failure keeps the decision available', async () => {
  const f = setup(); let reject!: (reason: Error) => void;
  f.execute.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<QuestionsCenter {...f} />); const question = f.state.questions[0]!; await screen.findByText(question.prompt);
  fireEvent.click(screen.getByRole('button', { name: question.resolutions[0]!.label }));
  const other = screen.getByRole('button', { name: question.resolutions[1]!.label });
  expect((other as HTMLButtonElement).disabled).toBe(true); fireEvent.click(other); expect(f.execute).toHaveBeenCalledOnce();
  reject(new Error('synthetic disconnected')); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('try again'); expect(screen.getByText(question.prompt)).toBeTruthy();
});
test('a late response from another scope cannot replace the current questions', async () => {
  const f = setup(); const first = f.state.questions[0]!; const next = f.state.questions[1]!;
  let finish!: (value: ReturnType<typeof projectQuestionReview>) => void;
  f.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ContextualQuestions {...f} target={first.target} initiativeId={first.initiativeId} />);
  view.rerender(<ContextualQuestions {...f} target={next.target} initiativeId={next.initiativeId} />);
  await screen.findByText(next.prompt); finish(projectQuestionReview(f.state, { target: first.target }));
  await waitFor(() => expect(screen.queryByText(first.prompt)).toBeNull()); expect(screen.getByText(next.prompt)).toBeTruthy();
});
test('tomorrow defers to a future timestamp and successful removal moves keyboard focus to feedback', async () => {
  const f = setup(); const question = f.state.questions[0]!;
  render(<QuestionsCenter {...f} initiativeId={question.initiativeId} />); await screen.findByText(question.prompt);
  fireEvent.click(screen.getByText('Defer')); fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
  const feedback = await screen.findByText('Question deferred.');
  expect(document.activeElement).toBe(feedback);
  const command = f.execute.mock.calls[0]![0]; expect(command.name).toBe('question.defer');
  expect(Date.parse(command.args.deferredUntil)).toBeGreaterThan(Date.now());
  expect(command.args.id).toBe(question.id);
});
test('a shared prerequisite reference exposes evidence and home navigation without mutation controls', async () => {
  const f = setup(); const question = f.state.questions[0]!;
  render(<ContextualQuestions {...f} target={question.target} initiativeId={question.initiativeId} mode="read" />);
  await screen.findByText(question.prompt);
  expect(screen.queryByRole('button', { name: question.resolutions[0]!.label })).toBeNull();
  expect(screen.getByRole('link', { name: 'All questions for this initiative' }).getAttribute('href')).toBe(`#questions/${question.initiativeId}`);
  expect(f.execute).not.toHaveBeenCalled();
});
test('the app opens a scoped question route and browser navigation returns to the global list', async () => {
  const { App } = await import('./app.js'); const f = setup(); const question = f.state.questions[0]!;
  const query = vi.fn().mockImplementation(async (name, args) => name === 'portfolio.board' ? f.board : name === 'initiative.get' ? f.state.initiatives.find(initiative => initiative.id === args.id) : projectQuestionReview(f.state, args));
  window.location.hash = `#questions/${question.initiativeId}`;
  const platform = { connectCore: async () => ({ query, execute: f.execute, subscribe: async () => () => {}, close: () => {} }) };
  render(<App platform={platform} />); await screen.findByText(question.prompt);
  expect(screen.queryByText(f.state.questions[1]!.prompt)).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'All questions' }));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await screen.findByText(f.state.questions[1]!.prompt);
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Questions' }));
  expect(f.execute).not.toHaveBeenCalled(); window.location.hash = '';
});
