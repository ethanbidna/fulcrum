import type { InspectionTarget } from '@fulcrum/domain';
export const destinations = [
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'priorities', label: 'Priorities' },
  { id: 'questions', label: 'Questions' },
  { id: 'settings', label: 'Settings' },
] as const;
export type Destination = typeof destinations[number]['id'];
export function destinationFromHash(hash: string): Destination {
  const id = hash.replace(/^#\/?/, '').split('/')[0];
  return destinations.find(destination => destination.id === id)?.id ?? 'initiatives';
}

export function initiativeFromHash(hash: string): string | undefined {
  return /^#initiatives\/([0-9a-f-]{36})(?:\/focus\/[0-9a-f-]{36}|\/(?:list|history|context|timeline)|\/inspect\/(?:node|edge)\/[0-9a-f-]{36})?$/i.exec(hash)?.[1];
}

export function focusedNodeFromHash(hash: string): string | undefined {
  return /^#initiatives\/[0-9a-f-]{36}\/focus\/([0-9a-f-]{36})$/i.exec(hash)?.[1];
}

export type InitiativeView = 'flow' | 'list' | 'history' | 'context' | 'timeline';
export function initiativeViewFromHash(hash: string): InitiativeView {
  return /\/timeline$/.test(hash) ? 'timeline' : /\/context$/.test(hash) ? 'context' : /\/list$/.test(hash) ? 'list' : /\/history$/.test(hash) ? 'history' : 'flow';
}

export function questionInitiativeFromHash(hash: string): string | undefined {
  return /^#questions\/([0-9a-f-]{36})$/i.exec(hash)?.[1];
}
export function inspectionFromHash(hash: string): InspectionTarget | undefined {
  const match = /^#initiatives\/[0-9a-f-]{36}\/inspect\/(node|edge)\/([0-9a-f-]{36})$/i.exec(hash);
  return match ? { kind: match[1] as 'node' | 'edge', id: match[2]! } : undefined;
}
