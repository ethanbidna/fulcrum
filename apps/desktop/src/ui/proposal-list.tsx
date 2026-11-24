import type { ExecuteCommand } from './new-initiative.js';

export interface Proposal { id: string; title: string }
type Decision = Parameters<ExecuteCommand>[0];

export const approveProposal = (id: string): Decision => ({ name: 'initiative.approve', args: { id } });
export const rejectProposal = (id: string): Decision => ({ name: 'initiative.setLifecycle', args: { id, lifecycle: 'rejected' } });

export function ProposalList({ proposals, disabled, decide }: { proposals: Proposal[]; disabled: boolean; decide: (command: Decision) => void }) {
  return <ul className="proposal-list">{proposals.map(item => <li key={item.id}>{item.title}
    <button className="secondary-button" disabled={disabled} onClick={() => decide(approveProposal(item.id))}>Approve {item.title}</button>
    <button className="secondary-button" disabled={disabled} onClick={() => decide(rejectProposal(item.id))}>Reject {item.title}</button>
  </li>)}</ul>;
}
