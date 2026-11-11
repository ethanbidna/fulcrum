import type { SearchScope } from './interfaces.js';
export const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
const MAX_TERMS = 32;
export class IndexError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'INDEX_UNAVAILABLE', message: string) { super(message); }
}
export function searchInput(text: string, scope: SearchScope) {
  const validIds = (values: unknown) => Array.isArray(values) && values.every(value => typeof value === 'string');
  if (typeof text !== 'string' || text.length > MAX_QUERY_LENGTH || !scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).some(key => !['initiativeIds', 'kinds', 'limit', 'includeExcerpts'].includes(key))
    || (scope.initiativeIds !== undefined && !validIds(scope.initiativeIds))
    || (scope.kinds !== undefined && (!validIds(scope.kinds) || !scope.kinds.every(kind => ['initiative', 'node', 'entity', 'source'].includes(kind))))
    || (scope.includeExcerpts !== undefined && typeof scope.includeExcerpts !== 'boolean')
    || (scope.limit !== undefined && (!Number.isInteger(scope.limit) || scope.limit < 1 || scope.limit > MAX_LIMIT))) throw new IndexError('VALIDATION_FAILED', 'Invalid search input');
  const terms = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length > MAX_TERMS) throw new IndexError('VALIDATION_FAILED', 'Too many search terms');
  return { expression: terms.map(term => `"${term}"`).join(' AND '), limit: scope.limit ?? DEFAULT_LIMIT };
}
