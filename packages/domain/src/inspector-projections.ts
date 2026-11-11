import type { FlowEdge, Initiative } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import { deriveCardState } from './card-state.js';
import type { DerivedCardState } from './card-state.js';
import { DomainFault } from './commands.js';
export interface InspectionTarget { kind: 'initiative' | 'node' | 'edge'; id: string }
interface InspectionContext {
  evidenceCount: number;
  cardState?: DerivedCardState;
  relationship?: { fromTitle: string; toTitle: string; conditionLabel?: string };
  questions: { id: string; prompt: string; state: string }[];
  children: Node[];
  attribution: { responsible?: string; decider?: string };
}
export type Inspection = InspectionContext & (
  | { kind: 'initiative'; record: Initiative }
  | { kind: 'node'; record: Node }
  | { kind: 'edge'; record: FlowEdge }
);
export function projectInspection(state: WorkspaceState, target: InspectionTarget): Inspection {
  const context = (record: Initiative | Node | FlowEdge): InspectionContext => ({
    evidenceCount: new Set((record.evidenceRefs ?? []).map(ref => ref.sourceId)).size,
    questions: state.questions.filter(question => question.target.kind === target.kind && question.target.id === target.id && question.state === 'open').map(({ id, prompt, state }) => ({ id, prompt, state })),
    children: target.kind === 'node' ? state.nodes.filter(node => state.edges.some(edge => edge.type === 'contains' && edge.fromId === target.id && edge.toId === node.id)) : [],
    attribution: target.kind === 'node' ? attribution(state, record as Node) : {},
  });
  if (target.kind === 'node') { const record = requireRecord(state.nodes, target.id); return { ...context(record), kind: 'node', record }; }
  if (target.kind === 'edge') { const record = requireRecord(state.edges, target.id);
    const from = state.nodes.find(node => node.id === record.fromId)!; const to = state.nodes.find(node => node.id === record.toId)!;
    const route = from.type === 'decision' && record.condition ? from.options.find(option => option.id === record.condition!.optionId)?.label : undefined;
    return { ...context(record), kind: 'edge', record, relationship: { fromTitle: from.title, toTitle: to.title, ...(route ? { conditionLabel: route } : {}) } }; }
  const record = requireRecord(state.initiatives, target.id); return { ...context(record), kind: 'initiative', record, cardState: deriveCardState(state, record.id) };
}
function attribution(state: WorkspaceState, node: Node) {
  const label = (id: unknown) => typeof id === 'string' ? state.entities.find(entity => entity.id === id)?.label : undefined;
  const responsible = label(node.responsibleEntityId); const decider = node.type === 'decision' ? node.decider === 'user' ? 'You' : label(node.decider) : undefined;
  return { ...(responsible ? { responsible } : {}), ...(decider ? { decider } : {}) };
}
function requireRecord<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find(record => record.id === id); if (!record) throw new DomainFault('NOT_FOUND', 'The selected object no longer exists.'); return record;
}
