import { projectEvidence } from './evidence-projections.js';
import type { ContextEvidence, EvidenceScope } from './evidence-projections.js';
import { projectQuestionReview } from './question-review.js';
import type { QuestionReview, QuestionReviewScope } from './question-review.js';
import { projectInitiativeList, projectInitiativeHistory } from './detail-projections.js';
import type { InitiativeListRow, InitiativeHistoryEntry } from './detail-projections.js';
import { projectInspection } from './inspector-projections.js';
import type { Inspection, InspectionTarget } from './inspector-projections.js';
import type { SearchScope, SearchHit, IndexProgress } from '@fulcrum/index/interfaces';
import type { Initiative, Question } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import type { Replay } from './replay.js';
import { clone, DomainFault, object, text } from './commands.js';
import { projectFocus, projectGraph } from './graph-projections.js';
import type { GraphView } from './graph-projections.js';
import { projectHistory } from './history-projections.js';
import type { HistoryEntry, HistoryFilter } from './history-projections.js';
import { projectPortfolio, projectRail, projectBoard } from './projections.js';
import type { PortfolioCard, PortfolioRail, PortfolioBoard } from './projections.js';

export interface QueryArgs {
  'evidence.list': EvidenceScope;
  'questions.review': QuestionReviewScope;
  'questions.list': { initiativeId?: string; state?: Question['state'] };
  'search': { text: string; scope?: SearchScope };
  'status.index': Record<string, never>;
  'portfolio.list': Record<string, never>;
  'portfolio.board': Record<string, never>;
  'portfolio.rail': { since?: string };
  'initiative.list': { initiativeId: string };
  'initiative.history': { initiativeId: string };
  'graph.get': { initiativeId: string };
  'graph.focus': { nodeId: string };
  'initiative.get': { id: string };
  'node.get': { id: string };
  'inspector.get': { target: InspectionTarget };
  'history.list': HistoryFilter;
}
export interface QueryResults {
  'evidence.list': ContextEvidence[];
  'questions.review': QuestionReview[];
  'questions.list': Question[];
  'search': SearchHit[];
  'status.index': IndexProgress;
  'portfolio.list': PortfolioCard[];
  'portfolio.board': PortfolioBoard;
  'portfolio.rail': PortfolioRail;
  'initiative.list': InitiativeListRow[];
  'initiative.history': InitiativeHistoryEntry[];
  'graph.get': GraphView;
  'graph.focus': GraphView;
  'initiative.get': Initiative;
  'node.get': Node;
  'inspector.get': Inspection;
  'history.list': HistoryEntry[];
}
export type QueryName = keyof QueryArgs;
const QUERY_FIELDS: Record<QueryName, string[]> = {
  'evidence.list': ['initiativeId', 'target'],
  'questions.list': ['initiativeId', 'state'], 'questions.review': ['initiativeId', 'target', 'state'],
  'search': ['text', 'scope'], 'status.index': [],
  'initiative.list': ['initiativeId'], 'initiative.history': ['initiativeId'],
  'portfolio.board': [], 'portfolio.list': [], 'portfolio.rail': ['since'], 'graph.get': ['initiativeId'], 'graph.focus': ['nodeId'],
  'initiative.get': ['id'], 'node.get': ['id'], 'history.list': ['target', 'actor', 'since'], 'inspector.get': ['target'],
};
export function validateQuery(name: QueryName, args: unknown) {
  const value = object(args);
  if (!Object.hasOwn(QUERY_FIELDS, name) || Object.keys(value).some(key => !QUERY_FIELDS[name].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Unknown query or query argument');
  if (name === 'inspector.get' && !value.target) throw new DomainFault('VALIDATION_FAILED', 'An inspector target is required');
  if (name === 'inspector.get' && Object.keys(object(value.target)).some(key => !['kind', 'id'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Invalid inspector target');
  if (name === 'search' && typeof value.text !== 'string') throw new DomainFault('VALIDATION_FAILED', 'Search text is required');
  for (const key of ['id', 'nodeId', 'initiativeId', 'since']) if (value[key] !== undefined) text(value[key]);
  if (['questions.list', 'questions.review'].includes(name) && value.state !== undefined && !['open', 'deferred', 'resolved', 'obsolete'].includes(String(value.state))) throw new DomainFault('VALIDATION_FAILED', 'Invalid question state');
  if (value.actor !== undefined && !['user', 'ai', 'connector', 'mcp', 'system'].includes(String(value.actor))) throw new DomainFault('VALIDATION_FAILED', 'Invalid history actor');
  if (name === 'questions.review' && value.target !== undefined && Object.keys(object(value.target)).some(key => !['kind', 'id'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Invalid question target');
  if (value.target !== undefined) {
    const target = object(value.target);
    if (!['initiative', 'node', 'edge'].includes(String(target.kind)) || Object.keys(target).some(key => !['kind', 'id', 'field'].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Invalid history target');
    text(target.id); if (target.field !== undefined) text(target.field);
  }
}
export function queryProjection<Q extends QueryName>(replay: Replay, name: Q, args: QueryArgs[Q], now: () => string): QueryResults[Q] {
  validateQuery(name, args);
  const value = args as Record<string, unknown>; const state = replay.document.state as WorkspaceState;
  let result: QueryResults[QueryName];
  switch (name) {
    case 'evidence.list': result = projectEvidence(state, args as EvidenceScope); break;
    case 'questions.review': result = projectQuestionReview(state, args as QuestionReviewScope); break;
    case 'questions.list': result = state.questions.filter(question => (!value.initiativeId || question.initiativeId === value.initiativeId) && (!value.state || question.state === value.state)); break;
    case 'portfolio.board': result = projectBoard(state, projectHistory(replay), { now: now() }); break;
    case 'portfolio.list': result = projectPortfolio(state); break;
    case 'portfolio.rail': result = projectRail(state, projectHistory(replay), { now: now(), ...(value.since === undefined ? {} : { since: text(value.since) }) }); break;
    case 'initiative.list': result = projectInitiativeList(state,text(value.initiativeId)); break;
    case 'initiative.history': result = projectInitiativeHistory(replay,text(value.initiativeId)); break;
    case 'graph.get': result = projectGraph(state, text(value.initiativeId)); break;
    case 'graph.focus': result = projectFocus(state, text(value.nodeId)); break;
    case 'history.list': result = projectHistory(replay, args as HistoryFilter); break;
    case 'initiative.get': result = requireRecord(state.initiatives, text(value.id)); break;
    case 'inspector.get': result = projectInspection(state, (args as QueryArgs['inspector.get']).target); break;
    case 'node.get': result = requireRecord(state.nodes, text(value.id)); break;
    default: throw new DomainFault('VALIDATION_FAILED', 'Unknown query');
  }
  return clone(result) as QueryResults[Q];
}
function requireRecord<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find(record => record.id === id);
  if (!record) throw new DomainFault('NOT_FOUND', 'Record not found');
  return record;
}
