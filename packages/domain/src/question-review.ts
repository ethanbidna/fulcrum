import type { Question, Source } from '@fulcrum/schema';
import type { InspectionTarget } from './inspector-projections.js';
import type { WorkspaceState } from './types.js';
import { clone } from './commands.js';

export interface QuestionReviewScope { initiativeId?: string; target?: InspectionTarget; state?: Question['state'] }
export interface QuestionEvidence {
  id: string; title: string; connector: string; happenedAt?: string; ingestedAt: string; permalink?: string; excerpt?: string;
}
export interface QuestionReview {
  question: Question;
  initiative: { id: string; title: string };
  context: { label: string; href: string };
  evidence: QuestionEvidence[];
}
export function projectQuestionReview(state: WorkspaceState, scope: QuestionReviewScope): QuestionReview[] {
  return state.questions.filter(question => question.state === (scope.state ?? 'open')
    && (!scope.initiativeId || question.initiativeId === scope.initiativeId)
    && (!scope.target || question.target.kind === scope.target.kind && question.target.id === scope.target.id))
    .flatMap(question => {
      const initiative = state.initiatives.find(initiative => initiative.id === question.initiativeId);
      if (!initiative) return [];
      return [{ question: clone(question), initiative: { id: initiative.id, title: initiative.title }, context: questionContext(state, question),
        evidence: (question.evidenceRefs ?? []).flatMap(ref => {
          const source = state.sources.find(source => source.id === ref.sourceId);
          return source ? [questionEvidence(source, ref.range)] : [];
        }) }];
    }).sort((a, b) => a.initiative.title.localeCompare(b.initiative.title) || a.initiative.id.localeCompare(b.initiative.id)
      || a.question.createdAt.localeCompare(b.question.createdAt) || a.question.id.localeCompare(b.question.id));
}
function questionContext(state: WorkspaceState, question: Question): QuestionReview['context'] {
  const { target, initiativeId } = question;
  const base = `#initiatives/${initiativeId}`;
  if (target.kind === 'initiative') {
    const fieldLabels: Record<string, string> = { moscow: 'MoSCoW', lifecycle: 'Lifecycle', title: 'Title' };
    return { label: target.field ? `Initiative · ${fieldLabels[target.field] ?? target.field}` : 'Initiative', href: base };
  }
  if (target.kind === 'node') {
    const node = state.nodes.find(node => node.id === target.id);
    return { label: `${node?.type === 'task' ? 'Task' : node?.type === 'dependency' ? 'Dependency' : node?.type === 'decision' ? 'Decision' : 'Milestone'} · ${node?.title ?? 'Unavailable item'}`, href: `${base}/inspect/node/${target.id}` };
  }
  const edge = state.edges.find(edge => edge.id === target.id);
  const title = (id?: string) => state.nodes.find(node => node.id === id)?.title ?? 'Unavailable item';
  return { label: `Relationship · ${title(edge?.fromId)} → ${title(edge?.toId)}`, href: `${base}/inspect/edge/${target.id}` };
}
function questionEvidence(source: Source, range?: { start: number; end: number }): QuestionEvidence {
  let permalink: string | undefined;
  try {
    const url = new URL(source.permalink ?? '');
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) permalink = url.href;
  } catch { /* A source may have no original link. */ }
  const excerpt = source.cachePolicy === 'excerpt' && source.excerpt ? range ? source.excerpt.slice(range.start, range.end) : source.excerpt : undefined;
  return { id: source.id, title: source.title ?? 'Recorded evidence', connector: source.connector, ingestedAt: source.ingestedAt,
    ...(source.happenedAt ? { happenedAt: source.happenedAt } : {}), ...(permalink ? { permalink } : {}), ...(excerpt ? { excerpt } : {}) };
}
