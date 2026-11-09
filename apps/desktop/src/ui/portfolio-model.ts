import { generateNKeysBetween } from 'fractional-indexing';
import type { PortfolioBoard, PortfolioCard } from '@fulcrum/domain';
export const moscowLabels = { must_do: 'Must Do', should_do: 'Should Do', could_do: 'Could Do', wont_do: "Won't Do" } as const;
export type GroupBy = 'category' | 'moscow' | 'team' | 'objective' | 'none';
export type SortBy = 'manual' | 'moscow' | 'changed' | 'date';
export interface CardGroup { id: string; label: string; cards: PortfolioCard[] }
const moscowOrder = ['must_do', 'should_do', 'could_do', 'wont_do'];
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
export function sortCards(cards: PortfolioCard[], sort: SortBy): PortfolioCard[] {
  return [...cards].sort((left, right) => {
    const a = left.initiative; const b = right.initiative;
    let order = 0;
    if (sort === 'manual') order = compareText(a.manualRank ?? '\uffff', b.manualRank ?? '\uffff');
    if (sort === 'moscow') order = (a.moscow === null ? moscowOrder.length : moscowOrder.indexOf(a.moscow)) - (b.moscow === null ? moscowOrder.length : moscowOrder.indexOf(b.moscow));
    if (sort === 'changed') order = compareText(b.updatedAt, a.updatedAt);
    if (sort === 'date') order = compareText(a.targetDate ?? '\uffff', b.targetDate ?? '\uffff');
    return order || compareText(a.id, b.id);
  });
}
export function groupCards(board: PortfolioBoard, groupBy: GroupBy, sortBy: SortBy): CardGroup[] {
  const cards = sortCards(board.cards, sortBy);
  if (!cards.length) return [];
  if (groupBy === 'none') return [{ id: 'all', label: 'All initiatives', cards }];
  const definitions = groupBy === 'category' ? [...board.categories].sort((a, b) => compareText(a.manualRank ?? '', b.manualRank ?? '')).map(item => ({ id: item.id, label: item.label }))
    : groupBy === 'team' ? board.teams.map(item => ({ id: item.id, label: item.label }))
      : groupBy === 'objective' ? [...board.objectives].sort((a, b) => a.rank - b.rank || compareText(a.id, b.id)).map(item => ({ id: item.id, label: item.label }))
        : moscowOrder.map(id => ({ id, label: moscowLabels[id as keyof typeof moscowLabels] }));
  const groups: CardGroup[] = definitions.map(item => ({ ...item, cards: [] }));
  const fallback: CardGroup = { id: 'unclassified', label: groupBy === 'category' ? 'No category' : groupBy === 'team' ? 'No team' : groupBy === 'objective' ? 'No objective' : 'MoSCoW not set', cards: [] };
  for (const card of cards) {
    const record = card.initiative;
    const ids: (string | null | undefined)[] = groupBy === 'category' ? record.categoryIds : groupBy === 'team' ? [record.teamEntityId] : groupBy === 'objective' ? (record.objectiveLinks ?? []).map(link => link.objectiveId) : [record.moscow];
    const matches = groups.filter(group => ids.includes(group.id));
    for (const group of matches.length ? matches : [fallback]) group.cards.push(card);
  }
  return [...groups, fallback].filter(group => group.cards.length > 0);
}
export function moveRanks(cards: PortfolioCard[], id: string, destination: number) {
  const ordered = sortCards(cards, 'manual'); const start = ordered.findIndex(card => card.initiative.id === id);
  if (start < 0 || destination < 0 || destination >= ordered.length || start === destination) return;
  const [moved] = ordered.splice(start, 1); ordered.splice(destination, 0, moved!);
  const keys = generateNKeysBetween(null, null, ordered.length);
  return ordered.map((card, index) => ({ id: card.initiative.id, manualRank: keys[index]! }));
}
export function cardStateText(card: PortfolioCard): string {
  const state = card.cardState;
  if (state.kind === 'unclear') return 'Next step unclear';
  const label = state.kind === 'next_action' ? 'My next action' : state.kind === 'blocked' ? 'Blocked by' : 'Waiting for';
  return `${label}: ${state.title}`;
}
