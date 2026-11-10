# ADR-0007: Local MCP server — stdio shim to the core, off by default, scoped and logged

- **Status:** Accepted · Client behavior **provisional** (S6)
- **Date:** 2026-11-07

## Context
MCP is the external conversational interface; ADR-0017 adds the in-app command bar. MCP clients like Claude Desktop forward tool results to a hosted model, so "local MCP server" does not mean "data stays local". UI and MCP must use the same domain commands.

## Decision
- `fulcrum-mcp` speaks MCP over **stdio** to the client and forwards to the core over a `0600` Unix socket authenticated with a Keychain-held secret. No network listener.
- MCP tools call the same `Domain.execute`/`query` as the UI; actor is `mcp`. No separate policy engine.
- **Disabled by default.** Enabling shows a disclosure that returned data may be sent to the client's AI provider.
- Defaults when enabled: **read-only**, all initiatives, **no source excerpts**. User can widen per category/initiative, enable writes, enable excerpts.
- Every call is logged locally; MCP writes appear in History and Meaningful changes; all undoable.
- Source excerpts are returned in an `untrustedExcerpt` field; never in tool descriptions or error strings.

## Alternatives
- Streamable HTTP on localhost — any local process or browser page could probe it; more auth work. Revisit only for clients that cannot use stdio.
- MCP as a separate process writing the workspace directly — rejected: two writers per device, duplicated validation.

## Consequences
- The core must be running (the shim starts it).
- Contract tests assert that an MCP write and the equivalent UI command produce identical ops (scenario 11).

## Validation (S6)
The [S6 spike](../spikes/S6.md) runs the official TypeScript SDK 2.4.0 over
stdio against a fixed synthetic fixture. SDK clients pass legacy/current
protocol reads, read-only rejection, scope checks and excerpt gating. MCP
Inspector 2.14.0 independently lists tools, reads a graph and receives wrapped
excerpts. Declared elicitation capabilities are observable; no confirmation
round trip or Claude Desktop session has been validated. Client behavior stays
provisional pending the owner checklist. Production socket authentication,
access logging and write confirmation remain C6/P1 work.


## Engineering checkpoint (2026-11-10)

P1 implements scoped live settings, disclosure, activity, confirmed install
and headless lifecycle with shared Domain policy/parity tests. MCP is the
external conversational interface; ADR-0017 also provides the in-app command
bar. Claude Desktop, real Keychain dialogs and packaged headless acceptance
remain owner checks; declared capabilities are not a rendered confirmation.
See [ADR-0026](0026-engineering-checkpoint.md) and [the evidence matrix](../CHECKPOINT.md).
