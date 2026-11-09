# Conversational commands

The MCP adapter exposes the desktop's semantic actions to an AI client. Ask for
work in the client; use the canvas to inspect and adjust it. No model is embedded
here. No AI client or sharing permission is enabled by building the adapter.

Examples for a configured client:

- “Create an initiative called Synthetic release planning with these three Tasks.”
- “The review depends on the draft. Link them, then show the graph.”
- “Add a Decision with proceed and stop options; don't choose an outcome.”
- “Rename the draft, complete its checklist child, then undo the last change.”

Tools read canonical IDs before changes. Each public command tool takes `args`
and a unique `idempotencyKey`. Retry with the same token and identical arguments.
Successful writes return an `eventId`; `change_undo` compensates that change.
Creation tools describe the required fields and states; validation remains in
the domain. Manual and conversational edits preserve the same field protections.
Others' work is a Dependency, never an assigned Task.

## Developer preview

Node 22 and `pnpm --filter @fulcrum/core build` produce `apps/core/dist/core.mjs`
and `mcp.mjs`. Start the core using the existing apps/core/README.md procedure.
The stdio adapter requires that core to be running; automatic startup and bundle
installation remain P1 work. Do not connect the development browser bridge.

Before any client setup, review the disclosure: **an MCP client may send every
returned work record to its AI provider. Fulcrum's local execution does not keep
that client's processing local.** This preview supports the whole workspace,
with no source excerpts. Selected initiative/category scopes and excerpt opt-in
are not available yet; use a disposable synthetic workspace for this preview.

Access is configured only by the local user in the machine-local Fulcrum
application-support directory, outside the portable workspace. The optional
`mcp-access.json` must be a regular owner-only 0600 file containing exactly:

```json
{"enabled":true,"readOnly":true,"sharingAcknowledged":true}
```

Do not create it until accepting the disclosure. Restart the core after changing
it. `readOnly:false` explicitly enables writes; missing configuration disables
all MCP reads and writes. Remove the file and restart to disable. The adapter
cannot change these settings. Client configuration launches Node 22 with the
absolute built `mcp.mjs` path and no credential arguments; the shim reads the
existing Keychain secret. Do not commit generated paths or client configuration.
No live Keychain/client setup is performed by tests.

The core's local `mcp-access.log` records time and requested tool, without argument
content. Rich activity UI, returned-record ID logging and scoped settings remain
P1 work. History records successful writes as actor mcp; source/assertion history
payloads and search excerpts are withheld from this preview.

## Verification

The protocol integration tests use the official MCP client/server, a real private
Unix socket, and disposable file-backed workspaces. They cover create/read/edit,
retry, undo, actor attribution, disabled/read-only rejection and actor spoofing.
A separate regression compares exact manual/conversational domain operations.
This proves the command path, not a particular model's interpretation or an
actual Claude Desktop session. P1 and its Owner check remain incomplete.
