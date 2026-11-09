# ADR-0016: Conversational commands preserve manual intent

- **Status:** Accepted
- **Date:** 2026-11-09
- Refines ADR-0007; no embedded chat or hosted inference is introduced.

## Context

The owner requires every manual semantic action to be available through an AI
command. Building the manual UI first left the conversational entry point late
in the plan. Existing MCP domain writes also omitted the protections added by
an equivalent manual edit.

## Decision

Bring the conversational command adapter forward before U5. Expose current UI
operations through MCP using the same authenticated core and Domain.execute.
Explicit user intent relayed through MCP protects edited fields like a manual
edit; the event actor remains mcp. Autonomous extraction remains actor ai and
retains its evidence and autonomy restrictions.

The adapter cannot configure its own access, register devices, record source
content, or unprotect fields. Access stays disabled without an explicit local
sharing acknowledgement and read-only unless writes are enabled. It supplies
stable retry tokens and returns event IDs for compensating undo.

## Consequences

Parity tests cover every current UI command and exact domain operations for a
manual versus conversational edit. Model interpretation and client interaction
still need an end-to-end usability review. This adapter does not complete P1's
scoped settings, one-click installation, headless startup or bundle integration.
