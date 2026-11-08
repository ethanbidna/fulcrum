import type { FlowObject, WorkspaceStateDoc } from '@fulcrum/schema';

// The generated schema union permits optional discriminants; validated nodes do not.
export type Node = FlowObject & (
  | { type: 'task'; state: 'open' | 'done' | 'cancelled' }
  | { type: 'dependency'; state: 'waiting' | 'satisfied' | 'blocked' | 'expired' | 'unverified' | 'cancelled' }
  | { type: 'decision'; state: 'open' | 'decided' | 'cancelled'; decider: string; options: { id: string; label: string }[]; outcome?: string }
  | { type: 'milestone'; state: 'pending' | 'achieved' | 'missed' | 'cancelled' }
);
export type WorkspaceState = Omit<WorkspaceStateDoc['state'], 'nodes'> & { nodes: Node[] };
