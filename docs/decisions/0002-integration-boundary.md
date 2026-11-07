# ADR-0002: Connectors behind a SourceAdapter interface; Activepieces is a candidate, not a foundation

- **Status:** **Provisional** — decided by spike S4
- **Date:** 2026-11-07

## Context
The spec prefers self-hosted Activepieces for Gmail, Slack, Granola (then Drive, Dropbox, Calendar), subject to validating auth, historical backfill, pagination, thread retrieval, deep links and local footprint. Fulcrum's ingestion needs **incremental pulls with cursors and backfill**, while Activepieces is designed around triggers and actions in flows. Self-hosting Activepieces typically means a server plus a database (and often Docker), which conflicts with "no infrastructure that costs more maintenance than it saves" and with non-technical installation.

## Decision
- Fulcrum owns a small `SourceAdapter` interface ([ARCHITECTURE.md](../ARCHITECTURE.md#module-contracts-typescript-abridged)): `scopes`, `pull(scope, cursor, limits)`, `permalink`.
- Connectors write **only** normalized `SourceItem`s; they never write initiative state.
- Activepieces may implement adapters in one of two ways, chosen by S4:
  - **(a) Pieces as libraries:** import individual MIT-licensed `@activepieces/piece-*` packages in the core and call their actions directly (no server). Reuses auth/API code without the runtime.
  - **(b) Self-hosted runtime:** only if it can run without Docker and within the Intel memory budget, packaged by the app.
- Otherwise, **native adapters** using each vendor's official SDK/API.
- A synthetic adapter (fixtures) exists from M1 so the pipeline is testable without accounts.

## Alternatives considered
- Activepieces as mandatory runtime — rejected until S4 proves footprint and capability.
- n8n / other workflow engines — same runtime burden; licenses vary (n8n is fair-code, not OSI).
- Per-vendor MCP servers as sources — interesting later; MCP servers are not designed for bulk incremental sync.

## Consequences
- Adding a connector = implementing four functions + tests against a recorded fixture.
- OAuth app registration and verification (Google restricted scopes, Slack app approval) remain real work regardless of the option (risk R8).

## Validation (S4)
Capability matrix per source × option: auth, refresh, backfill depth, cursor/incremental, threads/DMs, permalinks, rate limits, memory, install steps.
