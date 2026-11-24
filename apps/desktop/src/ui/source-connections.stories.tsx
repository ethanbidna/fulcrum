import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { SourceConnections } from './source-connections.js';
import './tokens.css';

type Administer = React.ComponentProps<typeof SourceConnections>['administer'];
const meta = { title: 'Settings/Source connections', component: SourceConnections, args: { administer: fn(async () => ({})) as Administer, designated: true, pollMs: 20 }, parameters: { layout: 'padded' } } satisfies Meta<typeof SourceConnections>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SetupThenConnect: Story = {
  render: args => {
    let phase = 'not_installed'; let gmail = false;
    const administer = fn(async (name: string) => {
      if (name === 'sources.runtime.status') return { phase, installed: phase !== 'not_installed', message: phase === 'ready' ? 'Connection service ready. Importing is off.' : 'Connection service stopped.', completedBytes: null, totalBytes: null };
      if (name === 'sources.status') return (['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'] as const).map(source => ({ source, phase: phase !== 'ready' ? 'unavailable' : source === 'gmail' && gmail ? 'saved' : 'disconnected', ingestion: 'blocked' }));
      if (name === 'sources.runtime.start') phase = 'ready';
      if (name === 'sources.runtime.stop') phase = 'stopped';
      if (name === 'sources.connect') gmail = true;
      return {};
    }) as Administer;
    return <SourceConnections {...args} administer={administer} />;
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.queryByRole('button', { name: 'Connect Gmail' })).not.toBeInTheDocument();
    await userEvent.click(await canvas.findByRole('checkbox'));
    await userEvent.click(canvas.getByRole('button', { name: 'Download and set up connections' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }));
    await expect(canvas.getByRole('form', { name: 'Connect Gmail' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Stop connection service' }));
    await canvas.findByRole('button', { name: 'Start connection service' });
    await expect(canvas.queryByRole('form', { name: 'Connect Gmail' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Start connection service' }));
    await canvas.findByRole('button', { name: 'Connect Gmail' });
  },
};

export const SavedConnectionsAndKeyClearing: Story = {
  render: args => {
    let ready = true;
    const administer = fn(async (name: string) => {
      if (name === 'sources.runtime.status') return { phase: ready ? 'ready' : 'stopped', installed: true, message: ready ? 'Connection service ready. Importing is off.' : 'Connection service stopped.', completedBytes: null, totalBytes: null };
      if (name === 'sources.runtime.stop') ready = false;
      if (name === 'sources.runtime.start') ready = true;
      if (name === 'sources.status') return (['gmail', 'slack', 'granola', 'google_drive', 'dropbox', 'google_calendar'] as const).map(source => ({ source, phase: !ready ? 'unavailable' : source === 'gmail' ? 'saved' : 'disconnected', ingestion: 'blocked' }));
      return {};
    }) as Administer;
    return <SourceConnections {...args} administer={administer} />;
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole('button', { name: 'Check Gmail connection' });
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Granola' }));
    await userEvent.type(canvas.getByLabelText('Granola API key'), 'synthetic-unsaved-key');
    await userEvent.click(canvas.getByRole('button', { name: 'Stop connection service' }));
    await canvas.findByRole('button', { name: 'Start connection service' });
    await expect(canvas.queryByLabelText('Granola API key')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Start connection service' }));
    await canvas.findByRole('button', { name: 'Check Gmail connection' });
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Granola' }));
    await expect(canvas.getByLabelText('Granola API key')).toHaveValue('');
  },
};
