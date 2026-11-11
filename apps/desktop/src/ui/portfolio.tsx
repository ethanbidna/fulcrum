import { useRef, useState } from 'react';
import { Accessibility, defaultPreset, StyleInjector } from '@dnd-kit/dom';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';
import type { PortfolioBoard, PortfolioCard } from '@fulcrum/domain';
import { PortfolioCardView } from './portfolio-card.js';
import { PortfolioRailView } from './portfolio-rail.js';
import { NewInitiative } from './new-initiative.js';
import type { ExecuteCommand } from './new-initiative.js';
import { groupCards, moveRanks, sortCards } from './portfolio-model.js';
import type { GroupBy, SortBy, CardGroup } from './portfolio-model.js';
const styleNonce = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][nonce]')?.nonce;
const portfolioDragPlugins = defaultPreset.plugins.map(plugin => {
  const constructor = typeof plugin === 'function' ? plugin : plugin.plugin;
  if (constructor !== Accessibility) return plugin;
  return { plugin: Accessibility, options: {
    screenReaderInstructions: { draggable: 'Press Space to pick up an initiative. Use arrow keys to move. Press Space to drop or Escape to cancel.' },
    announcements: {
      dragstart: (event: import('@dnd-kit/react').DragStartEvent) => `Moving ${event.operation.source?.data.title ?? 'initiative'}.`,
      dragover: (event: import('@dnd-kit/react').DragOverEvent) => isSortable(event.operation.source) ? `Position ${event.operation.source.index + 1}.` : undefined,
      dragend: (event: import('@dnd-kit/react').DragEndEvent) => event.canceled ? 'Move canceled.' : 'Initiative dropped. Saving manual order.',
    },
  } };
});
// Tauri nonces packaged styles; use the same authorization for drag feedback.
portfolioDragPlugins.push(StyleInjector.configure(styleNonce ? { nonce: styleNonce } : {}));
function SortableCard({ card, index, group, board, disabled, move }: { card: PortfolioCard; index: number; group: CardGroup; board: PortfolioBoard; disabled: boolean; move: (id: string, index: number) => void }) {
  const { ref, handleRef } = useSortable({ id: `${group.id}:${card.initiative.id}`, index, group: group.id, type: group.id, accept: group.id, data: { title: card.initiative.title }, disabled });
  const id = card.initiative.id;
  return <div ref={ref}><PortfolioCardView card={card} categoryLabels={board.categories.filter(category => card.initiative.categoryIds.includes(category.id)).map(category => category.label)} questionCount={board.questionCounts[id] ?? 0} controls={<div className="card-order-controls">
    <button className="order-step" disabled={disabled || index === 0} aria-label={`Move ${card.initiative.title} earlier`} onClick={() => move(id, index - 1)}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg></button>
    <button id={`reorder-${group.id}-${id}`} ref={handleRef} className="drag-handle" disabled={disabled} aria-label={`Reorder ${card.initiative.title}`} title={disabled ? 'Choose manual order to reorder' : 'Drag or press Space, then arrow keys'}><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg></button>
    <button className="order-step" disabled={disabled || index === group.cards.length - 1} aria-label={`Move ${card.initiative.title} later`} onClick={() => move(id, index + 1)}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
  </div>} /></div>;
}
export function Portfolio({ board, execute }: { board: PortfolioBoard; execute: ExecuteCommand }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('category'); const [sortBy, setSortBy] = useState<SortBy>('manual');
  const [railOpen, setRailOpen] = useState(true); const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false); const busy = useRef(false); const [error, setError] = useState(''); const [announcement, setAnnouncement] = useState('');
  const groups = groupCards(board, groupBy, sortBy);
  const reorder = async (group: CardGroup, id: string, target: number) => {
    if (busy.current || sortBy !== 'manual') return;
    const groupOrder = sortCards(group.cards, 'manual'); const moved = groupOrder.find(card => card.initiative.id === id);
    if (!moved || target < 0 || target >= groupOrder.length) return;
    const all = sortCards(board.cards, 'manual'); const neighbor = groupOrder[target]!;
    const globalTarget = all.findIndex(card => card.initiative.id === neighbor.initiative.id);
    const ranks = moveRanks(all, id, globalTarget); if (!ranks) return;
    busy.current = true; setPending(true); setError('');
    try { const result = await execute({ name: 'initiative.rerank', args: { ranks } }); if (!result.ok) setError(result.error.message); else { setAnnouncement(`Moved ${moved.initiative.title}. Manual order saved.`); requestAnimationFrame(() => document.getElementById(`reorder-${group.id}-${id}`)?.focus()); } }
    catch { setError('Could not save order. Check the core connection and try again.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="portfolio">
    <div className="portfolio-toolbar"><div className="view-controls"><label>Group by<select value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)} disabled={pending}><option value="category">Category</option><option value="moscow">MoSCoW</option><option value="team">Team</option><option value="objective">Objective</option><option value="none">None</option></select></label><label>Sort<select value={sortBy} onChange={event => setSortBy(event.target.value as SortBy)} disabled={pending}><option value="manual">Manual order</option><option value="moscow">MoSCoW</option><option value="changed">Last changed</option><option value="date">Date</option></select></label></div><div className="toolbar-actions"><button className="secondary-button" aria-expanded={railOpen} aria-controls="portfolio-context" onClick={() => setRailOpen(!railOpen)}>{railOpen ? 'Hide context' : 'Show context'}</button><button className="primary-button" onClick={() => setCreating(!creating)} aria-expanded={creating}>New initiative</button></div></div>
    {creating && <NewInitiative execute={execute} close={() => setCreating(false)} />}
    {error && <p className="command-error" role="alert">{error}</p>}<p className="visually-hidden" role="status">{announcement}</p>
    <div className={`portfolio-layout ${railOpen ? 'with-rail' : ''}`} aria-busy={pending}>
      <div className="portfolio-groups">{board.cards.length === 0 && <section className="board-empty"><h2>No active initiatives yet</h2><p>Create an initiative to start organizing your work.</p></section>}{groups.map(group => <section className="portfolio-group" key={group.id} aria-label={group.label}><h2>{group.label}<span>{group.cards.length}</span></h2><DragDropProvider plugins={portfolioDragPlugins} onDragEnd={event => { const source = event.operation.source; if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return; const card = group.cards[source.initialIndex]; if (card) void reorder(group, card.initiative.id, source.index); }}><div className="initiative-grid">{group.cards.map((card, index) => <SortableCard key={card.initiative.id} card={card} index={index} group={group} board={board} disabled={sortBy !== 'manual' || pending} move={(id, target) => { void reorder(group, id, target); }} />)}</div></DragDropProvider></section>)}</div>
      {railOpen && <PortfolioRailView board={board} />}
    </div>
  </div>;
}
