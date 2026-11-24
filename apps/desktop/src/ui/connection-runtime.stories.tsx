import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import type { ConnectionRuntimeStatus } from '@fulcrum/domain';
import { ConnectionRuntimeControls } from './connection-runtime.js';
import './tokens.css';

type Administer = React.ComponentProps<typeof ConnectionRuntimeControls>['administer'];
const messages: Record<ConnectionRuntimeStatus['phase'], string> = {
  checking: 'Checking the local connection service…', not_installed: 'Set up the local connection service to connect your tools.',
  stopped: 'Connection service stopped. Saved connections stay on this Mac.', installing: 'Downloading the local runtime…',
  starting: 'Preparing secure sign-in on this Mac…', ready: 'Connection service ready. Importing is off.', stopping: 'Stopping the connection service…',
  failed: 'Connection service setup did not finish. Saved data was preserved.', unavailable: 'The connection service needs the native macOS app.',
};
const status = (phase: ConnectionRuntimeStatus['phase'], installed = true): ConnectionRuntimeStatus => ({ phase, installed, message: messages[phase], completedBytes: null, totalBytes: null });
const fixed = (phase: ConnectionRuntimeStatus['phase'], installed = true) => fn(async () => status(phase, installed)) as Administer;
const meta = {
  title: 'Settings/Connection service', component: ConnectionRuntimeControls,
  args: { administer: fn(async () => ({})) as Administer, designated: true, pollMs: 20 }, parameters: { layout: 'padded' },
  render: args => {
    let current = status('not_installed', false);
    const administer = (async (name: string, input: Record<string, unknown>) => {
      if (name === 'sources.runtime.status') return current;
      await args.administer(name as never, input as never);
      current = name === 'sources.runtime.start' ? status('ready') : status('stopped'); return {};
    }) as Administer;
    return <ConnectionRuntimeControls {...args} administer={administer} />;
  },
} satisfies Meta<typeof ConnectionRuntimeControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InstallWithConsent: Story = { play: async ({ canvas, userEvent, args }) => {
  const install = await canvas.findByRole('button', { name: 'Download and set up connections' });
  await expect(install).toBeDisabled(); await expect(args.administer).not.toHaveBeenCalled();
  const consent = canvas.getByRole('checkbox', { name: 'I agree to download and run the local connection service.' });
  consent.focus(); await userEvent.keyboard(' '); install.focus(); await userEvent.keyboard('{Enter}');
  await canvas.findByText('Connection service ready. Importing is off.');
  await expect(args.administer).toHaveBeenCalledWith('sources.runtime.start', { acknowledged: true });
  await userEvent.click(canvas.getByRole('button', { name: 'Stop connection service' }));
  const start = await canvas.findByRole('button', { name: 'Start connection service' }); await expect(start).toHaveFocus();
  await expect(args.administer).toHaveBeenCalledWith('sources.runtime.stop', {});
} };
export const Stopped: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('stopped')} /> };
export const Ready: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('ready')} /> };
export const Starting: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('starting')} /> };
export const Stopping: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('stopping')} />, play: async ({ canvas }) => {
  await expect(await canvas.findByRole('button', { name: 'Stop connection service' })).toBeDisabled();
} };
export const CancelDownload: Story = {
  render: args => {
    let current = { ...status('installing', false), completedBytes: 8 * 1024 ** 2, totalBytes: 36 * 1024 ** 2 };
    const administer = (async (name: string, input: Record<string, unknown>) => {
      if (name === 'sources.runtime.status') return current;
      await args.administer(name as never, input as never); current = { ...status('not_installed', false), completedBytes: 0, totalBytes: 0 }; return {};
    }) as Administer;
    return <ConnectionRuntimeControls {...args} administer={administer} />;
  },
  play: async ({ canvas, userEvent, args }) => {
    await canvas.findByText('8 MiB downloaded of 36 MiB');
    const cancel = await canvas.findByRole('button', { name: 'Cancel connection service setup' });
    cancel.focus(); await userEvent.keyboard('{Enter}');
    await expect(args.administer).toHaveBeenCalledWith('sources.runtime.stop', {});
    await expect(await canvas.findByRole('button', { name: 'Download and set up connections' })).toBeDisabled();
  },
};
export const FailedInstallation: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('failed', false)} /> };
export const FailedStart: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('failed')} /> };
export const OtherMac: Story = { args: { designated: false }, play: async ({ canvas, args }) => {
  await expect(await canvas.findByRole('button', { name: 'Download and set up connections' })).toBeDisabled();
  await expect(canvas.getByRole('checkbox')).toBeDisabled(); await expect(args.administer).not.toHaveBeenCalled();
} };
export const Unavailable: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('unavailable', false)} /> };
export const Loading: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fn(() => new Promise(() => {})) as Administer} /> };
export const Checking: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fixed('checking', false)} /> };
export const StatusFailed: Story = { render: args => <ConnectionRuntimeControls {...args} administer={fn(async () => { throw new Error('synthetic'); })} />, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Retry connection service status' })); await canvas.findByRole('alert');
} };
export const ActionFailed: Story = { args: { administer: fn(async () => { throw new Error('synthetic'); }) }, play: async ({ canvas, userEvent }) => {
  await userEvent.click(await canvas.findByRole('checkbox'));
  await userEvent.click(canvas.getByRole('button', { name: 'Download and set up connections' }));
  await canvas.findByText('Could not update the connection service. Check its status and retry.');
} };
