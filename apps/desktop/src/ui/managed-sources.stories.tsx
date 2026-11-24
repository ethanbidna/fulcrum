import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import type { ManagedSourceId, ManagedSourceStatus } from '@fulcrum/domain';
import { ManagedSources } from './managed-sources.js';
import './tokens.css';

type Administer = React.ComponentProps<typeof ManagedSources>['administer'];
const IDS: ManagedSourceId[] = ['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'];
function managedStatus(phase: ManagedSourceStatus['phase']): ManagedSourceStatus[] {
  return IDS.map(source => ({ source, phase, ingestion: 'blocked' }));
}
const meta = {
  title: 'Settings/Managed sources', component: ManagedSources,
  args: { administer: fn(async () => ({})) as Administer, designated: true, pollMs: 20 },
  render: args => {
    let statuses = managedStatus('disconnected');
    const administer = (async (name: string, input: Record<string, unknown>) => {
      if (name === 'sources.status') return statuses;
      await args.administer(name as never, input as never);
      if (name === 'sources.connect' || name === 'sources.granola') statuses = statuses.map(status => status.source === (input.source ?? 'granola') ? { ...status, phase: 'connected' } : status);
      if (name === 'sources.disconnect' || name === 'sources.cancel') statuses = statuses.map(status => status.source === input.source ? { ...status, phase: 'disconnected' } : status);
      return {};
    }) as Administer;
    return <ManagedSources {...args} administer={administer} />;
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ManagedSources>;
export default meta;
type Story = StoryObj<typeof meta>;
const fixed = (phase: ManagedSourceStatus['phase']) => fn(async () => managedStatus(phase)) as Administer;

export const ConnectInBrowser: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const button = await canvas.findByRole('button', { name: 'Connect Gmail' });
    button.focus(); await userEvent.keyboard('{Enter}');
    await canvas.findByText(/hosted authorization service/);
    const continueButton = canvas.getByRole('button', { name: 'Continue to Gmail in browser' });
    await expect(continueButton).toBeDisabled();
    await expect(args.administer).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Gmail through Activepieces.' }));
    continueButton.focus(); await userEvent.keyboard('{Enter}');
    await expect(args.administer).toHaveBeenCalledWith('sources.connect', { source: 'gmail', acknowledged: true });
    await canvas.findByRole('button', { name: 'Disconnect Gmail' });
    await userEvent.click(canvas.getByRole('button', { name: 'Disconnect Gmail' }));
    await canvas.findByRole('button', { name: 'Connect Gmail' });
  },
};
export const GranolaKey: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Granola' }));
    const key = canvas.getByLabelText('Granola API key');
    await expect(key).toHaveAttribute('type', 'password');
    await userEvent.type(key, 'synthetic-granola-key');
    await expect(canvas.getByRole('button', { name: 'Save Granola connection' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Granola through Activepieces.' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save Granola connection' }));
    await expect(args.administer).toHaveBeenCalledWith('sources.granola', { apiKey: 'synthetic-granola-key', acknowledged: true });
    await expect(canvas.queryByLabelText('Granola API key')).not.toBeInTheDocument();
  },
};
export const OtherMac: Story = { args: { designated: false }, play: async ({ canvas, args }) => {
  await expect(await canvas.findByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
  await expect(args.administer).not.toHaveBeenCalled();
} };
export const WaitingAndCancel: Story = {
  render: args => {
    let statuses = managedStatus('connecting');
    const administer = (async (name: string, input: Record<string, unknown>) => {
      if (name === 'sources.status') return statuses;
      await args.administer(name as never, input as never);
      statuses = statuses.map(status => status.source === input.source ? { ...status, phase: 'disconnected' } : status);
      return {};
    }) as Administer;
    return <ManagedSources {...args} administer={administer} />;
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel Gmail connection' }));
    await expect(args.administer).toHaveBeenCalledWith('sources.cancel', { source: 'gmail' });
    await canvas.findByRole('button', { name: 'Connect Gmail' });
  },
};
export const SavedAfterRestart: Story = { render: args => <ManagedSources {...args} administer={fixed('saved')} />, play: async ({ canvas }) => {
  await canvas.findByRole('button', { name: 'Check Gmail connection' });
  await expect(canvas.queryByText(/Sync enabled/)).not.toBeInTheDocument();
} };
export const Connected: Story = { render: args => <ManagedSources {...args} administer={fixed('connected')} /> };
export const Unavailable: Story = { render: args => <ManagedSources {...args} administer={fixed('unavailable')} /> };
export const FailedConnection: Story = { render: args => <ManagedSources {...args} administer={fixed('failed')} /> };
export const Cancelling: Story = { render: args => <ManagedSources {...args} administer={fixed('cancelling')} /> };
export const Loading: Story = { render: args => <ManagedSources {...args} administer={fn(() => new Promise(() => {})) as Administer} /> };
export const LoadFailed: Story = { render: args => <ManagedSources {...args} administer={fn(async () => { throw new Error('synthetic'); })} />, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Retry source connections' }));
  await canvas.findByText('Could not load source connections.');
} };
export const ConnectionFailed: Story = { args: { administer: fn(async () => { throw new Error('synthetic'); }) }, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Connect Dropbox' }));
  await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Dropbox through Activepieces.' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Continue to Dropbox in browser' }));
  await canvas.findByText('The connection could not be updated. Retry, or check the local connection service.');
} };

export const CancelSetup: Story = { play: async ({ canvas, userEvent, args }) => {
  const connect = await canvas.findByRole('button', { name: 'Connect Granola' });
  await userEvent.click(connect);
  await userEvent.type(canvas.getByLabelText('Granola API key'), 'synthetic-discarded-key');
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel setup' }));
  await expect(canvas.queryByLabelText('Granola API key')).not.toBeInTheDocument();
  await expect(connect).toHaveFocus();
  await expect(args.administer).not.toHaveBeenCalled();
} };
