// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
import { useInitiative } from './use-initiative.js';
afterEach(cleanup);
test('reference home navigation can read a paused initiative omitted from active portfolio cards', async () => {
  const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
  const record = state.initiatives[0]!; record.lifecycle = 'paused';
  const board = projectBoard(state, [], { now: '2026-11-08T20:00:00Z' }); const query = vi.fn().mockResolvedValue(record);
  const hook = renderHook(() => useInitiative(record.id, board, query));
  await waitFor(() => expect(hook.result.current.initiative?.id).toBe(record.id));
  expect(query).toHaveBeenCalledWith('initiative.get', { id: record.id }); expect(hook.result.current.loading).toBe(false);
});
test('missing home records leave an unavailable route without stale content', async () => {
  const board = projectBoard(JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state, [], { now: '2026-11-08T20:00:00Z' });
  const query = vi.fn().mockRejectedValue(new Error('Missing record')); const hook = renderHook(() => useInitiative('missing', board, query));
  await waitFor(() => expect(hook.result.current.loading).toBe(false)); expect(hook.result.current.initiative).toBeUndefined();
});
test('the portfolio route has no initiative lookup and remains renderable', () => {
  const query = vi.fn(); const hook = renderHook(() => useInitiative(undefined, undefined, query));
  expect(hook.result.current).toEqual({ initiative: undefined, loading: false }); expect(query).not.toHaveBeenCalled();
});
test('refreshing an inactive home keeps its acknowledged record visible while the next read is pending', async () => {
  const state = JSON.parse(readFileSync('fixtures/states/portfolio.state.json', 'utf8')).state as WorkspaceState;
  const record = state.initiatives[0]!; record.lifecycle = 'paused'; const board = projectBoard(state, [], { now: '2026-11-08T20:00:00Z' });
  const query = vi.fn().mockResolvedValueOnce(record).mockImplementationOnce(() => new Promise(() => {}));
  const hook = renderHook(({ board }) => useInitiative(record.id, board, query), { initialProps: { board } });
  await waitFor(() => expect(hook.result.current.initiative).toEqual(record));
  hook.rerender({ board: { ...board } });
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  expect(hook.result.current.initiative).toEqual(record);
});
