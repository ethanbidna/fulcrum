import type { Actor, Objective } from '@fulcrum/schema';
import type { WorkspaceState } from './types.js';
import type { EvidenceLink } from './detail-projections.js';
import { safeOriginal } from './evidence-projections.js';
export interface PriorityLink { initiativeId: string; title: string; alignment: number; setBy: Actor; evidence: EvidenceLink[] }
export interface PriorityRow { objective: Objective; links: PriorityLink[] }
export function projectPriorities(state: WorkspaceState): PriorityRow[] {
  return [...state.objectives].sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label)||a.id.localeCompare(b.id)).map(objective=>({
    objective,
    links: state.initiatives.filter(item=>['active','paused','completed'].includes(item.lifecycle)).flatMap(initiative=>(initiative.objectiveLinks??[]).filter(link=>link.objectiveId===objective.id).map(link=>({
      initiativeId:initiative.id,title:initiative.title,alignment:link.alignment,setBy:link.setBy,
      evidence:(link.evidenceRefs??[]).map(ref=>{const source=state.sources.find(item=>item.id===ref.sourceId);const permalink=safeOriginal(source?.permalink);return {id:ref.sourceId,title:source?.title??'Evidence unavailable',...(permalink?{permalink}:{})};}),
    }))),
  }));
}
