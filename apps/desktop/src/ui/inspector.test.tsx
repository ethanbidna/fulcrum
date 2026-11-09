// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard, projectInspection } from '@fulcrum/domain';
import type { InspectionTarget, WorkspaceState } from '@fulcrum/domain';
import { Inspector } from './inspector.js';
const fixture = () => JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
afterEach(cleanup);
function setup(target?: InspectionTarget) {
  const state = fixture(); const parent = state.edges.find(edge => edge.type === 'contains')!.fromId;
  const selected = target ?? { kind: 'node' as const, id: parent };
  const query = vi.fn().mockImplementation(async () => projectInspection(state, selected));
  const execute = vi.fn().mockResolvedValue({ ok: true }); const select = vi.fn(); const focus = vi.fn(); const close = vi.fn();
  const props = { target: selected, initiativeId: state.nodes.find(node => node.id === parent)!.initiativeId, board: projectBoard(state, [], { now: '2026-11-08T20:00:00Z' }), query, execute, select, focus, close };
  return { state, parent, props, query, execute, select, focus, close };
}
test('inspector exposes attributes, contextual counts, focus and collapsible child checklist', async () => {
  const f = setup(); render(<Inspector {...f.props} />); await screen.findByRole('form', { name: 'Node attributes' });
  expect(screen.getByText('Evidence sources')).toBeTruthy(); expect(screen.getByRole('region', { name: 'Contextual questions' })).toBeTruthy();
  const child = f.state.nodes.find(node => f.state.edges.some(edge => edge.type === 'contains' && edge.fromId === f.parent && edge.toId === node.id))!;
  fireEvent.click(screen.getByRole('checkbox', { name: `Complete ${child.title}` }));
  await waitFor(() => expect(f.execute).toHaveBeenCalledWith({ name: 'node.setState', args: { id: child.id, state: 'done' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Focus task' })); expect(f.focus).toHaveBeenCalledWith(f.parent);
  fireEvent.click(screen.getByRole('button', { name: child.title })); expect(f.select).toHaveBeenCalledWith(child.id);
  fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' })); expect(f.close).toHaveBeenCalledOnce();
});
test('attribute rejection shows exact domain message and preserves the draft', async () => {
  const f = setup(); f.execute.mockResolvedValue({ ok: false, error: { message: 'Synthetic protected edit' } }); render(<Inspector {...f.props} />);
  const input = await screen.findByLabelText('Title'); fireEvent.change(input, { target: { value: 'Synthetic focused title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save attributes' })); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Synthetic protected edit'); expect((input as HTMLInputElement).value).toBe('Synthetic focused title');
  expect(f.execute.mock.calls[0]![0]).toMatchObject({ name: 'node.update', args: { id: f.parent, patch: { title: 'Synthetic focused title' } } });
});
test('shared references remain inspectable with home navigation and no edit controls', async () => {
  const state = fixture(); const external = state.nodes.find(node => node.initiativeId !== state.initiatives[0]!.id)!;
  const f = setup({ kind: 'node', id: external.id }); render(<Inspector {...f.props} />);
  await screen.findByRole('link', { name: 'Open its home initiative' }); expect(screen.queryByRole('form', { name: 'Node attributes' })).toBeNull(); expect(f.execute).not.toHaveBeenCalled();
});
test('changing selection ignores an obsolete delayed inspection response', async () => {
  const f = setup(); let finish!: (value: ReturnType<typeof projectInspection>) => void;
  f.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<Inspector {...f.props} />); const next = f.state.nodes.find(node => node.id !== f.parent)!;
  const target = { kind: 'node' as const, id: next.id }; f.query.mockResolvedValue(projectInspection(f.state, target));
  view.rerender(<Inspector {...f.props} target={target} />); await screen.findByRole('heading', { name: next.title });
  finish(projectInspection(f.state, f.props.target)); await waitFor(() => expect(screen.getByRole('heading', { name: next.title })).toBeTruthy());
});

test('same-initiative prerequisite references stay read-only inside a focused view', async () => {
  const f = setup(); render(<Inspector {...f.props} readOnlyReference />);
  await screen.findByRole('link', { name: 'Open its home initiative' });
  expect(screen.queryByRole('form', { name: 'Node attributes' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Child Tasks' })).toBeNull();
  expect(f.execute).not.toHaveBeenCalled();
});
