import { McpServer, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';
import { readJson } from '../../tools/reference/schemas.mjs';
import { createFixtureQuery } from './fixture-query.mjs';

const common = readJson('schemas/v1/common.schema.json').$defs;
const initiative = readJson('schemas/v1/initiative.schema.json').properties;
const id = z.string().regex(new RegExp(common.id.pattern));
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const failure = code => ({ isError: true, content: [{ type: 'text', text: code }] });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });

function queryHandler(query, method) {
  return async args => {
    try { return result(query[method](args)); }
    catch { return failure('NOT_FOUND'); }
  };
}

export function createServer(options = {}) {
  const query = options.query ?? createFixtureQuery(options);
  const server = new McpServer({ name: 'fulcrum-mcp-s6', version: '0.1.0' });
  server.registerTool('list_initiatives', {
    description: 'List synthetic Fulcrum initiatives and deterministic card state. Read only.',
    inputSchema: z.strictObject({ moscow: z.enum(common.moscow.enum).optional(),
      categoryId: id.optional(), lifecycle: z.enum(initiative.lifecycle.enum).optional() }), annotations: READ_ONLY,
  }, queryHandler(query, 'listInitiatives'));
  server.registerTool('get_graph', {
    description: 'Read the canonical synthetic initiative graph and available user actions.',
    inputSchema: z.strictObject({ initiativeId: id }), annotations: READ_ONLY,
  }, queryHandler(query, 'getGraph'));
  server.registerTool('get_evidence', {
    description: 'Read linked synthetic evidence. Source excerpts are off unless enabled at process launch.',
    inputSchema: z.strictObject({ target: z.strictObject({ kind: z.enum(common.target.properties.kind.enum), id }) }), annotations: READ_ONLY,
  }, queryHandler(query, 'getEvidence'));
  server.registerTool('probe_client_capabilities', {
    description: 'Report declared elicitation support for this synthetic read-only experiment; asks no questions and changes nothing.',
    inputSchema: z.strictObject({}), annotations: READ_ONLY,
  }, async (_args, context) => {
    const capabilities = context.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? server.server.getClientCapabilities() ?? {};
    return result({ elicitation: capabilities.elicitation ?? null, confirmationRoundTrip: 'not_tested', writes: 'disabled' });
  });
  return server;
}

export function parseOptions(args) {
  const options = { excerpts: 'disabled', initiativeIds: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--excerpts') { options.excerpts = 'enabled'; continue; }
    if (argument === '--initiative' && args[index + 1]) { options.initiativeIds.push(id.parse(args[++index])); continue; }
    throw new Error('Unknown option');
  }
  if (options.initiativeIds.length === 0) delete options.initiativeIds;
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    // Validate before attaching stdout so startup failures cannot corrupt protocol frames.
    const query = createFixtureQuery(options);
    serveStdio(() => createServer({ query }), { onerror: () => process.stderr.write('MCP protocol error\n') });
  } catch { process.stderr.write('S6 startup failed: check flags and synthetic fixture\n'); process.exitCode = 1; }
}
