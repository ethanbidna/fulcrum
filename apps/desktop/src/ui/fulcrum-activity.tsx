import { useEffect, useState } from 'react';
import type { FreshnessStatus, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
import { ProposalList } from './proposal-list.js';
import type { Proposal } from './proposal-list.js';

interface Props { board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand; hero: boolean; onAddInitiative: () => void }
type Summary = { title: string; detail: string; working: boolean; needsSource: boolean };

const WORKING_STATES: FreshnessStatus['state'][] = ['catching-up', 'awaiting-extraction'];
const questionLabel = (count: number) => `${count} ${count === 1 ? 'question needs' : 'questions need'} your answer`;

function summarize(freshness: FreshnessStatus | undefined, waiting: boolean): Summary {
  if (!freshness) return { title: 'Getting ready…', detail: '', working: false, needsSource: false };
  if (freshness.state === 'disabled') return { title: 'Connect a source to get started', detail: 'Fulcrum reads your work conversations, builds your portfolio and asks only what it needs to know.', working: false, needsSource: true };
  if (WORKING_STATES.includes(freshness.state)) return { title: 'Reading your sources…', detail: freshness.label, working: true, needsSource: false };
  if (freshness.state === 'current' || freshness.state === 'unknown' || freshness.state === 'viewer') return { title: waiting ? 'Waiting on you' : 'Watching your sources', detail: waiting ? freshness.label : `Nothing needs you right now. ${freshness.label}`, working: false, needsSource: false };
  return { title: 'Fulcrum needs attention', detail: freshness.label, working: false, needsSource: false };
}

function Mark({ working }: { working: boolean }) {
  return <svg className="activity-mark" data-working={working} viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M36 42 26 62h20z" />
    <g className="activity-beam"><path d="M10 42h52" /><circle cx="10" cy="42" r="5" fill="currentColor" /><circle cx="62" cy="42" r="5" fill="currentColor" /></g>
  </svg>;
}

export function FulcrumActivity({ board, query, execute, hero, onAddInitiative }: Props) {
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
  const summary = summarize(freshness, proposals.length > 0 || questions > 0);
  const waiting = <>
    {questions > 0 && <p><a href="#questions">{questionLabel(questions)}</a></p>}
    {error && <p role="alert">{error}</p>}
    {proposals.length > 0 && <><h2>Proposed by Fulcrum</h2><p>Each stays inactive until you approve it.</p><ProposalList proposals={proposals} disabled={busy} decide={command => { void decide(command); }} /></>}
  </>;
  if (!hero) return <section className="fulcrum-activity" aria-label="What Fulcrum is doing">
    {freshness && <p role="status" className="activity-strip">{summary.needsSource ? <>No sources are connected yet. <a href="#settings">Connect a source</a></> : summary.detail || summary.title}</p>}
    {waiting}
  </section>;
  return <section className="fulcrum-activity activity-hero" aria-label="What Fulcrum is doing">
    <Mark working={summary.working} />
    <div role="status" className="activity-summary"><h2>{summary.title}</h2>{summary.detail && <p>{summary.detail}</p>}</div>
    {summary.needsSource && <><a className="primary-button" href="#settings">Connect a source</a><button className="link-button" onClick={onAddInitiative}>or add an initiative yourself</button></>}
    {waiting}
  </section>;
}
