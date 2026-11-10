import type { Replay } from './replay.js';
import type { QueryName, QueryArgs, QueryResults } from './queries.js';
import { queryProjection, validateQuery } from './queries.js';
import { clone, DomainFault } from './commands.js';
import type { WorkspaceState } from './types.js';
export interface McpReadScope { initiativeIds?: string[]; categoryIds?: string[]; questionsVisible?: boolean }
export function mcpInitiativeIds(state: WorkspaceState, scope: McpReadScope): string[] {
  return state.initiatives.filter(item => (!scope.initiativeIds || scope.initiativeIds.includes(item.id)) && (!scope.categoryIds || item.categoryIds.some(id => scope.categoryIds!.includes(id)))).map(item => item.id);
}
export function projectMcpQuery<Q extends QueryName>(replay: Replay, name: Q, args: QueryArgs[Q], scope: McpReadScope, now: () => string): unknown {
  validateQuery(name, args);
  const state = replay.document.state as WorkspaceState;
  const allowed = new Set(mcpInitiativeIds(state, scope));
  const restricted = Boolean(scope.initiativeIds || scope.categoryIds);
  const visible = new Set([...allowed, ...state.nodes.filter(item => allowed.has(item.initiativeId)).map(item => item.id), ...state.edges.filter(item => allowed.has(item.initiativeId)).map(item => item.id)]);
  const excluded = new Set([...state.initiatives, ...state.nodes, ...state.edges, ...state.questions].filter(item => !visible.has(item.id)).map(item => item.id));
  for (const question of state.questions) if (allowed.has(question.initiativeId) && scope.questionsVisible !== false) excluded.delete(question.id);
  const denied = () => { throw new DomainFault('POLICY_DENIED', 'MCP query exceeds sharing scope'); };
  if (scope.questionsVisible === false && name.startsWith('questions.')) denied();
  if (restricted && ['portfolio.board','portfolio.rail','priorities.list'].includes(name)) denied();
  if (restricted && containsExcluded(args, excluded)) denied();
  let result: unknown = queryProjection(replay, name, args, now);
  if (name === 'portfolio.list') result = (result as QueryResults['portfolio.list']).filter(row => allowed.has(row.initiative.id)).map(row => ({...row, cardState: containsExcluded(row.cardState, excluded) ? {kind:'unclear'} : row.cardState}));
  if (restricted && name === 'objectives.list') { const linked=new Set(state.initiatives.filter(item=>allowed.has(item.id)).flatMap(item=>item.objectiveLinks??[]).map(link=>link.objectiveId));result=(result as QueryResults['objectives.list']).filter(item=>linked.has(item.id)); }
  if (name === 'questions.list' || name === 'questions.review') result = (result as {initiativeId?: string; question?: {initiativeId:string}}[]).filter(row => allowed.has(row.initiativeId ?? row.question?.initiativeId ?? ''));
  if (name === 'history.list') result = (result as QueryResults['history.list']).filter(entry => !restricted || entry.changes.length > 0 && entry.changes.every(change => visible.has(change.id)) && !containsExcluded(entry.changes, excluded)).map(entry => ({eventId:entry.eventId,actor:entry.actor,at:entry.at,changes:entry.changes.filter(change => ['initiative','node','edge','group','category','objective',...(scope.questionsVisible === false?[]:['question'])].includes(change.kind))}));
  if (restricted && containsExcluded(result, excluded)) denied();
  return clone(hideQuestions(result, scope.questionsVisible !== false));
}
function containsExcluded(value: unknown, excluded: Set<string>): boolean {
  if (typeof value === 'string') return excluded.has(value);
  if (Array.isArray(value)) return value.some(item => containsExcluded(item, excluded));
  return Boolean(value && typeof value === 'object' && Object.values(value).some(item => containsExcluded(item, excluded)));
}
function hideQuestions(value: unknown, visible: boolean): unknown {
  if (visible || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => hideQuestions(item, visible));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['questions','questionCounts','questionCount','raisedQuestionIds'].includes(key)).map(([key,item]) => [key,hideQuestions(item, visible)]));
}
