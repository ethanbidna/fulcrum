export const destinations = [
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'priorities', label: 'Priorities' },
  { id: 'questions', label: 'Questions' },
  { id: 'settings', label: 'Settings' },
] as const;
export type Destination = typeof destinations[number]['id'];
export function destinationFromHash(hash: string): Destination {
  const id = hash.replace(/^#\/?/, '');
  return destinations.find(destination => destination.id === id)?.id ?? 'initiatives';
}
