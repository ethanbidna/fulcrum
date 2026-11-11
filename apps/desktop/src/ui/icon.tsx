import type { Destination } from './navigation.js';
const paths: Record<Destination, string> = {
  initiatives: 'M3 3h6v6H3z M13 3h6v6h-6z M3 13h6v6H3z M13 13h6v6h-6z',
  priorities: 'M4 5h14 M4 11h10 M4 17h6',
  questions: 'M8 7a3 3 0 0 1 6 0c0 2-3 2-3 4 M11 15v.1 M20 11a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  settings: 'M3 6h16 M3 16h16 M7 3v6 M15 13v6',
};
export function Icon({ name }: { name: Destination }) {
  return <svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
