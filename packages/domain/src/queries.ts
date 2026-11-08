import type { SearchScope, SearchHit, IndexProgress } from '@fulcrum/index/interfaces';
import type { Initiative } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import type { Replay } from './replay.js';
import { clone, DomainFault, object, text } from './commands.js';
import { projectFocus, projectGraph } from './graph-projections.js';
import type { GraphView } from './graph-projections.js';
import { projectHistory } from './history-projections.js';
import type { HistoryEntry, HistoryFilter } from './history-projections.js';
import { projectPortfolio, projectRail } from './projections.js';
import type { PortfolioCard, PortfolioRail } from './projections.js';

export interface QueryArgs {
  'search': { text: string; scope?: SearchScope };
  'status.index': Record<string, never>;
  'portfolio.list': Record<string, never>;
  'portfolio.rail': { since?: string };
  'graph.get': { initiativeId: string };
  'graph.focus': { nodeId: string };
  'initiative.get': { id: string };
  'node.get': { id: string };
  'history.list': HistoryFilter;
}
export interface QueryResults {
  'search': SearchHit[];
  'status.index': IndexProgress;
  'portfolio.list': PortfolioCard[];
  'portfolio.rail': PortfolioRail;
  'graph.get': GraphView;
  'graph.focus': GraphView;
  'initiative.get': Initiative;
  'node.get': Node;
  'history.list': HistoryEntry[];
}
export type QueryName = keyof QueryArgs;
const QUERY_FIELDS: Record<QueryName, string[]> = {
  'search': ['text', 'scope'], 'status.index': [],
  'portfolio.list': [], 'portfolio.rail': ['since'], 'graph.get': ['initiativeId'], 'graph.focus': ['nodeId'],
  'initiative.get': ['id'], 'node.get': ['id'], 'history.list': ['target', 'actor', 'since'],
};
export function validateQuery(name: QueryName, args: unknown) {
  const value = object(args);
  if (!Object.hasOwn(QUERY_FIELDS, name) || Object.keys(value).some(key => !QUERY_FIELDS[name].includes(key))) throw new DomainFault('VALIDATION_FAILED', 'Unknown query or query argument');
  if (name === 'search' && typeof value.text !== 'string') throw new DomainFault('VALIDATION_FAILED', 'Search text is required');
  for (const key of ['id', 'nodeId', 'initiativeId', 'since']) if (value[key] !== undefined) text(value[key]);
  if (value.actor !== undefined && !['user', 'ai', 'connector', 'mcp', 'system'].includes(String(value.actor))) throw new DomainFault('VALIDATION_FAILED', 'Invalid history actor');
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
    case 'portfolio.list': result = projectPortfolio(state); break;
    case 'portfolio.rail': result = projectRail(state, projectHistory(replay), { now: now(), ...(value.since === undefined ? {} : { since: text(value.since) }) }); break;
    case 'graph.get': result = projectGraph(state, text(value.initiativeId)); break;
    case 'graph.focus': result = projectFocus(state, text(value.nodeId)); break;
    case 'history.list': result = projectHistory(replay, args as HistoryFilter); break;
    case 'initiative.get': result = requireRecord(state.initiatives, text(value.id)); break;
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
