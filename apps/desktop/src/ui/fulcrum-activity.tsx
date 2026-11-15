import { useEffect, useState } from 'react';
import type { FreshnessStatus, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
import { ProposalList } from './proposal-list.js';
import type { Proposal } from './proposal-list.js';

interface Props { board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand }

const questionLabel = (count: number) => `${count} ${count === 1 ? 'question needs' : 'questions need'} your answer`;

export function FulcrumActivity({ board, query, execute }: Props) {
  const [freshness, setFreshness] = useState<FreshnessStatus>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Reloads when the board changes so approvals and new proposals show up.
  useEffect(() => {
    let disposed = false;
    void Promise.all([query('status.freshness', {}), query('portfolio.list', { lifecycle: 'proposed' })])
      .then(([status, cards]) => { if (!disposed) { setFreshness(status); setProposals(cards.map(({ initiative }) => ({ id: initiative.id, title: initiative.title }))); } })
      .catch(() => { if (!disposed) setFreshness(undefined); });
    return () => { disposed = true; };
  }, [board, query]);
  async function decide(command: Parameters<ExecuteCommand>[0]) {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await execute(command); if (!result.ok) setError(result.error.message); }
    catch { setError('That change could not be saved. Nothing was activated.'); }
    finally { setBusy(false); }
  }
  const questions = board.rail.questionCount;
  return <section className="fulcrum-activity" aria-label="What Fulcrum is doing">
    {freshness?.state === 'disabled'
      ? <p>No sources are connected yet. <a href="#settings">Connect a source</a> and Fulcrum will read it, propose initiatives and ask you what it needs.</p>
      : freshness && <p role="status">{freshness.label}</p>}
    {questions > 0 && <p><a href="#questions">{questionLabel(questions)}</a></p>}
    {error && <p role="alert">{error}</p>}
    {proposals.length > 0 && <><h2>Proposed by Fulcrum</h2><p>Each stays inactive until you approve it.</p><ProposalList proposals={proposals} disabled={busy} decide={command => { void decide(command); }} /></>}
  </section>;
}
