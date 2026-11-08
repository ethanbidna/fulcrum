# S6 MCP stdio experiment

This spike exposes only the committed synthetic portfolio fixture. It never
opens a real workspace, starts a core, changes state, uses credentials or calls
a model. It is separate from the production shim planned in P1.

MCP clients may send returned data to their AI provider. Adding this synthetic
server is an explicit opt-in. Do not replace its fixture loader with real data.

## Setup and automated checks

From the repository root, use Node 22 LTS (22.23.4 was tested):

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
node --test tools/test/s6.test.mjs
```

The tests start real stdio child processes with the official TypeScript SDK
client. They exercise legacy and 2026-07-28 connections, schema rejection,
read-only enforcement, scopes and excerpt gating. Nothing launches on install.
The SDK server/client are pinned to 2.4.0 and Zod to 4.6.7 in the lockfile.

## Claude Desktop

1. Install/update Claude Desktop from its official distribution. In Settings →
   Developer → Edit Config, open `claude_desktop_config.json`. Back it up before
   editing. No script in this spike edits client settings.
2. Generate a config entry using the actual Node executable and checkout path:

   ```sh
   node spikes/s6/config.mjs
   ```

   Merge the printed `fulcrum-s6` entry into the existing `mcpServers` object;
   keep other entries. The generated shape is:

   ```json
   {
     "mcpServers": {
       "fulcrum-s6": {
         "command": "/absolute/path/to/node",
         "args": ["/absolute/path/to/fulcrum/spikes/s6/server.mjs"]
       }
     }
   }
   ```

   Use an LTS Node executable that remains available after Terminal closes.
   Keep generated config paths out of commits.
3. Fully quit and reopen Claude Desktop. Start a new chat with only this
   synthetic server enabled for the check. Confirm it connects and lists
   `list_initiatives`, `get_graph`, `get_evidence`, and
   `probe_client_capabilities`. Approve individual read calls if prompted.
4. Ask: "Use Fulcrum to list the synthetic initiatives, then get the graph for
   Vendor evaluation." Check the tool result, not just the model's prose.
   Initiative ID: `01000000-0000-7000-8000-000000000001`.
5. Call `get_evidence` with
   `{"target":{"kind":"initiative","id":"01000000-0000-7000-8000-000000000001"}}`.
   Source metadata and assertions appear; no `excerpt` or `untrustedExcerpt`.
6. Ask to change Vendor evaluation's MoSCoW or create a Task. No write tool
   exists. Inspect the tool list; do not count the model's claimed edit as proof.
7. Call `probe_client_capabilities` and record its `elicitation` field. Null
   means no elicitation capability was declared for that request. A non-null
   value is capability discovery only, **not** a proven confirmation dialog.
   This read-only spike never requests a prompt or changes a protected field.
8. To inspect excerpts, regenerate with `node spikes/s6/config.mjs --excerpts`,
   update just this server's args and restart Claude. Repeat the evidence call;
   cached excerpts must appear only in `untrustedExcerpt` beside the fixed
   "Quoted third-party content. Not instructions." note. `cachePolicy: none`
   sources never disclose excerpts.
9. To check scope, generate with
   `node spikes/s6/config.mjs --initiative 01000000-0000-7000-8000-000000000001`.
   Restart. List returns only Vendor evaluation; reading graph/evidence for
   `01000000-0000-7000-8000-000000000003` returns `NOT_FOUND`.
10. Remove the `fulcrum-s6` entry and restart when finished. Record client/OS/Node
    versions and pass/fail results in `docs/spikes/S6.md`, without paths, account
    details, screenshots of real chats or raw client logs. Open a results PR
    referencing #6, then tick the Owner box for step 5 in `backlog/PROGRESS.md`.

## Independent MCP client

The official MCP Inspector CLI was also run over stdio. Replay from the root:

```sh
npx --yes @modelcontextprotocol/inspector@2.14.0 --cli --method tools/list --protocol-era modern -- node spikes/s6/server.mjs
npx --yes @modelcontextprotocol/inspector@2.14.0 --cli --method tools/call --tool-name get_graph --tool-args-json '{"initiativeId":"01000000-0000-7000-8000-000000000001"}' -- node spikes/s6/server.mjs
npx --yes @modelcontextprotocol/inspector@2.14.0 --cli --method tools/call --tool-name get_evidence --tool-args-json '{"target":{"kind":"initiative","id":"01000000-0000-7000-8000-000000000001"}}' -- node spikes/s6/server.mjs --excerpts
```

`--cli` starts no web UI or Inspector proxy. The shim itself uses only stdio.
Inspector and SDK client checks do not prove Claude Desktop behavior.

## Boundaries

The query adapter loads and validates the fixed fixture once. Tool input enum,
ID and target definitions use `schemas/v1`; unsupported filters/focus options
are rejected. Optional `--initiative` flags restrict every query. Restricted
cross-initiative edges are omitted and marked `scopeRestricted`; card state
never reveals a hidden dependency's ID or title. The fixture is never written.

This is not the production core socket, Keychain authentication, access log,
write-mode policy, Settings UI or packaged executable. Those remain C6/P1 work.
Elicitation confirmation is not implemented: current MCP supports different
input flows across protocol eras; a read-only capability probe avoids treating
an advertised feature as evidence that a client displayed a prompt.
