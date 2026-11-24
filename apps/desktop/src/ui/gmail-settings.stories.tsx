import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import type { GmailSettingsStatus } from '@fulcrum/domain';
import { GmailSettings } from './gmail-settings.js';
import './tokens.css';

type Administer = Parameters<typeof GmailSettings>[0]['administer'];
const account = 'fixture@example.invalid';
const label = { id: 'Label_synthetic', label: 'Synthetic mail' };
const withStatus = (status: GmailSettingsStatus): Administer => fn(async () => status) as unknown as Administer;
const meta = {
  title: 'Settings/Gmail',
  component: GmailSettings,
  args: { administer: withStatus({ phase: 'disconnected' }), designated: true },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof GmailSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectAndSelect: Story = {
  args: {
    administer: fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'gmail.connect') { await expect(args).toEqual({ acknowledged: true }); return {}; }
      if (name === 'gmail.select') { await expect(args).toEqual({ id: label.id }); return {}; }
      throw new Error('Use the story render');
    }) as unknown as Administer,
  },
  render: ({ designated, administer }) => {
    let status: GmailSettingsStatus = { phase: 'disconnected' };
    const simulated = (async (name: string, args: never) => {
      if (name === 'gmail.status') return status;
      if (name === 'gmail.connect') { await administer(name, args); status = { phase: 'select', labels: [label], account }; }
      if (name === 'gmail.select') { await administer(name, args); status = { phase: 'active', label, account }; }
      if (name === 'gmail.disconnect') status = { phase: 'disconnected' };
      return {};
    }) as Administer;
    return <GmailSettings designated={designated} administer={simulated} />;
  },
  play: async ({ canvas, userEvent }) => {
    const connect = await canvas.findByRole('button', { name: 'Sign in with Google' });
    await expect(canvas.queryByLabelText('Gmail address')).not.toBeInTheDocument();
    connect.focus();
    await userEvent.keyboard('{Enter}');
    const chooser = await canvas.findByLabelText('Gmail label');
    const start = canvas.getByRole('button', { name: 'Start sync' });
    await expect(start).toBeDisabled();
    await userEvent.selectOptions(chooser, label.id);
    start.focus();
    await userEvent.keyboard('{Enter}');
    await canvas.findByText(/Sync enabled for Synthetic mail/);
    await userEvent.click(canvas.getByRole('button', { name: 'Disconnect Gmail' }));
    await canvas.findByRole('button', { name: 'Sign in with Google' });
  },
};

export const WaitingForBrowser: Story = { args: { administer: withStatus({ phase: 'connecting' }) } };
export const NoLabels: Story = { args: { administer: withStatus({ phase: 'select', account, labels: [] }) } };
export const OtherMac: Story = { args: { designated: false } };
export const Unavailable: Story = { args: { administer: withStatus({ phase: 'unavailable' }) } };
export const SignInFailed: Story = { args: { administer: withStatus({ phase: 'failed' }) } };
export const Loading: Story = { args: { administer: fn(() => new Promise(() => {})) as unknown as Administer } };
