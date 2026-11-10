// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard, projectGraph, projectQuestionReview } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    BaseEdge: () => null, EdgeLabelRenderer: ({ children }: { children: import('react').ReactNode }) => children, getSmoothStepPath: () => [''],
    MarkerType: { ArrowClosed: 'arrowclosed' },
    ReactFlowProvider: ({ children }: { children: import('react').ReactNode }) => children,
    Controls: () => null,
    applyNodeChanges: (_: unknown, nodes: unknown) => nodes,
    ReactFlow: ({ nodes, onSelectionChange }: { nodes: { id: string; type: string; data: unknown }[]; onSelectionChange: (value: { nodes: unknown[] }) => void }) => {
      const [selected, setSelected] = React.useState(false); const notifications = React.useRef(0);
      React.useEffect(() => { if (selected && ++notifications.current > 5) throw new Error('Selection notifications did not converge'); if (selected) onSelectionChange({ nodes: nodes.filter(node => node.type === 'object').slice(0, 1) }); }, [selected, onSelectionChange, nodes]);
      return nodes.some(node => node.type === 'object') ? <button onClick={() => setSelected(true)}>Select first node</button> : <span>Arranging graph</span>;
    },
  };
});
import { FlowCanvas } from './flow-canvas.js';
const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
afterEach(cleanup);
test('selection notifications converge without a render loop and delete only the selected canonical node', async () => {
  const initiative = state.initiatives[0]!; const execute = vi.fn().mockResolvedValue({ ok: true });
  const query = vi.fn().mockImplementation(async (name, args) => name === 'questions.review' ? projectQuestionReview(state, args) : name === 'inspector.get' ? (await import('@fulcrum/domain')).projectInspection(state, args.target) : projectGraph(state, initiative.id));
  render(<FlowCanvas initiative={initiative} board={projectBoard(state, [], { now: '2026-11-08T20:00:00Z' })} query={query} execute={execute} undo={vi.fn()} canUndo={false} />);
  await screen.findByRole('button', { name: 'Select first node' });
  fireEvent.click(screen.getByRole('button', { name: 'Select first node' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete selected node' }));
  expect(execute).toHaveBeenCalledWith({ name: 'node.delete', args: { id: state.nodes[0]!.id } });
});

test('focused canvas requests the filtered canonical graph and can navigate from its inspector', async () => {
  const { projectFocus, projectInspection } = await import('@fulcrum/domain');
  const initiative = state.initiatives[0]!; const root = state.edges.find(edge => edge.type === 'contains')!.fromId;
  const query = vi.fn().mockImplementation(async (name, args) => name === 'questions.review' ? projectQuestionReview(state, args) : name === 'inspector.get' ? projectInspection(state, args.target) : projectFocus(state, root));
  render(<FlowCanvas focusedNodeId={root} initiative={initiative} board={projectBoard(state, [], { now: '2026-11-08T20:00:00Z' })} query={query} execute={vi.fn()} undo={vi.fn()} canUndo={false} />);
  await screen.findByRole('button', { name: 'Focus task' });
  expect(query).toHaveBeenCalledWith('graph.focus', { nodeId: root });
  expect(screen.getByRole('navigation', { name: 'Focused view' }).querySelector('a')!.getAttribute('href')).toBe(`#initiatives/${initiative.id}`);
});

test('a collapsed inspector stays collapsed through acknowledged projection refreshes', async () => {
  const { projectInspection } = await import('@fulcrum/domain'); const initiative = state.initiatives[0]!;
  const query = vi.fn().mockImplementation(async (name, args) => name === 'questions.review' ? projectQuestionReview(state, args) : name === 'inspector.get' ? projectInspection(state, args.target) : projectGraph(state, initiative.id));
  const props = { initiative, board: projectBoard(state, [], { now: '2026-11-08T20:00:00Z' }), query, execute: vi.fn(), undo: vi.fn(), canUndo: false };
  const view = render(<FlowCanvas {...props} />); await screen.findByRole('button', { name: 'Select first node' });
  fireEvent.click(screen.getByRole('button', { name: 'Select first node' })); await screen.findByRole('form', { name: 'Node attributes' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Hide inspector' })[0]!);
  await act(async () => { view.rerender(<FlowCanvas {...props} board={{ ...props.board }} />); });
  expect(screen.getByRole('button', { name: 'Show inspector' })).toBeTruthy(); expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
});
test('a question context link opens the exact relationship inspector', async () => {
  const { projectInspection } = await import('@fulcrum/domain'); const initiative = state.initiatives[0]!;
  const edge = state.edges.find(edge => edge.initiativeId === initiative.id)!;
  const query = vi.fn().mockImplementation(async (name, args) => name === 'questions.review' ? projectQuestionReview(state, args) : name === 'inspector.get' ? projectInspection(state, args.target) : projectGraph(state, initiative.id));
  render(<FlowCanvas initialTarget={{ kind: 'edge', id: edge.id }} initiative={initiative} board={projectBoard(state, [], { now: '2026-11-09T18:00:00Z' })} query={query} execute={vi.fn()} undo={vi.fn()} canUndo={false} />);
  await screen.findByRole('button', { name: 'Save label' });
  expect(query).toHaveBeenCalledWith('inspector.get', { target: { kind: 'edge', id: edge.id } });
});
