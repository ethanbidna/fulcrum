# ADR-0027: Run the Gmail piece in Fulcrum's local core

- **Status:** Accepted for Gmail implementation on merge
- **Date:** 2026-11-13
- **Refines:** [ADR-0011](0011-activepieces-integration-boundary.md) for Gmail

## Decision

For I2, run a Fulcrum-owned read-only Activepieces Gmail piece in the local
TypeScript core behind `SourceAdapter`. Register only the actions needed for
ingestion. The first connector needs no Activepieces server, container, or
hosted OAuth relay. Slack and Granola retain their existing decisions.

Fulcrum opens OAuth in the system browser, verifies the account and granted
scope, stores refresh credentials in macOS Keychain, and passes short-lived
access tokens to the piece. Google grants mailbox-wide read access with
`gmail.readonly`. Fulcrum explains that distinction and limits ingestion to
the user's selected label. The core owns backfill bounds, pagination, durable
cursors and dedupe. Source content cannot choose actions or request routes.

## Evidence

The [library probe](../spikes/S4-results/gmail-library.md) found gaps in the
stock Gmail piece's scope and pagination. The read-only extension passed
synthetic restart checks and [live OAuth, backfill and incremental sync](../spikes/S4-results/gmail-desktop.md)
with a test account. The local Node development server reached 174.3 MiB in
a sampled one-message backfill.

The [self-hosted comparison](../spikes/S4-results/activepieces-runtime.md)
measured 1.04 GiB idle container memory on an Intel Mac and a 2.20 GiB
image. The stock OAuth definition requested write permissions, so the
runtime did not connect to Gmail. The memory figures use different
measurement boundaries and workloads. Together the results support choosing
the direct path for read-only Gmail on the desktop.

## I2 acceptance

Verify browser consent, Keychain persistence and removal, explicit label
selection, bounded backfill, restart and incremental catch-up, and packaged
execution. Cover failures and pagination with synthetic provider responses.
The Gmail API probe found no documented exact web permalink. Validate an
open-original fallback and record its precision or leave the permalink
criterion open. Never fabricate an exact link.

This decision selects the implementation route. Step 6 still requires
owner review of its evidence and cases that did not run. Release packaging,
distribution approval, and live behavior of the production connector remain
open.
