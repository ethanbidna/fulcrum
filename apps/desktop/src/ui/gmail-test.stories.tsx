import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { GmailTest, type GmailTestActions } from './gmail-test.js';
import './tokens.css';

const connect = fn(async () => [{ id: 'Label_synthetic', name: 'S4 synthetic' }]);
const backfill = fn<(label: string) => Promise<{ pages: number; messages: number }>>(async () => ({ pages: 1, messages: 1 }));
const incremental = fn(async () => ({ pages: 1, messages: 1 }));
const meta = {
  title: 'Settings/Gmail connection test',
  component: GmailTest,
  args: { actions: { connect, backfill, incremental } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof GmailTest>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectAndSync: Story = {
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Connect Gmail' }).focus();
    await userEvent.keyboard('{Enter}');
    const label = await canvas.findByLabelText('Gmail label');
    const run = canvas.getByRole('button', { name: 'Run backfill' });
    await expect(run).toBeDisabled();
    await userEvent.selectOptions(label, 'S4 synthetic');
    await userEvent.click(run);
    await expect(backfill).toHaveBeenCalledWith('Label_synthetic');
    await userEvent.click(await canvas.findByRole('button', { name: 'Check for new mail' }));
    await canvas.findByText('Incremental sync read 1 message across 1 page.');
  },
};

export const WaitingForGoogle: Story = {
  args: { actions: { connect: fn<GmailTestActions['connect']>(() => new Promise(() => {})), backfill, incremental } },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Connect Gmail' });
    await userEvent.click(button);
    await expect(button).toBeDisabled();
    await canvas.findByText('Finish signing in with Google in your browser.');
  },
};

export const WrongAccount: Story = {
  args: { actions: { connect: fn(async () => { throw new Error('wrong_google_account'); }), backfill, incremental } },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Connect Gmail' });
    await userEvent.click(button);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Sign in with the designated test account.');
    await expect(button).toBeEnabled();
  },
};

export const NoLabels: Story = {
  args: { actions: { connect: fn(async () => []), backfill, incremental } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Gmail' }));
    await canvas.findByText('Create a test label in Gmail, then reconnect.');
  },
};
