import { useEffect, useState } from 'react';
import type { ContextEvidence, EvidenceScope, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
export interface EvidenceListProps { rows: ContextEvidence[]; initiativeId: string }
export function EvidenceList({ rows, initiativeId }: EvidenceListProps) {
  if (!rows.length) return <p>No evidence linked here yet. Sources will appear after they are linked to this work.</p>;
  return <ol className="evidence-list">{rows.map(row => <li key={row.sourceId}><article>
    <h3>{row.source?.title ?? (row.source ? 'Recorded source' : 'Source unavailable')}</h3>
    {row.source ? <><p className="evidence-provenance">{row.source.connector} · {row.sender ?? 'Sender not recorded'}</p>
      <dl className="inspector-facts"><dt>Happened</dt><dd>{row.source.happenedAt ? <time dateTime={row.source.happenedAt}>{new Date(row.source.happenedAt).toLocaleString()}</time> : 'Not recorded'}</dd><dt>Learned</dt><dd><time dateTime={row.source.ingestedAt}>{new Date(row.source.ingestedAt).toLocaleString()}</time></dd></dl>
      {row.source.cachePolicy === 'excerpt' && row.source.excerpt ? <blockquote className="evidence-excerpt">{row.source.excerpt}</blockquote> : <p className="evidence-provenance">No cached excerpt.</p>}
      {row.source.permalink ? <a href={row.source.permalink} target="_blank" rel="noreferrer">Open original (opens in new window)<span className="visually-hidden">: {row.source.title ?? 'Recorded source'}</span></a> : <p className="evidence-provenance">Original link unavailable.</p>}
    </> : <p>The reference is retained, but its source is unavailable.</p>}
    <h4>Linked work</h4><ul>{row.targets.map(target => <li key={`${target.kind}:${target.id}`}><a href={target.kind === 'initiative' ? `#initiatives/${initiativeId}` : `#initiatives/${initiativeId}/inspect/${target.kind}/${target.id}`}>{target.label}</a></li>)}</ul>
    <h4>Supported claims</h4>{row.assertions.length ? <ul>{row.assertions.map(assertion => <li key={assertion.id}><p>{claimText(assertion.predicate, assertion.value)}</p><p className="evidence-provenance">{assertion.certainty === 'explicit' ? 'Explicit' : 'Inferred'} · {assertion.status} · Learned <time dateTime={assertion.observedAt}>{new Date(assertion.observedAt).toLocaleString()}</time>{assertion.validFrom ? ` · Valid from ${assertion.validFrom}` : ''}{assertion.validTo ? ` · Valid until ${assertion.validTo}` : ''}</p></li>)}</ul> : <p className="evidence-provenance">No assertions recorded for these links.</p>}
  </article></li>)}</ol>;
}
export function EvidencePanel({ scope, board, query }: { scope: EvidenceScope; board: PortfolioBoard; query: CoreTransport['query'] }) {
  const [rows, setRows] = useState<ContextEvidence[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setRows(undefined); setError('');
    void query('evidence.list', scope).then(value => { if (!disposed) setRows(value); }).catch(() => { if (!disposed) setError('Could not load evidence. Retry to load the current links.'); });
    return () => { disposed = true; };
  }, [scope.initiativeId, scope.target?.kind, scope.target?.id, board, query, retry]);
  return <section aria-label={scope.target ? 'Object evidence' : 'Initiative context'} className="context-view"><h2>{scope.target ? 'Evidence' : 'Context'}</h2>{!scope.target && <p>Sources linked to this initiative, its work and relationships. Source claims remain distinct from your confirmed state.</p>}{error ? <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry evidence</button></> : rows ? <EvidenceList rows={rows} initiativeId={scope.initiativeId} /> : <p role="status">Loading evidence…</p>}</section>;
}

export function claimText(predicate: string, value: unknown): string {
  if (predicate === 'prerequisite' && typeof value === 'boolean') return value ? 'Prerequisite confirmed' : 'Prerequisite not confirmed';
  const labels: Record<string, string> = { user_commitment: 'Your commitment', external_commitment: 'External commitment', initiative_proposal: 'Proposed initiative', priority_opinion: 'Priority opinion' };
  const label = labels[predicate] ?? readableLabel(predicate);
  return `${label}: ${claimValue(value)}`;
}
function readableLabel(value: string): string { const words = value.replaceAll('_', ' '); return words.charAt(0).toUpperCase() + words.slice(1); }
function claimValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(claimValue).join(' · ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${readableLabel(key)}: ${claimValue(item)}`).join(' · ');
  return String(value);
}
