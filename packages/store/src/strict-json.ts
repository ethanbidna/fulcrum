import { visit } from 'jsonc-parser';
import { StoreError } from './files.js';

export function strictJson(text: string): unknown {
  const objects: Set<string>[] = [];
  let invalid = false;
  visit(text, {
    onObjectBegin: () => { objects.push(new Set()); },
    onObjectEnd: () => { objects.pop(); },
    onObjectProperty: property => {
      const keys = objects.at(-1)!;
      if (keys.has(property)) invalid = true;
      keys.add(property);
    },
    onError: () => { invalid = true; },
  }, { disallowComments: true, allowTrailingComma: false });
  if (invalid) throw new StoreError('ENCRYPTION_FORMAT_INVALID', 'Invalid encrypted storage JSON');
  return JSON.parse(text) as unknown;
}
