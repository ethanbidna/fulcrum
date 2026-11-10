import type { WorkspaceState, Node } from './types.js';
import { projectGraph } from './graph-projections.js';
export interface TimelineItem { id: string; kind: 'initiative' | Node['type']; title: string; date: string; state: string; href: string }
export interface TimelineView { initiativeId: string; items: TimelineItem[]; prerequisites: { fromTitle: string; toTitle: string; href: string }[] }
export function projectTimeline(state: WorkspaceState, initiativeId: string): TimelineView {
  const graph = projectGraph(state, initiativeId);
  const initiative = state.initiatives.find(item => item.id === initiativeId)!;
  const items: TimelineItem[] = graph.nodes.flatMap(node => node.targetDate ? [{ id: node.id, kind: node.type, title: node.title, date: node.targetDate, state: node.state, href: `#initiatives/${initiativeId}/inspect/node/${node.id}` }] : []);
  if (initiative.targetDate) items.push({id: initiative.id, kind: 'initiative', title: initiative.title, date: initiative.targetDate, state: initiative.lifecycle, href: `#initiatives/${initiative.id}`});
  items.sort((a,b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const dated = new Set(items.map(item => item.id));
  const prerequisites = graph.edges.filter(edge => edge.type === 'depends_on' && dated.has(edge.fromId)).map(edge => {
    const from = state.nodes.find(node => node.id === edge.fromId)!;
    const to = state.nodes.find(node => node.id === edge.toId)!;
    return { fromTitle: from.title, toTitle: to.title, href: `#initiatives/${to.initiativeId}/inspect/node/${to.id}` };
  });
  return { initiativeId, items, prerequisites };
}
