// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard, projectGraph } from '@fulcrum/domain';
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
  const query = vi.fn().mockResolvedValue(projectGraph(state, initiative.id));
  render(<FlowCanvas initiative={initiative} board={projectBoard(state, [], { now: '2026-11-08T20:00:00Z' })} query={query} execute={execute} undo={vi.fn()} canUndo={false} />);
  await screen.findByRole('button', { name: 'Select first node' });
  fireEvent.click(screen.getByRole('button', { name: 'Select first node' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete selected node' }));
  expect(execute).toHaveBeenCalledWith({ name: 'node.delete', args: { id: state.nodes[0]!.id } });
});
