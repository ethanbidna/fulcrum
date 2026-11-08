const DOMAIN_CODES = new Set(['VALIDATION_FAILED', 'INVARIANT_VIOLATION', 'POLICY_DENIED', 'PROTECTED_FIELD', 'NOT_FOUND', 'STALE_BASE', 'WORKSPACE_READ_ONLY']);
export function rpcFailure(id: string | number | null, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && DOMAIN_CODES.has(error.code) ? error.code : undefined;
  const safeMessage = ['UNAUTHORIZED', 'ACTOR_IS_AUTHENTICATED', 'METHOD_NOT_FOUND'].includes(message) ? message : 'REQUEST_FAILED';
  return { jsonrpc: '2.0', id, error: { code: error instanceof SyntaxError ? -32700 : -32600, message: safeMessage, ...(code ? { data: { code } } : {}) } };
}
