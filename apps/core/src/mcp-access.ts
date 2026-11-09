import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { CONVERSATIONAL_COMMANDS } from '@fulcrum/mcp';
import type { CommandName } from '@fulcrum/domain';
export interface McpAccess { enabled: boolean; readOnly: boolean; sharingAcknowledged: boolean }
export interface McpOperations { query(name: string, args: unknown): Promise<unknown>; execute(command: unknown): Promise<unknown> }
const QUERIES = new Set(['portfolio.list', 'portfolio.board', 'portfolio.rail', 'initiative.get', 'node.get', 'graph.get', 'graph.focus', 'inspector.get', 'history.list', 'search']);
export function validateMcpAccess(value: unknown): McpAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MCP_ACCESS');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['enabled', 'readOnly', 'sharingAcknowledged'].includes(key)) || Object.values(fields).some(item => typeof item !== 'boolean') || typeof fields.enabled !== 'boolean' || typeof fields.readOnly !== 'boolean' || typeof fields.sharingAcknowledged !== 'boolean' || fields.enabled && !fields.sharingAcknowledged) throw new Error('INVALID_MCP_ACCESS');
  return fields as unknown as McpAccess;
}
export function createMcpAccess(access: McpAccess | undefined, operations: McpOperations, localDirectory: string) {
  if (access) validateMcpAccess(access);
  const requireAccess = () => { if (!access?.enabled || !access.sharingAcknowledged) throw new Error('MCP_DISABLED'); };
  const log = (tool: string) => appendFile(path.join(localDirectory, 'mcp-access.log'), `${JSON.stringify({ at: new Date().toISOString(), tool })}\n`, { mode: 0o600 });
  return {
    query: async (name: string, input: unknown) => {
      requireAccess(); if (!QUERIES.has(name)) throw new Error('MCP_QUERY_DENIED');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_MCP_ARGUMENTS');
      const args = input as Record<string, unknown>;
      await log(name);
      const result = await operations.query(name, name === 'search' ? { ...args, scope: { ...(args.scope as object), includeExcerpts: false } } : args);
      if (name === 'history.list') return (result as { changes: { kind: string }[]; [key: string]: unknown }[]).map(entry => ({ eventId: entry.eventId, actor: entry.actor, at: entry.at, changes: entry.changes.filter(change => ['initiative', 'node', 'edge', 'group', 'category', 'objective', 'question'].includes(change.kind)) }));
      return result;
    },
    execute: async (input: unknown) => {
      requireAccess(); if (access!.readOnly) throw new Error('MCP_READ_ONLY');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_MCP_COMMAND');
      const command = input as Record<string, unknown>;
      if (Object.keys(command).some(key => !['name', 'args', 'idempotencyKey'].includes(key)) || !CONVERSATIONAL_COMMANDS.includes(command.name as CommandName) || typeof command.idempotencyKey !== 'string' || !command.idempotencyKey.trim()) throw new Error('MCP_COMMAND_DENIED');
      await log(String(command.name));
      return operations.execute({ ...command, actor: 'mcp' });
    },
  };
}
