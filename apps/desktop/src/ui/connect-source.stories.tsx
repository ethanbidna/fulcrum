import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import type { GmailSettingsStatus, ManagedSourceStatus } from '@fulcrum/domain';
import { ConnectSource } from './connect-source.js';
import './tokens.css';

type Administer = React.ComponentProps<typeof ConnectSource>['administer'];
function serve(phase: ManagedSourceStatus['phase'], ingestionDeviceId: string | null = 'dev-1', gmail: GmailSettingsStatus = { phase: 'unavailable' }) {
  return fn(async (name: string) => name === 'sources.runtime.status' ? { phase: 'ready', installed: true, message: 'Connection service ready. Importing is off.', completedBytes: null, totalBytes: null } : name === 'gmail.status' ? gmail : name === 'sources.status'
    ? (['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'] as const).map(source => ({ source, phase, ingestion: 'blocked' }))
    : name === 'workspace.setupStatus' ? { completed: true, deviceId: 'dev-1', deviceLabel: 'Synthetic Mac', ingestionDeviceId, people: [], userEntityId: 'u-1' } : {}) as Administer;
}
const meta = { title: 'Setup/Connect a source', component: ConnectSource, args: { administer: serve('disconnected'), pollMs: 20 }, parameters: { layout: 'padded' } } satisfies Meta<typeof ConnectSource>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ChooseSource: Story = { play: async ({ canvas }) => {
  await canvas.findByRole('button', { name: 'Connect Gmail' });
  await expect(canvas.getAllByRole('button', { name: /^Connect / })).toHaveLength(6);
  await expect(canvas.queryByText('Coming soon')).not.toBeInTheDocument();
} };
export const SignIn: Story = { play: async ({ args, canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }));
  await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Gmail through Activepieces.' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Continue to Gmail in browser' }));
  await expect(args.administer).toHaveBeenCalledWith('sources.connect', { source: 'gmail', acknowledged: true });
  await expect(args.administer).not.toHaveBeenCalledWith('gmail.connect', { acknowledged: true });
} };
export const UseThisMac: Story = { args: { administer: serve('disconnected', null) }, play: async ({ canvas }) => {
  await expect(await canvas.findByRole('button', { name: 'Use this Mac for source connections' })).toBeEnabled();
  await expect(canvas.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
} };
export const MoveFromOtherMac: Story = { args: { administer: serve('disconnected', 'dev-2') }, play: async ({ canvas, userEvent }) => {
  const move = await canvas.findByRole('button', { name: 'Use this Mac for source connections' });
  await expect(move).toBeDisabled();
  await userEvent.click(canvas.getByRole('checkbox', { name: 'I will reconnect credentials here and choose what to read.' }));
  await expect(move).toBeEnabled();
} };
export const WaitingForBrowser: Story = { args: { administer: serve('connecting') } };
export const SavedAfterRestart: Story = { args: { administer: serve('saved') } };
export const Connected: Story = { args: { administer: serve('connected') } };
export const SignInFailed: Story = { args: { administer: serve('failed') } };
export const NotSetUp: Story = { args: { administer: serve('unavailable') } };
export const Loading: Story = { args: { administer: fn(() => new Promise(() => {})) as Administer } };
export const Unavailable: Story = { args: { administer: fn(async () => { throw new Error('synthetic'); }) } };
export const ExistingGmail: Story = { args: { administer: serve('unavailable', 'dev-1', { phase: 'active', account: 'fixture@example.invalid', label: { id: 'synthetic-label', label: 'Synthetic mail' } }) }, play: async ({ canvas }) => {
  await canvas.findByRole('heading', { name: 'Existing Gmail connection' });
  await canvas.findByText(/Sync enabled for Synthetic mail/);
} };
