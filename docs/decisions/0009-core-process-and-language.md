# ADR-0009: A single TypeScript core process per Mac owns all writes

- **Status:** Accepted · Packaging **provisional** (S7)
- **Date:** 2026-11-07

## Context
The UI, MCP clients and background ingestion all need the same domain logic. MCP and ingestion must work without a window. Two writers on one device would need cross-process coordination.

## Options
1. **Domain in the webview** — simple at first, but MCP and background work then require the window, and a second process would need its own copy.
2. **TypeScript core sidecar** (Node or Bun standalone executable) — one language across UI, domain, MCP SDK; domain types shared with the UI.
3. **Rust core inside the Tauri shell** — smallest runtime, but splits the codebase into two languages and slows iteration; MCP SDK and Ajv-equivalent ecosystem thinner.

## Decision
Option 2. `fulcrum-core` is a TypeScript process holding an exclusive lock per Mac; UI (via the Rust shell's socket proxy) and `fulcrum-mcp` are clients over a Unix socket with JSON-RPC. The domain package is pure TypeScript with no runtime-specific APIs, so it also runs in tests and in the browser dev harness.

## Consequences
- Adds a ~50–90 MB executable to the bundle (to be measured).
- SQLite access from the core: prefer built-in `node:sqlite` (or `bun:sqlite`) to avoid native-module packaging; FTS5 availability must be confirmed in S7.
- If S7 fails (size, startup, signing), fall back to Rust for the store/index drivers while keeping the TypeScript domain in the webview + a headless mode — revisit via a new ADR.

## Validation (S7)
The [S7 report](../spikes/S7.md) records an Intel Node SEA executable that passes
an embedded SQLite FTS5 query and Unix-socket handshake. Its smoke size is about
110 MiB, above the earlier unmeasured estimate. Bun, the Tauri shell, complete
RSS, universal execution and signing remain unverified; no packaging runtime
selection or fallback decision is accepted from this sample.
