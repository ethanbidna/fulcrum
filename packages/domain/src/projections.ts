import type { FlowEdge, Initiative } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import { buildGraph, deriveCardState, isSatisfied, isOnLivePath, nextAvailableActions } from './card-state.js';
import type { DerivedCardState, Graph } from './card-state.js';
import type { HistoryEntry, HistoryChange } from './history-projections.js';
import { timestamp } from './history-projections.js';

export interface PortfolioCard { initiative: Initiative; cardState: DerivedCardState }
export interface WaitingItem { node: Node; initiativeIds: string[] }
export interface RailOptions { now: string; since?: string }
export interface PortfolioRail {
  nextAvailableActions: { initiativeId: string; node: Node }[];
  waitingOn: WaitingItem[];
  meaningfulChanges: (HistoryEntry & { context: string })[];
  questionCount: number;
}
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_CHANGE_LIMIT = 20;
const UNRESOLVED_DEPENDENCY_STATES = new Set(['waiting', 'unverified', 'blocked', 'expired']);
const MEANINGFUL_FIELDS = new Set(['state', 'lifecycle', 'moscow', 'targetDate', 'outcome', 'condition', 'fromId', 'toId', 'type', 'prerequisiteGroupId', 'prerequisiteGroups', 'supersededBy', 'objectiveLinks']);
const MEANINGFUL_RECORDS = new Set(['initiative', 'node', 'edge', 'question', 'objective']);
export function projectPortfolio(state: WorkspaceState): PortfolioCard[] {
  return state.initiatives.filter(initiative => initiative.lifecycle === 'active')
    .map(initiative => ({ initiative, cardState: deriveCardState(state, initiative.id) }));
}
function waitingOn(state: WorkspaceState): WaitingItem[] {
  const waiting = new Map<string, WaitingItem>();
  for (const initiative of state.initiatives.filter(initiative => initiative.lifecycle === 'active')) {
    const graph = buildGraph(state, initiative.id);
    for (const edge of graph.edges.filter(edge => edge.type === 'depends_on')) {
      const dependent = graph.nodes.get(edge.fromId)!; const prerequisite = graph.allNodes.get(edge.toId)!;
      if (alternativeSatisfied(dependent, edge, graph)) continue;
      if (isSatisfied(dependent) || !isOnLivePath(dependent, graph) || isSatisfied(prerequisite)
        || prerequisite.type !== 'dependency' || !UNRESOLVED_DEPENDENCY_STATES.has(prerequisite.state)) continue;
      const entry = waiting.get(prerequisite.id) ?? { node: prerequisite, initiativeIds: [] };
      if (!entry.initiativeIds.includes(initiative.id)) entry.initiativeIds.push(initiative.id);
      waiting.set(prerequisite.id, entry);
    }
  }
  return [...waiting.values()];
}
function alternativeSatisfied(node: Node, edge: FlowEdge, graph: Graph): boolean {
  const group = node.prerequisiteGroups?.find(group => group.id === edge.prerequisiteGroupId);
  if (!group || group.mode !== 'any') return false;
  return graph.edges.some(alternative => alternative.type === 'depends_on' && alternative.fromId === node.id
    && alternative.prerequisiteGroupId === group.id && isSatisfied(graph.allNodes.get(alternative.toId)!));
}
function isMeaningful(entry: HistoryEntry): boolean {
  return entry.changes.some(change => MEANINGFUL_RECORDS.has(change.kind) && (change.operation !== 'set' || MEANINGFUL_FIELDS.has(change.field!)));
}
export function projectRail(state: WorkspaceState, history: HistoryEntry[], options: RailOptions): PortfolioRail {
  const now = timestamp(options.now); const since = options.since === undefined ? now - RECENT_WINDOW_MS : timestamp(options.since);
  return {
    nextAvailableActions: nextAvailableActions(state).map(action => ({ initiativeId: action.initiativeId, node: state.nodes.find(node => node.id === action.nodeId)! })),
    waitingOn: waitingOn(state),
    meaningfulChanges: history.filter(entry => timestamp(entry.at) >= since && timestamp(entry.at) <= now && isMeaningful(entry)).slice(0, RECENT_CHANGE_LIMIT).map(entry => ({ ...entry, context: historyContext(state, entry.changes.find(change => MEANINGFUL_RECORDS.has(change.kind) && (change.operation !== 'set' || MEANINGFUL_FIELDS.has(change.field!)))) })),
    questionCount: state.questions.filter(question => question.state === 'open').length,
  };
}

export interface PortfolioBoard {
  cards: PortfolioCard[];
  categories: WorkspaceState['categories'];
  teams: WorkspaceState['entities'];
  objectives: WorkspaceState['objectives'];
  questionCounts: Record<string, number>;
  rail: PortfolioRail;
}
export function projectBoard(state: WorkspaceState, history: HistoryEntry[], options: RailOptions): PortfolioBoard {
  const questionCounts: Record<string, number> = {};
  for (const question of state.questions) {
    if (question.state === 'open') questionCounts[question.initiativeId] = (questionCounts[question.initiativeId] ?? 0) + 1;
  }
  return { cards: projectPortfolio(state), categories: state.categories,
    teams: state.entities.filter(entity => entity.type === 'team'), objectives: state.objectives,
    questionCounts, rail: projectRail(state, history, options) };
}

function historyContext(state: WorkspaceState, change: HistoryChange | undefined): string {
  if (!change) return 'Workspace';
  const current = [...state.initiatives, ...state.nodes, ...state.edges, ...state.questions, ...state.objectives].find(record => record.id === change.id);
  const record = current ?? (change.operation === 'tombstone' ? change.before : change.after);
  if (!record || typeof record !== 'object') return 'Workspace item';
  for (const field of ['title', 'prompt', 'label'] as const) {
    const value = (record as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  if ('fromId' in record && 'toId' in record && 'type' in record) {
    const from = state.nodes.find(node => node.id === record.fromId); const to = state.nodes.find(node => node.id === record.toId);
    const relationships: Record<string, string> = { depends_on: 'depends on', contains: 'contains', leads_to: 'leads to', related_to: 'relates to' };
    if (from && to && typeof record.type === 'string') return `${from.title} ${relationships[record.type] ?? 'links to'} ${to.title}`;
  }
  if ('initiativeId' in record) return state.initiatives.find(item => item.id === record.initiativeId)?.title ?? 'Initiative relationship';
  return 'Workspace item';
}
