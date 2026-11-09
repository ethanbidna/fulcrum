// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectGraph } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import { AddObject, ConnectObjects } from './flow-forms.js';
const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
afterEach(cleanup);
test('add a Task is an explicit command without an owner; rejection preserves input', async () => {
  const execute = vi.fn().mockResolvedValue({ ok: false, error: { message: 'Synthetic invariant rejection' } });
  const close = vi.fn(); render(<AddObject initiativeId={state.initiatives[0]!.id} execute={execute} close={close} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic user action' } }); fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toBe('Synthetic invariant rejection');
  expect(execute.mock.calls[0]![0]).toMatchObject({ name: 'node.create', args: { record: { type: 'task', state: 'open', title: 'Synthetic user action' } } });
  expect(execute.mock.calls[0]![0].args.record).not.toHaveProperty('owner'); expect(close).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Synthetic user action');
});
test('decision options are entered by the user before the acknowledged add closes', async () => {
  const execute = vi.fn().mockResolvedValue({ ok: true }); const close = vi.fn();
  render(<AddObject initiativeId={state.initiatives[0]!.id} execute={execute} close={close} />);
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'decision' } }); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic route' } });
  fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Build' } }); fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Buy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add node' })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(execute.mock.calls[0]![0].args.record.options).toEqual([{ id: 'option-1', label: 'Build' }, { id: 'option-2', label: 'Buy' }]);
});
test('keyboard connection picker exposes relationship direction and exact domain errors', async () => {
  const graph = projectGraph(state, state.initiatives[0]!.id); const source = graph.nodes[0]!; const target = graph.nodes[1]!;
  const execute = vi.fn().mockResolvedValue({ ok: false, error: { message: 'contains edges may only connect two Tasks' } });
  render(<ConnectObjects graph={graph} connection={{ source: source.id, target: target.id }} execute={execute} close={vi.fn()} />);
  expect(screen.getByText(`${target.title} depends on ${source.title}.`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'contains' } }); fireEvent.click(screen.getByRole('button', { name: 'Create relationship' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toBe('contains edges may only connect two Tasks');
  expect(execute.mock.calls[0]![0]).toMatchObject({ name: 'edge.create', args: { record: { fromId: source.id, toId: target.id, type: 'contains' } } });
});
