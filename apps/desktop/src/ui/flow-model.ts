import type { GraphView, Node as FlowObject } from '@fulcrum/domain';
import type { FlowEdge } from '@fulcrum/schema';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ELK as LayoutEngine } from 'elkjs/lib/elk-api.js';
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 108;
const GROUP_PADDING = 32;
const NODE_SPACING = 40;
const LAYER_SPACING = 72;
export const objectLabels = { task: 'Task', dependency: 'Dependency', decision: 'Decision', milestone: 'Milestone' } as const;
export type ObjectType = keyof typeof objectLabels;
export type Relationship = FlowEdge['type'];
export const relationshipLabels: Record<Relationship, string> = { depends_on: 'Prerequisite → dependent', leads_to: 'Leads to', contains: 'Contains', related_to: 'Related to' };
export interface ObjectData extends Record<string, unknown> {
  record: FlowObject; reference: boolean; busy: boolean;
  rename?: (id: string, title: string) => Promise<boolean>;
}
export type CanvasNode = Node<ObjectData | { label: string }>;
export function endpoints(edge: FlowEdge) {
  return edge.type === 'depends_on' ? { source: edge.toId, target: edge.fromId } : { source: edge.fromId, target: edge.toId };
}
export function canvasEdges(graph: GraphView): Edge[] {
  return graph.edges.map(edge => {
    const decision = graph.nodes.find(node => node.id === edge.fromId && node.type === 'decision');
    const route = edge.condition && decision?.type === 'decision' && decision.options.find(option => option.id === edge.condition!.optionId)?.label;
    const label = route || [edge.type === 'depends_on' ? 'prerequisite' : edge.type.replaceAll('_', ' '), edge.label].filter(Boolean).join(' · ');
    return { id: edge.id, ...endpoints(edge), type: edge.condition ? 'conditional' : 'smoothstep', label, ariaLabel: label,
      className: `flow-edge edge-${edge.type}${edge.certainty === 'inferred' ? ' inferred' : ''}`,
      ...(edge.type === 'depends_on' || edge.type === 'leads_to' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}) };
  });
}
export function connectionRecord(graph: GraphView, connection: { source: string; target: string }, type: Relationship, id: string, optionId?: string) {
  const fromId = type === 'depends_on' ? connection.target : connection.source;
  const toId = type === 'depends_on' ? connection.source : connection.target;
  const from = graph.nodes.find(node => node.id === fromId);
  if (!from) throw new Error('A shared reference cannot own a relationship here. Open its home initiative to edit it.');
  return { id, initiativeId: from.initiativeId, fromId, toId, type,
    ...(type === 'leads_to' && optionId ? { condition: { optionId } } : {}) };
}
export function newObject(initiativeId: string, type: ObjectType, title: string, id: string, choices: string[]) {
  const record = { id, initiativeId, type, title: title.trim(), state: type === 'dependency' ? 'unverified' : type === 'milestone' ? 'pending' : 'open' };
  if (type !== 'decision') return record;
  if (choices.length !== 2 || choices.some(choice => !choice.trim()) || choices[0]!.trim() === choices[1]!.trim()) throw new Error('Enter two different decision options.');
  return { ...record, decider: 'user', options: choices.map((label, index) => ({ id: `option-${index + 1}`, label: label.trim() })) };
}
export async function layoutGraph(graph: GraphView): Promise<CanvasNode[]> {
  const all = [...graph.nodes, ...graph.references];
  const groups = graph.groups.filter(group => all.some(node => node.groupId === group.id));
  const groupedIds = new Set(groups.map(group => group.id));
  const leaf = (node: FlowObject): ElkNode => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT });
  const root: ElkNode = { id: graph.initiativeId, layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': String(NODE_SPACING), 'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING) },
    children: [...all.filter(node => !node.groupId || !groupedIds.has(node.groupId)).map(leaf), ...groups.map(group => ({ id: group.id, children: all.filter(node => node.groupId === group.id).map(leaf), layoutOptions: { 'elk.padding': `[top=${GROUP_PADDING + 12},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]` } }))],
    edges: graph.edges.map(edge => ({ id: edge.id, sources: [endpoints(edge).source], targets: [endpoints(edge).target] })) };
  // elkjs publishes CommonJS with ESM-shaped declarations.
  const Constructor = ELK as unknown as { new(): LayoutEngine };
  const engine = new Constructor();
  const result = await engine.layout(root); const nodes: CanvasNode[] = [];
    const visit = (item: ElkNode, parent = { x: 0, y: 0 }) => {
      const position = { x: parent.x + (item.x ?? 0), y: parent.y + (item.y ?? 0) };
      const record = all.find(node => node.id === item.id);
      if (record) nodes.push({ id: record.id, type: 'object', position, width: NODE_WIDTH, height: NODE_HEIGHT, data: { record, reference: graph.references.some(node => node.id === record.id), busy: false }, ariaLabel: `${objectLabels[record.type]}: ${record.title}` });
      else if (item.id !== graph.initiativeId) nodes.push({ id: item.id, type: 'frame', position, style: { width: item.width, height: item.height }, data: { label: groups.find(group => group.id === item.id)?.label ?? '' }, selectable: false, draggable: false, connectable: false, focusable: false, zIndex: -1 });
      item.children?.forEach(child => visit(child, position));
    };
    result.children?.forEach(child => visit(child));
    return nodes.sort((a, b) => Number(a.type !== 'frame') - Number(b.type !== 'frame'));

}

export function refreshObjects(nodes: CanvasNode[], graph: GraphView): CanvasNode[] {
  const records = new Map([...graph.nodes, ...graph.references].map(record => [record.id, record]));
  return nodes.map(node => {
    const record = records.get(node.id); if (!record) return node;
    return { ...node, data: { ...node.data, record }, ariaLabel: `${objectLabels[record.type]}: ${record.title}` };
  });
}
const INITIAL_CANVAS_PADDING = 24;
export function initialViewport(nodes: CanvasNode[]) {
  const objects = nodes.filter(node => node.type === 'object');
  const first = [...objects].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)[0];
  return { x: INITIAL_CANVAS_PADDING - (first?.position.x ?? 0), y: INITIAL_CANVAS_PADDING - (first?.position.y ?? 0), zoom: 1 };
}
export function selectCanvasNode(nodes: CanvasNode[], id: string): CanvasNode[] {
  if (nodes.every(node => node.type !== 'object' || Boolean(node.selected) === (node.id === id))) return nodes;
  return nodes.map(node => node.type === 'object' ? { ...node, selected: node.id === id } : node);
}
