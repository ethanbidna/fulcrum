// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GmailSettingsStatus } from '@fulcrum/domain';
import { ConnectSource } from './connect-source.js';

afterEach(cleanup);
const POLL_MS = 10;
const LABEL = { id: 'Label_fixture', label: 'Synthetic mail' };
const ACCOUNT = 'fixture@example.invalid';

function fake(initial: { gmail?: GmailSettingsStatus; ingestionDeviceId?: string | null } = {}) {
  let gmail: GmailSettingsStatus = initial.gmail ?? { phase: 'disconnected' };
  let setup = { completed: true, deviceId: 'dev-1', deviceLabel: 'Synthetic Mac', ingestionDeviceId: initial.ingestionDeviceId === undefined ? 'dev-1' : initial.ingestionDeviceId, people: [], userEntityId: 'u-1' };
  const administer = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'gmail.status') return gmail;
    if (name === 'workspace.setupStatus') return setup;
    if (name === 'gmail.connect') { gmail = { phase: 'connecting' }; return {}; }
    if (name === 'gmail.select') { gmail = { phase: 'active', account: ACCOUNT, label: LABEL }; void args; return {}; }
    if (name === 'gmail.disconnect') { gmail = { phase: 'disconnected' }; return {}; }
    if (name === 'workspace.configure') { setup = { ...setup, ingestionDeviceId: setup.deviceId }; return { deviceId: setup.deviceId, userEntityId: 'u-1' }; }
    throw new Error(`unexpected ${name}`);
  });
  return { administer, props: { administer: administer as never, pollMs: POLL_MS }, set: (next: GmailSettingsStatus) => { gmail = next; } };
}
const calls = (f: ReturnType<typeof fake>, name: string) => f.administer.mock.calls.filter(call => call[0] === name);

test('starts by choosing a source; only Gmail can be connected', async () => {
  render(<ConnectSource {...fake().props} />);
  expect(await screen.findByRole('heading', { name: 'Connect a source' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Gmail/ })).toBeTruthy();
  for (const name of ['Slack', 'Google Drive', 'Granola']) expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull();
  expect(screen.getAllByText('Coming soon').length).toBe(3);
});

test('choosing Gmail signs in with Google right away; no address is asked for', async () => {
  const f = fake(); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Gmail/ }));
  await waitFor(() => expect(calls(f, 'gmail.connect')[0]?.[1]).toEqual({ acknowledged: true }));
  expect(screen.queryByLabelText('Gmail address')).toBeNull();
  expect(await screen.findByText(/Finish signing in with Google in your browser/)).toBeTruthy();
});

test('a Mac that is not the reading Mac becomes it and signs in in one step', async () => {
  const f = fake({ ingestionDeviceId: null }); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Gmail/ }));
  expect(screen.getByText(/Credentials stay on the Mac that reads/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  await waitFor(() => expect(calls(f, 'workspace.configure')[0]?.[1]).toMatchObject({ deviceLabel: 'Synthetic Mac', ingestion: 'this_mac', handoverConfirmed: false, userEntityId: 'u-1' }));
  await waitFor(() => expect(calls(f, 'gmail.connect')[0]?.[1]).toEqual({ acknowledged: true }));
});

test('moving reading from another Mac needs an explicit confirmation', async () => {
  const f = fake({ ingestionDeviceId: 'dev-2' }); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Gmail/ }));
  const move = await screen.findByRole('button', { name: 'Move reading here and sign in with Google' });
  expect((move as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /I will reconnect credentials here/ }));
  fireEvent.click(move);
  await waitFor(() => expect(calls(f, 'workspace.configure')[0]?.[1]).toMatchObject({ ingestion: 'this_mac', handoverConfirmed: true }));
  await waitFor(() => expect(calls(f, 'gmail.connect').length).toBe(1));
});

test('while Google sign-in is open it can be cancelled', async () => {
  const f = fake({ gmail: { phase: 'connecting' } }); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
  await waitFor(() => expect(calls(f, 'gmail.disconnect').length).toBe(1));
});

const WHOLE = { id: 'fulcrum:whole-mailbox', label: 'Whole mailbox (all mail except Spam and Trash)' };

test('after sign-in the whole mailbox is preselected and reading starts', async () => {
  const f = fake({ gmail: { phase: 'select', account: ACCOUNT, labels: [WHOLE, LABEL] } }); render(<ConnectSource {...f.props} />);
  const start = await screen.findByRole('button', { name: 'Start reading' });
  expect((screen.getByRole('radio', { name: /Whole mailbox/ }) as HTMLInputElement).checked).toBe(true);
  expect((start as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(start);
  await waitFor(() => expect(calls(f, 'gmail.select')[0]?.[1]).toEqual({ id: WHOLE.id }));
});

test('the user can still pick one label instead', async () => {
  const f = fake({ gmail: { phase: 'select', account: ACCOUNT, labels: [WHOLE, LABEL] } }); render(<ConnectSource {...f.props} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'Synthetic mail' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start reading' }));
  await waitFor(() => expect(calls(f, 'gmail.select')[0]?.[1]).toEqual({ id: LABEL.id }));
  expect(await screen.findByText(/Fulcrum is reading Synthetic mail/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Go to Initiatives' }).getAttribute('href')).toBe('#initiatives');
});

test('a failed sign-in explains and lets the user try again', async () => {
  render(<ConnectSource {...fake({ gmail: { phase: 'failed' } }).props} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Gmail/ }));
  await waitFor(() => expect(screen.getByText(/Finish signing in with Google/)).toBeTruthy());
});

test('without a configured Google client it says so instead of offering a dead end', async () => {
  render(<ConnectSource {...fake({ gmail: { phase: 'unavailable' } }).props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Gmail/ }));
  expect(await screen.findByText(/Gmail is not set up in this build/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
});
