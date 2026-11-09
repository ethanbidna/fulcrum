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
  return /^#initiatives\/([0-9a-f-]{36})(?:\/focus\/[0-9a-f-]{36}|\/(?:list|history))?$/i.exec(hash)?.[1];
}

export function focusedNodeFromHash(hash: string): string | undefined {
  return /^#initiatives\/[0-9a-f-]{36}\/focus\/([0-9a-f-]{36})$/i.exec(hash)?.[1];
}

export type InitiativeView = 'flow' | 'list' | 'history';
export function initiativeViewFromHash(hash: string): InitiativeView {
  return /\/list$/.test(hash) ? 'list' : /\/history$/.test(hash) ? 'history' : 'flow';
}
