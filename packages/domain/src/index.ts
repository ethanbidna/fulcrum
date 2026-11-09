export type { Node, WorkspaceState } from './types.js';
export { checkInvariants } from './invariants.js';
export type { InvariantViolation } from './invariants.js';
export { checkAffectedInvariants } from './affected.js';
export { checkPolicy, PolicyRule } from './policy.js';
export type { FieldWrite, PolicyIntent, PolicyContext, PolicyResult, PolicyRuleId } from './policy.js';
export { CardState, buildGraph, deriveCardState, isSatisfied, prerequisitesMet, isReached, isSkipped, isOnLivePath, nextAvailableActions } from './card-state.js';
export type { Graph, DerivedCardState } from './card-state.js';
export { Domain } from './domain.js';
export { COMMAND_ARGUMENTS, suggestionSignature } from './commands.js';
export type { CommandName, CommandEnvelope, CommandResult, DomainError, DomainPorts, EventDraft, AppliedChange } from './commands.js';
export { replayEvents } from './replay.js';

export { projectGraph, projectFocus } from './graph-projections.js';
export type { GraphView } from './graph-projections.js';
export { projectHistory } from './history-projections.js';
export type { HistoryEntry, HistoryChange, HistoryFilter } from './history-projections.js';
export { projectPortfolio, projectRail, projectBoard } from './projections.js';
export type { PortfolioBoard, PortfolioCard, PortfolioRail, RailOptions, WaitingItem } from './projections.js';
export type { QueryName, QueryArgs, QueryResults } from './queries.js';
export type { SearchScope, SearchHit, IndexProgress } from '@fulcrum/index/interfaces';

export { projectInspection } from './inspector-projections.js';
export type { Inspection, InspectionTarget } from './inspector-projections.js';

export type { CommandRequest, CommandPlan, CommandChange } from './command-plans.js';

export { MAX_COMMAND_PROMPT_LENGTH } from './command-plans.js';

export { projectInitiativeList, projectInitiativeHistory } from './detail-projections.js';
export type { InitiativeListRow, InitiativeHistoryEntry, EvidenceLink, DescribedChange } from './detail-projections.js';
