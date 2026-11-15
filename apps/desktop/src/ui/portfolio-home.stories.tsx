import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { projectBoard } from '@fulcrum/domain';
import type { FreshnessStatus } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import { Portfolio } from './portfolio.js';
import { workshopFixture } from './workshop-fixture.js';
import './tokens.css';

const fixture = workshopFixture();
const full = projectBoard(fixture.snapshot.state, [], { now: '2026-11-10T12:00:00Z' });
const empty = { ...full, cards: [], questionCounts: {}, rail: { ...full.rail, questionCount: 0 } };
const PROPOSAL_ID = '0a000000-0000-7000-8000-000000000001';
function serve(freshness: Pick<FreshnessStatus, 'state' | 'label'>, proposals: { id: string; title: string }[] = []) {
  return fn(async (name: string) => name === 'status.freshness' ? { checkedAt: null, pending: 0, failed: 0, ...freshness }
    : name === 'portfolio.list' ? proposals.map(initiative => ({ initiative })) : []) as unknown as CoreTransport['query'];
}
const meta = { title: 'Portfolio/First look', component: Portfolio, args: { board: empty, execute: fn(), query: serve({ state: 'disabled', label: 'No source scopes enabled' }) }, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Portfolio>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoSourcesConnected: Story = { play: async ({ canvas }) => {
  await canvas.findByRole('heading', { name: 'Connect a source to get started' });
  await expect(canvas.getByRole('link', { name: 'Connect a source' })).toHaveAttribute('href', '#settings');
  await expect(canvas.queryByRole('button', { name: 'New initiative' })).not.toBeInTheDocument();
} };
export const ReadingSources: Story = { args: { query: serve({ state: 'catching-up', label: 'Catching up — 12 items' }) }, play: async ({ canvas }) => { await canvas.findByRole('heading', { name: 'Reading your sources…' }); await canvas.findByText('Catching up — 12 items'); } };
export const ProposalsAndQuestions: Story = {
  args: { board: { ...empty, rail: { ...empty.rail, questionCount: 2 } }, query: serve({ state: 'current', label: 'Up to date' }, [{ id: PROPOSAL_ID, title: 'Synthetic proposed initiative' }]) },
  play: async ({ canvas, userEvent, args }) => {
    await canvas.findByRole('link', { name: '2 questions need your answer' });
    await expect(args.execute).not.toHaveBeenCalled();
    await userEvent.click(await canvas.findByRole('button', { name: 'Approve Synthetic proposed initiative' }));
    await expect(args.execute).toHaveBeenCalledWith({ name: 'initiative.approve', args: { id: PROPOSAL_ID } });
  },
};
export const PopulatedPortfolio: Story = { args: { board: full, query: serve({ state: 'current', label: 'Up to date' }) }, play: async ({ canvas }) => { await canvas.findByText('Up to date'); } };
