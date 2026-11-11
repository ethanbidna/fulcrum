import type { FlowEdge, Group } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import { DomainFault } from './commands.js';

export interface GraphView {
  initiativeId: string;
  nodes: Node[];
  references: Node[];
  edges: FlowEdge[];
  groups: Group[];
}
function requireNode(state: WorkspaceState, id: string): Node {
  const node = state.nodes.find(node => node.id === id);
  if (!node) throw new DomainFault('NOT_FOUND', 'Node not found');
  return node;
}
function view(state: WorkspaceState, initiativeId: string, members: Set<string>, edges: FlowEdge[]): GraphView {
  const referenceIds = new Set(edges.flatMap(edge => [edge.fromId, edge.toId]).filter(id => !members.has(id)));
  const nodes = state.nodes.filter(node => members.has(node.id));
  const groupIds = new Set(nodes.map(node => node.groupId));
  return { initiativeId, nodes, references: state.nodes.filter(node => referenceIds.has(node.id)), edges,
    groups: state.groups.filter(group => groupIds.has(group.id)) };
}
export function projectGraph(state: WorkspaceState, initiativeId: string): GraphView {
  if (!state.initiatives.some(initiative => initiative.id === initiativeId)) throw new DomainFault('NOT_FOUND', 'Initiative not found');
  const members = new Set(state.nodes.filter(node => node.initiativeId === initiativeId).map(node => node.id));
  return view(state, initiativeId, members, state.edges.filter(edge => members.has(edge.fromId)));
}
export function projectFocus(state: WorkspaceState, nodeId: string): GraphView {
  const root = requireNode(state, nodeId);
  const members = new Set([root.id]); const pending = [root.id];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const edge of state.edges.filter(edge => edge.type === 'contains' && edge.fromId === parent)) {
      if (members.has(edge.toId)) continue;
      members.add(edge.toId); pending.push(edge.toId);
    }
  }
  const edges = state.edges.filter(edge => members.has(edge.fromId) && (members.has(edge.toId) || edge.type === 'depends_on'));
  return view(state, root.initiativeId, members, edges);
}
