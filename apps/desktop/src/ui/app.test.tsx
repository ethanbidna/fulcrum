// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './app.js';
import type { CoreTransport } from '../core-transport.js';
import { destinationFromHash, initiativeFromHash, focusedNodeFromHash } from './navigation.js';
afterEach(() => { cleanup(); window.location.hash = ''; vi.useRealTimers(); });
function emptyBoard(questionCount = 3) { return { cards: [], categories: [], teams: [], objectives: [], questionCounts: {}, rail: { questionCount, nextAvailableActions: [], waitingOn: [], meaningfulChanges: [] } }; }
function session() {
  let changed = () => {};
  const stop = vi.fn();
  const transport = { query: vi.fn(), execute: vi.fn(), subscribe: vi.fn(async listener => { changed = () => listener({}); return stop; }), close: vi.fn() };
  transport.query.mockResolvedValue(emptyBoard());
  const platform = { connectCore: vi.fn(async () => transport as CoreTransport) };
  return { transport, platform, stop, changed: () => changed() };
}
test('four destinations, live quiet question count and canonical reads only', async () => {
  const f = session(); render(<App platform={f.platform} />);
  await screen.findByText('Connected to local core');
  expect(Array.from(screen.getByRole('navigation').querySelectorAll('a')).map(link => link.textContent)).toEqual(['Initiatives', 'Priorities', 'Questions3', 'Settings']);
  expect(screen.getByLabelText('3 open questions').textContent).toBe('3');
  expect(f.transport.query).toHaveBeenCalledWith('portfolio.board', {});
  expect(f.transport.execute).not.toHaveBeenCalled();
});
test('navigation follows history, marks current location and focuses the heading', async () => {
  const f = session(); render(<App platform={f.platform} />); await screen.findByText('Connected to local core');
  act(() => { window.location.hash = '#priorities'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  expect(screen.getByRole('link', { name: 'Priorities' }).getAttribute('aria-current')).toBe('page');
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Priorities' }));
  expect(destinationFromHash('#untrusted-command')).toBe('initiatives');
});
test('connection failure offers retry without showing stale counts', async () => {
  const f = session(); f.platform.connectCore.mockRejectedValueOnce(new Error('synthetic failure'));
  render(<App platform={f.platform} />);
  await screen.findByText('Local core unavailable'); expect(screen.queryByLabelText('3 open questions')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /^Retry connection$/ })[0]!);
  await screen.findByText('Connected to local core'); expect(f.platform.connectCore).toHaveBeenCalledTimes(2);
});
test('change notifications refresh counts and release subscription on unmount', async () => {
  const f = session(); const view = render(<App platform={f.platform} />); await screen.findByText('Connected to local core');
  f.transport.query.mockResolvedValue(emptyBoard(0));
  act(() => f.changed()); await waitFor(() => expect(screen.queryByLabelText('3 open questions')).toBeNull());
  view.unmount(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.transport.close).toHaveBeenCalledOnce();
});
test('a delayed connection is closed after the view is unmounted', async () => {
  const f = session(); let finish!: (value: CoreTransport) => void;
  f.platform.connectCore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<App platform={f.platform} />); view.unmount();
  await act(async () => { finish(f.transport as CoreTransport); });
  expect(f.transport.close).toHaveBeenCalledOnce(); expect(f.transport.subscribe).not.toHaveBeenCalled();
});
test('periodic reads detect a lost idle connection', async () => {
  vi.useFakeTimers(); const f = session();
  await act(async () => { render(<App platform={f.platform} />); });
  f.transport.query.mockRejectedValue(new Error('CONNECTION_CLOSED'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText('Local core unavailable')).toBeTruthy();
  expect(screen.queryByLabelText('3 open questions')).toBeNull();
});
test('an obsolete delayed connection cannot replace the current command channel', async () => {
  const old = session(); const next = session(); let finish!: (value: CoreTransport) => void;
  old.platform.connectCore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { renderHook } = await import('@testing-library/react');
  const { useCore } = await import('./use-core.js');
  const hook = renderHook(({ platform }) => useCore(platform), { initialProps: { platform: old.platform } });
  hook.rerender({ platform: next.platform });
  await waitFor(() => expect(hook.result.current.state.phase).toBe('connected'));
  await act(async () => { finish(old.transport as CoreTransport); });
  next.transport.execute.mockResolvedValue({ ok: true, eventId: 'synthetic', ops: [], raisedQuestionIds: [], suggestedAssertionIds: [] });
  await act(async () => { await hook.result.current.execute({ name: 'initiative.rank', args: { id: 'synthetic', manualRank: 'a0' } }); });
  expect(next.transport.execute).toHaveBeenCalledOnce(); expect(old.transport.execute).not.toHaveBeenCalled();
});

test('initiative routing stays under Initiatives and accepts only canonical id-shaped paths', () => {
  const id = '01000000-0000-7000-8000-000000000001';
  expect(destinationFromHash(`#initiatives/${id}`)).toBe('initiatives');
  expect(initiativeFromHash(`#initiatives/${id}`)).toBe(id);
  expect(initiativeFromHash('#initiatives/untrusted-command')).toBeUndefined();
});
test('session undo tracks only acknowledged user commands and retains failures for retry', async () => {
  const f = session(); const { renderHook } = await import('@testing-library/react'); const { useCore } = await import('./use-core.js');
  const hook = renderHook(() => useCore(f.platform));
  await waitFor(() => expect(hook.result.current.state.phase).toBe('connected'));
  const success = { ok: true, eventId: 'synthetic-event', ops: [], raisedQuestionIds: [], suggestedAssertionIds: [] };
  f.transport.execute.mockResolvedValueOnce({ ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Synthetic error' } });
  await act(async () => { await hook.result.current.execute({ name: 'node.delete', args: { id: 'synthetic' } }); });
  expect(hook.result.current.canUndo).toBe(false);
  f.transport.execute.mockResolvedValueOnce(success);
  await act(async () => { await hook.result.current.execute({ name: 'node.update', args: { id: 'synthetic', patch: { title: 'Synthetic' } } }); });
  expect(hook.result.current.canUndo).toBe(true);
  f.transport.execute.mockResolvedValueOnce({ ok: false, error: { code: 'STALE_BASE', message: 'Later edit conflicts' } });
  await act(async () => { await hook.result.current.undo(); }); expect(hook.result.current.canUndo).toBe(true);
  f.transport.execute.mockResolvedValueOnce({ ...success, eventId: 'synthetic-undo' });
  await act(async () => { await hook.result.current.undo(); }); expect(hook.result.current.canUndo).toBe(false);
  expect(f.transport.execute).toHaveBeenLastCalledWith({ name: 'change.undo', args: { eventId: 'synthetic-event' } });
});

test('focused routes preserve initiative identity and browser-back route shape', () => {
  const initiative = '01000000-0000-7000-8000-000000000001'; const node = '02000000-0000-7000-8000-000000000002';
  const hash = `#initiatives/${initiative}/focus/${node}`;
  expect(destinationFromHash(hash)).toBe('initiatives'); expect(initiativeFromHash(hash)).toBe(initiative); expect(focusedNodeFromHash(hash)).toBe(node);
  expect(focusedNodeFromHash(`#initiatives/${initiative}`)).toBeUndefined();
  expect(focusedNodeFromHash(`#initiatives/${initiative}/focus/untrusted`)).toBeUndefined();
});

test('command text survives a lost core connection', async () => {
  const f = session(); render(<App platform={f.platform} />); await screen.findByText('Connected to local core');
  fireEvent.change(screen.getByRole('textbox',{name:'What would you like to change?'}),{target:{value:'Keep this synthetic request'}});
  f.transport.query.mockRejectedValue(new Error('CONNECTION_CLOSED')); act(()=>f.changed()); await screen.findByText('Local core unavailable');
  expect((screen.getByRole('textbox',{name:'What would you like to change?'}) as HTMLInputElement).value).toBe('Keep this synthetic request');
});
