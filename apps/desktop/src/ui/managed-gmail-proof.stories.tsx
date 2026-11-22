import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { ManagedGmailProof, type ManagedGmailActions } from './managed-gmail-proof.js';
import './tokens.css';

const labels = [{ id: 'synthetic-label', name: 'S4 synthetic' }];
const meta = {
  title: 'Spikes/Managed Gmail connection', component: ManagedGmailProof,
  args: { actions: { connect: fn(async () => labels), read: fn(async () => ({ messages: 3, pages: 1 })) } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ManagedGmailProof>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectAndRead: Story = {
  play: async ({ canvas, userEvent, args }) => {
    canvas.getByRole('button', { name: 'Connect Gmail' }).focus();
    await userEvent.keyboard('{Enter}');
    const label = await canvas.findByLabelText('Gmail label');
    await expect(canvas.getByRole('button', { name: 'Read test messages' })).toBeDisabled();
    await userEvent.selectOptions(label, 'S4 synthetic');
    await userEvent.click(canvas.getByRole('button', { name: 'Read test messages' }));
    await canvas.findByText('Read 3 test messages. No messages were changed.');
    await expect(args.actions.read).toHaveBeenCalledWith('synthetic-label');
  },
};

export const WaitingForConsent: Story = {
  args: { actions: { connect: fn<ManagedGmailActions['connect']>(() => new Promise(() => {})), read: fn() } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Gmail' }));
    await canvas.findByRole('status');
    await expect(canvas.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled();
  },
};

export const ConsentCancelled: Story = {
  args: { actions: { connect: fn(async () => { throw new Error('google_sign_in_cancelled'); }), read: fn() } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Gmail' }));
    await canvas.findByRole('alert');
    await expect(canvas.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled();
  },
};

export const NoTestLabel: Story = {
  args: { actions: { connect: fn(async () => []), read: fn() } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Gmail' }));
    await canvas.findByText('No S4 synthetic label found. Create it in Gmail, then reconnect.');
  },
};

export const ReadUnavailable: Story = {
  args: { actions: { connect: fn(async () => labels), read: fn(async () => { throw new Error('test_read_failed'); }) } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Gmail' }));
    await userEvent.selectOptions(await canvas.findByLabelText('Gmail label'), 'S4 synthetic');
    await userEvent.click(canvas.getByRole('button', { name: 'Read test messages' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('The test read could not finish. Try again.');
  },
};
