import type { PortfolioCard } from '@fulcrum/domain';
import type { ReactNode } from 'react';
import { cardStateText, moscowLabels } from './portfolio-model.js';
export function PortfolioCardView({ card, categoryLabels, questionCount, controls }: { card: PortfolioCard; categoryLabels: string[]; questionCount: number; controls?: ReactNode }) {
  const item = card.initiative;
  return <article className="initiative-card" aria-label={item.title}>
    <div className="card-topline"><span className="moscow-label">{item.moscow === null ? 'MoSCoW not set' : moscowLabels[item.moscow]}</span>{controls}</div>
    <h3><a href={`#initiatives/${item.id}`}>{item.title}</a></h3>
    {item.description && <p className="card-description">{item.description}</p>}
    <p className={`card-state state-${card.cardState.kind}`}>{cardStateText(card)}</p>
    <div className="card-metadata">{categoryLabels.length > 0 && <span>{categoryLabels.join(' · ')}</span>}{item.targetDate && <time dateTime={item.targetDate}>Due {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.targetDate}T00:00:00Z`))}</time>}</div>
    <div className="card-indicators"><span role="img" title="Source freshness is unavailable until ingestion status is connected" aria-label="Source freshness unavailable"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" /></svg></span>{questionCount > 0 && <a href="#questions" aria-label={`${questionCount} open ${questionCount === 1 ? 'question' : 'questions'} for ${item.title}`}>Questions <span>{questionCount}</span></a>}</div>
  </article>;
}
