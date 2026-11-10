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

## Setup

Use Settings → MCP to acknowledge provider sharing, enable access and select
read-only/write mode, initiative/category scope, excerpts and question visibility.
Changes take effect without restarting. Missing local configuration disables MCP.
No MCP tool can change sharing settings or install a client.

The confirmed Add to Claude Desktop action merges the Fulcrum launch entry and
backs up the original configuration. Existing servers remain. Restart Claude
Desktop afterward. The shim reads the Keychain-held secret and connects to the
core; if needed it launches the bundled core from the private saved workspace
profile. The production package is supplied by P5. Building this adapter does
not enable sharing and does not prove native/Claude Desktop behavior.

For developer builds, Node 22 and `pnpm --filter @fulcrum/core build` produce
`apps/core/dist/core.mjs` and `mcp.mjs`. Launch the core using
`apps/core/README.md`; configure sharing in the connected UI. The installer uses
that built runtime and entry point. Do not commit generated client paths.

Read tools include list/get initiatives, graph, evidence, questions, objectives,
search and history. Generated command tools use `args` and `idempotencyKey`;
plain aliases such as `create_node`, `set_moscow` and `undo` use the same shape.
The advertised JSON schema is authoritative. Legacy `read_workspace` remains.
Scoped board/rail queries are denied; list/get/graph expose permitted records.
Cross-scope references deny a view rather than leak hidden work. Retained source
excerpts require opt-in and use `untrustedExcerpt` with a quotation notice.

MCP calls are logged without argument text, with outcomes and returned IDs.
Settings shows recent local activity; successful writes use actor MCP in History.
Elicitation-capable clients get confirmation before writes; other clients still
require explicitly enabled write access. Current/legacy SDK integration is
tested, but actual client presentation remains an owner check.

See [P1 verification and owner procedure](../../docs/reviews/P1.md).
