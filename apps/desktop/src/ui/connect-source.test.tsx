// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GmailSettingsStatus, ManagedSourceStatus } from '@fulcrum/domain';
import { ConnectSource } from './connect-source.js';

afterEach(cleanup);
const POLL_MS = 10;
const LABEL = { id: 'Label_fixture', label: 'Synthetic mail' };
const ACCOUNT = 'fixture@example.invalid';
function fake(phase: ManagedSourceStatus['phase'] = 'disconnected', ingestionDeviceId: string | null = 'dev-1', gmail: GmailSettingsStatus = { phase: 'unavailable' }) {
  let statuses = (['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'] as const).map(source => ({ source, phase, ingestion: 'blocked' }));
  let setup = { completed: true, deviceId: 'dev-1', deviceLabel: 'Synthetic Mac', ingestionDeviceId, people: [], userEntityId: 'u-1' };
  const administer = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'gmail.status') return gmail;
    if (name === 'sources.status') return statuses;
    if (name === 'workspace.setupStatus') return setup;
    if (name === 'sources.connect' || name === 'sources.cancel') statuses = statuses.map(status => status.source === args.source ? { ...status, phase: name === 'sources.connect' ? 'connecting' : 'disconnected' } : status);
    if (name === 'workspace.configure') setup = { ...setup, ingestionDeviceId: setup.deviceId };
    return {};
  });
  return { administer, props: { administer: administer as never, pollMs: POLL_MS } };
}
const calls = (f: ReturnType<typeof fake>, name: string) => f.administer.mock.calls.filter(call => call[0] === name);

test('offers all six managed connections and never requests a developer OAuth client', async () => {
  render(<ConnectSource {...fake().props} />);
  await screen.findByRole('button', { name: 'Connect Gmail' });
  expect(screen.getAllByRole('button', { name: /^Connect / })).toHaveLength(6);
  expect(screen.queryByText('Coming soon')).toBeNull();
  expect(screen.queryByText(/configured Google Desktop OAuth client/)).toBeNull();
});
test('requires acknowledgement before opening managed Gmail sign-in', async () => {
  const f = fake(); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Gmail' }));
  const next = screen.getByRole('button', { name: 'Continue to Gmail in browser' }) as HTMLButtonElement;
  expect(next.disabled).toBe(true); expect(calls(f, 'sources.connect')).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to connect Gmail through Activepieces.' })); fireEvent.click(next);
  await waitFor(() => expect(calls(f, 'sources.connect')[0]?.[1]).toEqual({ source: 'gmail', acknowledged: true }));
  expect(calls(f, 'gmail.connect')).toHaveLength(0);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel Gmail connection' }));
  await waitFor(() => expect(calls(f, 'sources.cancel')).toHaveLength(1));
});
test('designating a new Mac does not silently open provider consent', async () => {
  const f = fake('disconnected', null); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use this Mac for source connections' }));
  await waitFor(() => expect(calls(f, 'workspace.configure')[0]?.[1]).toMatchObject({ ingestion: 'this_mac', handoverConfirmed: false }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Connect Gmail' }) as HTMLButtonElement).disabled).toBe(false));
  expect(calls(f, 'sources.connect')).toHaveLength(0);
});
test('moving connections from another Mac requires confirmation', async () => {
  const f = fake('disconnected', 'dev-2'); render(<ConnectSource {...f.props} />);
  const move = await screen.findByRole('button', { name: 'Use this Mac for source connections' }) as HTMLButtonElement;
  expect(move.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /I will reconnect credentials here/ })); fireEvent.click(move);
  await waitFor(() => expect(calls(f, 'workspace.configure')[0]?.[1]).toMatchObject({ handoverConfirmed: true }));
});
test('preserves an existing direct Gmail connection without starting a new one', async () => {
  const f = fake('unavailable', 'dev-1', { phase: 'active', account: ACCOUNT, label: LABEL }); render(<ConnectSource {...f.props} />);
  await screen.findByRole('heading', { name: 'Existing Gmail connection' });
  expect(await screen.findByText(/Sync enabled for Synthetic mail/)).toBeTruthy();
  expect(calls(f, 'gmail.connect')).toHaveLength(0); expect(calls(f, 'sources.connect')).toHaveLength(0);
});
test('keeps the key masked and drops the input on submit', async () => {
  const f = fake(); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Granola' }));
  const key = screen.getByLabelText('Granola API key') as HTMLInputElement;
  expect(key.type).toBe('password'); fireEvent.change(key, { target: { value: 'synthetic-key' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to connect Granola through Activepieces.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Granola connection' }));
  await waitFor(() => expect(calls(f, 'sources.granola')[0]?.[1]).toEqual({ apiKey: 'synthetic-key', acknowledged: true }));
  expect(screen.queryByLabelText('Granola API key')).toBeNull();
});
