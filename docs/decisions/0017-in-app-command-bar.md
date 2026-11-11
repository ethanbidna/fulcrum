# ADR-0017: Local command bar with reviewed plans

- **Status:** Accepted
- **Date:** 2026-11-09
- Supersedes the exclusive-MCP conversational entry point in ADR-0007/0016.

## Context

The owner explicitly requires BOTH external MCP and an in-app command bar, and
wants less reliance on buttons and dropdowns. A command bar is a request/review
interaction in the workspace, without an ongoing embedded chat transcript.

## Decision

Use a local ModelRuntime behind a driver to draft current domain commands. Keep
model, transport, scope, identity, evidence and application authority out of model
output. The core supplies bounded canonical context; unknown/internal actions,
model-selected metadata and invalid records are rejected. Context labels are
untrusted data. No model response is applied automatically.

The user reviews named changes and before/after values, then explicitly applies
one atomic command.apply through Domain.execute. It records the exact user
request as a manual evidence source, links that evidence and a run ID to the
event, and protects fields as user-approved intent. Actor user denotes that
explicit approval; autonomous ingestion remains actor ai. Undo compensates the
whole reviewed command, including its evidence record. Existing v1 op/event
contracts support this additional command name; no schema change is required.

Plans expire and require an unchanged canonical frontier. Retry returns the same
acknowledged result. Generation is an asynchronous job, keeping canonical reads
available; cancellation/disconnection aborts the request. All model HTTP traffic
is loopback-only, bounded by a deadline and fixed startup model configuration.

## Consequences

The command input leads; manual edit forms remain a secondary fallback. The
external MCP adapter remains separately disabled/scoped by its own access path.
No sharing, hosted inference or client setup is enabled by the command bar.

The initial Qwen3 4B model is provisional and swappable through ModelRuntime;
this is not model adoption or hardware acceptance. Local inference speed and
model interpretation must be measured separately from deterministic command
validation. Ambiguous or unsupported requests retain the text for clarification.
