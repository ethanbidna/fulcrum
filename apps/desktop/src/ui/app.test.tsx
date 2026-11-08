// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './app.js';
import type { CoreTransport } from '../core-transport.js';
import { destinationFromHash } from './navigation.js';
afterEach(() => { cleanup(); window.location.hash = ''; vi.useRealTimers(); });
function session() {
  let changed = () => {};
  const stop = vi.fn();
  const transport = { query: vi.fn(), execute: vi.fn(), subscribe: vi.fn(async listener => { changed = () => listener({}); return stop; }), close: vi.fn() };
  transport.query.mockImplementation(async name => name === 'portfolio.rail' ? { questionCount: 3 } : []);
  const platform = { connectCore: vi.fn(async () => transport as CoreTransport) };
  return { transport, platform, stop, changed: () => changed() };
}
test('four destinations, live quiet question count and canonical reads only', async () => {
  const f = session(); render(<App platform={f.platform} />);
  await screen.findByText('Connected to local core');
  expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Skip to content', 'Initiatives', 'Priorities', 'Questions3', 'Settings']);
  expect(screen.getByLabelText('3 open questions').textContent).toBe('3');
  expect(f.transport.query).toHaveBeenCalledWith('portfolio.rail', {});
  expect(f.transport.query).toHaveBeenCalledWith('portfolio.list', {});
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
  f.transport.query.mockImplementation(async name => name === 'portfolio.rail' ? { questionCount: 0 } : []);
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
