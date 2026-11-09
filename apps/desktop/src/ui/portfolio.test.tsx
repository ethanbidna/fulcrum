// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { projectBoard } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import { PortfolioCardView } from './portfolio-card.js';
import { Portfolio } from './portfolio.js';
import { groupCards, sortCards, moveRanks } from './portfolio-model.js';
const snapshot = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')) as { state: WorkspaceState };
const board = () => projectBoard(structuredClone(snapshot.state), [], { now: '2026-11-08T20:00:00Z' });
afterEach(cleanup);
for (const card of board().cards) test(`card snapshot: ${card.cardState.kind}`, () => {
  expect(renderToStaticMarkup(<PortfolioCardView card={card} categoryLabels={['Synthetic category']} questionCount={1} />)).toMatchSnapshot();
});
test('each grouping preserves active identity and excludes proposals', () => {
  const value = board();
  for (const groupBy of ['category', 'moscow', 'team', 'objective', 'none'] as const) {
    const groups = groupCards(value, groupBy, 'manual');
    expect(new Set(groups.flatMap(group => group.cards.map(card => card.initiative.id))).size).toBe(4);
    expect(groups.flatMap(group => group.cards).every(card => card.initiative.lifecycle === 'active')).toBe(true);
  }
  expect(groupCards(value, 'category', 'manual').map(group => group.label)).toEqual(['Tooling', 'Governance', 'Research']);
  expect(sortCards(value.cards, 'moscow')[0]!.initiative.title).toBe('Data retention policy');
  expect(sortCards(value.cards, 'date')[0]!.initiative.title).toBe('Vendor evaluation');
});
test('manual movement handles missing and duplicate ranks without mutating cards', () => {
  const value = board(); const cards = value.cards;
  cards[0]!.initiative.manualRank = 'a0'; cards[1]!.initiative.manualRank = 'a0'; delete cards[2]!.initiative.manualRank;
  const before = structuredClone(cards); const id = sortCards(cards, 'manual')[0]!.initiative.id;
  const ranks = moveRanks(cards, id, 3)!;
  expect(ranks.at(-1)!.id).toBe(id); expect(new Set(ranks.map(item => item.manualRank)).size).toBe(4);
  expect(cards).toEqual(before);
});
test('board grouping/sort controls and context collapse work without writes', () => {
  const execute = vi.fn(); render(<Portfolio board={board()} execute={execute} />);
  expect(screen.queryByText('Onboarding survey refresh')).toBeNull();
  fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'moscow' } });
  expect(screen.getByRole('region', { name: 'Must Do' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide context' }));
  expect(screen.queryByRole('complementary', { name: 'Portfolio context' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'date' } });
  expect((screen.getByRole('button', { name: 'Reorder Vendor evaluation' }) as HTMLButtonElement).disabled).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
test('keyboard-accessible reorder sends one atomic command and exposes rejection', async () => {
  const execute = vi.fn().mockResolvedValue({ ok: false, error: { code: 'STALE_BASE', message: 'Order could not be saved' } });
  render(<Portfolio board={board()} execute={execute} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Vendor evaluation later' }));
  await screen.findByRole('alert');
  expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0]![0].name).toBe('initiative.rerank');
  expect(execute.mock.calls[0]![0].args.ranks).toHaveLength(4);
  expect(screen.getByRole('alert').textContent).toBe('Order could not be saved');
});
test('new initiative is an explicit user command and failure preserves the draft', async () => {
  const execute = vi.fn().mockResolvedValue({ ok: false, error: { message: 'Synthetic rejection' } });
  render(<Portfolio board={board()} execute={execute} />);
  fireEvent.click(screen.getByRole('button', { name: 'New initiative' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic outcome' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create initiative' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Synthetic rejection'));
  expect(execute.mock.calls[0]![0]).toMatchObject({ name: 'initiative.create', args: { record: { title: 'Synthetic outcome', moscow: null } } });
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Synthetic outcome');
});
test('recent changes name the question or initiative context', () => {
  const value = board(); const question = snapshot.state.questions[0]!; const edge = snapshot.state.edges[0]!;
  value.rail.meaningfulChanges = [
    { context: question.prompt, eventId: 'question-change', actor: 'user', at: '2026-11-08T20:00:00Z', deviceId: 'synthetic', command: { name: 'question.raise', args: {} }, changes: [{ kind: 'question', id: question.id, operation: 'create', before: null, after: question }], evidenceRefs: [] },
    { context: 'Vendor evaluation', eventId: 'edge-change', actor: 'user', at: '2026-11-08T20:00:00Z', deviceId: 'synthetic', command: { name: 'edge.create', args: {} }, changes: [{ kind: 'edge', id: edge.id, operation: 'create', before: null, after: edge }], evidenceRefs: [] },
  ];
  render(<Portfolio board={value} execute={vi.fn()} />);
  expect(screen.getByText(`${question.prompt} · Question added`)).toBeTruthy();
  expect(screen.getByText('Vendor evaluation · Relationship added')).toBeTruthy();
});
