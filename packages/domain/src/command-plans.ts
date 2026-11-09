import type { InspectionTarget } from './inspector-projections.js';
import type { HistoryChange } from './history-projections.js';
export const MAX_COMMAND_PROMPT_LENGTH = 2000;
export interface CommandRequest { prompt: string; initiativeId?: string; target?: InspectionTarget }
export interface CommandChange extends HistoryChange { label: string; beforeText: string; afterText: string }
export interface CommandPlan { id: string; prompt: string; changes: CommandChange[]; expiresAt: string }
