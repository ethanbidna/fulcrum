import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { ConditionalEdge } from './conditional-edge.js';
test('conditional edge passes only supported SVG attributes to the base path', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    renderToStaticMarkup(<ReactFlowProvider><svg><ConditionalEdge id="synthetic-edge" source="source" target="target" selected={false} sourceX={0} sourceY={0} targetX={100} targetY={150} sourcePosition={Position.Bottom} targetPosition={Position.Top} sourceHandleId="source-handle" targetHandleId="target-handle" label="Synthetic route" /></svg></ReactFlowProvider>);
    expect(errors.mock.calls).toEqual([]);
  } finally { errors.mockRestore(); }
});
