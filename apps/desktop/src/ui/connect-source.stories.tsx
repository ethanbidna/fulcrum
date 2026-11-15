import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import type { GmailSettingsStatus } from '@fulcrum/domain';
import { ConnectSource } from './connect-source.js';
import './tokens.css';

const LABEL = { id: 'Label_fixture', label: 'Synthetic mail' };
const ACCOUNT = 'fixture@example.invalid';
function serve(gmail: GmailSettingsStatus, ingestionDeviceId: string | null = 'dev-1') {
  return fn(async (name: string) => name === 'gmail.status' ? gmail : name === 'workspace.setupStatus'
    ? { completed: true, deviceId: 'dev-1', deviceLabel: 'Synthetic Mac', ingestionDeviceId, people: [], userEntityId: 'u-1' } : {}) as never;
}
const meta = { title: 'Setup/Connect a source', component: ConnectSource, args: { administer: serve({ phase: 'disconnected' }) }, parameters: { layout: 'padded' } } satisfies Meta<typeof ConnectSource>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseSource: Story = { play: async ({ canvas }) => {
  await canvas.findByRole('button', { name: /Gmail/ });
  await expect(canvas.getAllByText('Coming soon')).toHaveLength(3);
} };
export const SignIn: Story = { play: async ({ args, canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: /Gmail/ }));
  await expect(args.administer).toHaveBeenCalledWith('gmail.connect', { acknowledged: true });
  await expect(canvas.queryByLabelText('Gmail address')).not.toBeInTheDocument();
} };
export const UseThisMac: Story = { args: { administer: serve({ phase: 'disconnected' }, null) }, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: /Gmail/ }));
  await expect(await canvas.findByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
} };
export const WaitingForBrowser: Story = { args: { administer: serve({ phase: 'connecting' }) }, play: async ({ canvas }) => { await canvas.findByRole('button', { name: 'Cancel sign-in' }); } };
export const ChooseLabel: Story = { args: { administer: serve({ phase: 'select', account: ACCOUNT, labels: [LABEL, { id: 'Label_other', label: 'Other label' }] }) }, play: async ({ canvas, userEvent }) => {
  const start = await canvas.findByRole('button', { name: 'Start reading' });
  await expect(start).toBeDisabled();
  await userEvent.click(canvas.getByRole('radio', { name: 'Synthetic mail' }));
  await expect(start).toBeEnabled();
} };
export const Reading: Story = { args: { administer: serve({ phase: 'active', account: ACCOUNT, label: LABEL }) }, play: async ({ canvas }) => { await canvas.findByText(/Fulcrum is reading Synthetic mail/); } };
export const SignInFailed: Story = { args: { administer: serve({ phase: 'failed' }) }, play: async ({ canvas }) => {
  await canvas.findByRole('alert');
} };
export const NotSetUp: Story = { args: { administer: serve({ phase: 'unavailable' }) }, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: /Gmail/ }));
  await canvas.findByText(/Gmail is not set up in this build/);
} };
