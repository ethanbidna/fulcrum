# ADR-0030: Separate managed connections from ingestion

- **Status:** Accepted for driver implementation; desktop adoption pending
- **Date:** 2026-11-24
- **Refines:** [ADR-0029](0029-managed-connector-oauth-spike.md)
- **Related:** [ADR-0011](0011-activepieces-integration-boundary.md), [ADR-0027](0027-gmail-piece-execution.md)

## Decision

Implement a reusable Activepieces connection driver for Gmail, Slack, Granola,
Google Drive, Dropbox and Google Calendar. Ordinary connection setup belongs
in Fulcrum. Vendor consent may identify Activepieces; its dashboard and flow
builder must not open. Use normal Community Edition APIs, not the Enterprise
embedding SDK or modifications to plan gates.

The driver accepts an explicitly configured, owned IPv4 loopback runtime. It
has no arbitrary HTTP proxy, action execution, flow creation or ingestion API.
A successful connection returns a credential-free receipt with ingestion
blocked. This driver alone does not install, start or adopt a runtime.

Generate the runtime's local identity and save it through a secure-store
interface before first signup. Restore it through sign-in on restart; refresh
an expired session once. A provisioned identity must never fall back to signup.
An already-owned instance's signup rejection remains an error. Bind the saved
identity to its runtime origin. Native composition must implement the interface
with machine-local Keychain storage, never synced preferences.

For OAuth, require the shared catalog entry, the expected provider endpoint,
client ID, hosted redirect and exact read scopes. Remove Slack's embedded
`user_scope`: the stock definition includes separate user write grants. Initial
Slack access is public channels accessible to the bot, not private channels or
DMs. Granola uses a user-supplied API key in the local encrypted connection;
OAuth scope checks cannot restrict the permissions of that key.

Attempts expire after five minutes, are single-use, and can be cancelled.
Starting another attempt for the same source invalidates its predecessor.
Only approved source policies choose pieces and permissions. Source content
cannot select routes, tools, settings or recipients.

## Why ingestion stays gated

The stock runtime persists action output in flow-run logs. Its MCP action path
also records payloads. Running locally does not satisfy Fulcrum's promise that
full source text is transient. Deleting logs after processing leaves a window
and crash residue, so it is not an accepted substitute.

Before automatic ingestion, implement and verify an execution path without
persistent full-body output, or propose an explicit product/privacy change.
Continue to use bounded `SourceAdapter` reads, opted-in scopes, durable cursors,
backoff, dedupe and `Domain.execute`. A connection receipt is not evidence of
those behaviors or of narrowed granted tokens.

## Adoption and migration

ADR-0027 remains the active Gmail ingestion implementation. Do not erase an
existing Gmail connection or replace it silently. Desktop adoption needs a
separate tested composition: owned-runtime install/resource handling, native
Keychain implementation, short-lived browser callback, settings/onboarding,
restart/disconnect, explicit scope selection, and packaged execution.

The hosted OAuth relay handles code exchange and refresh and can see
credentials. Disclose that before connection. Shared catalog presence is an
availability observation, not a guarantee of distribution terms, plan access
or future service availability.

Evidence, source pins and acceptance gates are maintained in the
[integration record](../integrations/ACTIVEPIECES.md). No persisted workspace
schema changes are part of this decision.


## Native core composition

The November 24 continuation implements the secure-store interface and
administration composition, while leaving desktop adoption pending. Use one
machine-local runtime login in Keychain, with workspace-specific connection
external IDs and local receipts. Treat missing credentials differently from
access denial. A private installer-owned loopback configuration enables the
composition; there is no arbitrary-server control in the administration API.

Persist pending-source markers before grant exchange and recover through bounded,
namespace-checked connection metadata lookup. Restore reports saved receipts
without signing in. Connector network waits run outside the canonical write
queue. Cancellation/shutdown invalidates attempts and cleans up late grants.
No source reads, runtime installer or browser callback is adopted by this unit.

The next connection-UI unit adds the temporary browser handoff and shared
Settings/onboarding controls under [ADR-0031](0031-managed-browser-handoff.md).
Runtime installation and managed ingestion remain separate gates.
