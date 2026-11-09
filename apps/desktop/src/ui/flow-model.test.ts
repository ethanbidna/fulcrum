import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectGraph } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import { canvasEdges, connectionRecord, layoutGraph, refreshObjects, initialViewport, newObject, NODE_HEIGHT, NODE_WIDTH } from './flow-model.js';
const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
const graph = () => projectGraph(structuredClone(state), state.initiatives[0]!.id);
test('rendered prerequisite direction round-trips to canonical sentence direction', () => {
  const value = graph(); const edge = value.edges.find(edge => edge.type === 'depends_on')!;
  const rendered = canvasEdges(value).find(item => item.id === edge.id)!;
  expect(rendered.source).toBe(edge.toId); expect(rendered.target).toBe(edge.fromId);
  expect(connectionRecord(value, rendered, 'depends_on', edge.id)).toMatchObject({ fromId: edge.fromId, toId: edge.toId, initiativeId: edge.initiativeId });
});
test('conditional routes show actual decision option labels; inferred edges stay dashed', () => {
  const value = graph(); const edge = value.edges.find(edge => edge.condition)!;
  edge.certainty = 'inferred';
  const rendered = canvasEdges(value).find(item => item.id === edge.id)!;
  const decision = value.nodes.find(node => node.id === edge.fromId)!;
  if (decision.type !== 'decision') throw new Error('Expected decision');
  expect(rendered.label).toContain(decision.options.find(option => option.id === edge.condition!.optionId)!.label);
  expect(rendered.className).toContain('inferred');
});
test('ELK lays out the same canonical objects and presentation frames without an initiative node', async () => {
  const value = graph(); const before = structuredClone(value); const result = await layoutGraph(value);
  expect(result.some(node => node.id === value.initiativeId)).toBe(false);
  expect(result.filter(node => node.type === 'object').map(node => node.id).sort()).toEqual([...value.nodes, ...value.references].map(node => node.id).sort());
  expect(result.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  for (const frame of result.filter(node => node.type === 'frame')) for (const record of value.nodes.filter(node => node.groupId === frame.id)) {
    const child = result.find(node => node.id === record.id)!;
    expect(child.position.x).toBeGreaterThan(frame.position.x);
    expect(child.position.y).toBeGreaterThan(frame.position.y);
    expect(child.position.x + NODE_WIDTH).toBeLessThanOrEqual(frame.position.x + Number(frame.style!.width));
    expect(child.position.y + NODE_HEIGHT).toBeLessThanOrEqual(frame.position.y + Number(frame.style!.height));
  }
  expect(value).toEqual(before);
});
test('shared prerequisites are references and cannot own edits from another initiative', () => {
  const value = graph(); const external = state.nodes.find(node => node.initiativeId !== value.initiativeId)!;
  value.references.push(external);
  expect(() => connectionRecord(value, { source: external.id, target: value.nodes[0]!.id }, 'leads_to', 'synthetic')).toThrow('shared reference');
  expect(connectionRecord(value, { source: external.id, target: value.nodes[0]!.id }, 'depends_on', 'synthetic').toId).toBe(external.id);
});
test('new objects use primitive-specific initial states and explicit decision choices', () => {
  expect(newObject('initiative', 'task', ' My action ', 'node', [])).toEqual({ id: 'node', initiativeId: 'initiative', type: 'task', title: 'My action', state: 'open' });
  expect(newObject('initiative', 'dependency', 'Access', 'node', []).state).toBe('unverified');
  expect(newObject('initiative', 'milestone', 'Ready', 'node', []).state).toBe('pending');
  expect(() => newObject('initiative', 'decision', 'Choose', 'node', ['', ''])).toThrow('two different');
  expect(newObject('initiative', 'decision', 'Choose', 'node', ['A', 'B'])).toMatchObject({ decider: 'user', options: [{ id: 'option-1', label: 'A' }, { id: 'option-2', label: 'B' }] });
});

test('acknowledged title refresh preserves dragged positions and updates accessible names', async () => {
  const value = graph(); const nodes = await layoutGraph(value); const record = value.nodes[0]!;
  const moved = nodes.find(node => node.id === record.id)!; moved.position = { x: 71, y: 83 };
  record.title = 'Synthetic acknowledged title';
  const updated = refreshObjects(nodes, value).find(node => node.id === record.id)!;
  expect(updated.position).toEqual({ x: 71, y: 83 }); expect(updated.ariaLabel).toContain(record.title);
  expect(updated.data).toMatchObject({ record }); expect(moved.ariaLabel).not.toContain(record.title);
});

test('initial view keeps node text at authored size and starts at the first work row', () => {
  const nodes = [{ id: 'first', type: 'object', position: { x: 300, y: 40 }, data: { label: '' } }, { id: 'later', type: 'object', position: { x: 0, y: 600 }, data: { label: '' } }];
  expect(initialViewport(nodes)).toEqual({ x: -276, y: -16, zoom: 1 });
  expect(initialViewport([])).toEqual({ x: 24, y: 24, zoom: 1 });
});
