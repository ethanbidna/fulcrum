import type { PortfolioBoard } from '@fulcrum/domain';
const MAX_RAIL_CHANGES = 5;
function changeLabel(entry: PortfolioBoard['rail']['meaningfulChanges'][number], board: PortfolioBoard) {
  const change = entry.changes[0];
  if (!change) return 'Workspace changed';
  const record = change.operation === 'tombstone' ? change.before : change.after;
  const recordText = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  const recordTitle = [recordText.title, recordText.prompt, recordText.label].find(value => typeof value === 'string') as string | undefined;
  const initiativeTitle = board.cards.find(card => card.initiative.id === change.id || card.initiative.id === recordText.initiativeId)?.initiative.title;
  const title = entry.context ?? recordTitle ?? initiativeTitle;

  const kind = { initiative: 'Initiative', node: 'Flow item', edge: 'Relationship', question: 'Question', objective: 'Objective' }[change.kind as 'initiative'] ?? 'Workspace item';
  const fields: Record<string, string> = { moscow: 'MoSCoW changed', targetDate: 'Date changed', outcome: 'Decision recorded', state: 'State changed', lifecycle: 'Lifecycle changed', objectiveLinks: 'Objectives changed' };
  const action = change.operation === 'create' ? `${kind} added` : change.operation === 'tombstone' ? `${kind} removed` : fields[change.field ?? ''] ?? 'Updated';
  return `${title ?? kind} · ${action}`;
}
export function PortfolioRailView({ board }: { board: PortfolioBoard }) {
  const { rail } = board;
  const initiativeName = (id: string) => board.cards.find(card => card.initiative.id === id)?.initiative.title ?? 'Initiative';
  return <aside className="portfolio-rail" id="portfolio-context" aria-label="Portfolio context">
    <section><h2>Next actions</h2>{rail.nextAvailableActions.length ? <ul>{rail.nextAvailableActions.map(item => <li key={`${item.initiativeId}:${item.node.id}`}><p>{item.node.title}</p><span>{initiativeName(item.initiativeId)}</span></li>)}</ul> : <p className="rail-empty">No next actions defined.</p>}</section>
    <section><h2>Waiting on</h2>{rail.waitingOn.length ? <ul>{rail.waitingOn.map(item => <li key={item.node.id}><p>{item.node.title}</p><span>{item.initiativeIds.map(initiativeName).join(' · ')}</span></li>)}</ul> : <p className="rail-empty">No gating dependencies.</p>}</section>
    <section><h2>Recently changed</h2>{rail.meaningfulChanges.length ? <ul>{rail.meaningfulChanges.slice(0, MAX_RAIL_CHANGES).map(item => <li key={item.eventId}><p>{changeLabel(item, board)}</p><time dateTime={item.at}>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(item.at))}</time></li>)}</ul> : <p className="rail-empty">No recent meaningful changes.</p>}</section>
    <a className="rail-questions" href="#questions">Questions <span>{rail.questionCount}</span></a>
  </aside>;
}
