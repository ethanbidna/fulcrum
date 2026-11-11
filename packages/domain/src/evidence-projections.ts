import type { Assertion, Source } from '@fulcrum/schema';
import type { WorkspaceState } from './types.js';
import type { InspectionTarget } from './inspector-projections.js';
import { DomainFault } from './commands.js';

export interface EvidenceTarget extends InspectionTarget { label: string }
export interface ContextEvidence {
  sourceId: string;
  source?: Source;
  sender?: string;
  targets: EvidenceTarget[];
  assertions: Assertion[];
}
export interface EvidenceScope { initiativeId: string; target?: InspectionTarget }
export function safeOriginal(permalink: string | undefined): string | undefined {
  try {
    const url = new URL(permalink ?? '');
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* A source can lack an original link. */ }
  return undefined;
}
export function projectEvidence(state: WorkspaceState, scope: EvidenceScope): ContextEvidence[] {
  const initiative = state.initiatives.find(item => item.id === scope.initiativeId);
  if (!initiative) throw new DomainFault('NOT_FOUND', 'Initiative not found');
  const records = [
    { kind: 'initiative' as const, id: initiative.id, label: initiative.title, refs: initiative.evidenceRefs ?? [] },
    ...state.nodes.filter(item => item.initiativeId === initiative.id).map(item => ({ kind: 'node' as const, id: item.id, label: item.title, refs: item.evidenceRefs ?? [] })),
    ...state.edges.filter(item => item.initiativeId === initiative.id).map(item => ({ kind: 'edge' as const, id: item.id, label: `${state.nodes.find(node => node.id === item.fromId)?.title ?? 'Unavailable item'} ${item.type.replaceAll('_', ' ')} ${state.nodes.find(node => node.id === item.toId)?.title ?? 'Unavailable item'}${item.label ? ` · ${item.label}` : ''}`, refs: item.evidenceRefs ?? [] })),
  ];
  const selected = records.filter(item => !scope.target || item.kind === scope.target.kind && item.id === scope.target.id);
  if (scope.target && !selected.length) throw new DomainFault('NOT_FOUND', 'Object does not belong to this initiative');
  const rows = new Map<string, ContextEvidence>();
  const attach = (sourceId: string, target: EvidenceTarget, assertion?: Assertion) => {
    let row = rows.get(sourceId);
    if (!row) {
      const original = state.sources.find(source => source.id === sourceId);
      let source: Source | undefined;
      if (original) {
        source = { ...original };
        delete source.permalink;
        if (original.cachePolicy !== 'excerpt') delete source.excerpt;
        const permalink = safeOriginal(original.permalink);
        if (permalink) source.permalink = permalink;
      }
      const sender = state.entities.find(item => item.id === source?.senderEntityId)?.label;
      row = { sourceId, ...(source ? { source } : {}), ...(sender ? { sender } : {}), targets: [], assertions: [] };
      rows.set(sourceId, row);
    }
    if (!row.targets.some(item => item.kind === target.kind && item.id === target.id)) row.targets.push(target);
    if (assertion && !row.assertions.some(item => item.id === assertion.id)) row.assertions.push(assertion);
  };
  for (const record of selected) {
    const target = { kind: record.kind, id: record.id, label: record.label };
    for (const ref of record.refs) attach(ref.sourceId, target);
    for (const assertion of state.assertions.filter(item => item.target.kind === record.kind && item.target.id === record.id)) {
      for (const ref of assertion.evidenceRefs) attach(ref.sourceId, target, assertion);
    }
  }
  return [...rows.values()].sort((a, b) => (b.source?.happenedAt ?? b.source?.ingestedAt ?? '').localeCompare(a.source?.happenedAt ?? a.source?.ingestedAt ?? '') || a.sourceId.localeCompare(b.sourceId));
}
