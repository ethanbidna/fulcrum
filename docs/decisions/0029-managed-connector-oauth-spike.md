# ADR-0029: Test managed OAuth with local connectors

- **Status:** Accepted for an isolated experiment only
- **Date:** 2026-11-21
- **Related:** [ADR-0011](0011-activepieces-integration-boundary.md), [ADR-0027](0027-gmail-piece-execution.md)

## Context

The owner rejected making users register Google OAuth clients or relying on
an unverified Fulcrum client for distribution. Importing Activepieces pieces
does not delegate account connections to Activepieces. The owner authorized
testing a self-hosted runtime using Activepieces' hosted OAuth apps.

## Decision

Run a disposable Community Edition instance on loopback with hosted OAuth
explicitly enabled and telemetry disabled. Use a synthetic Gmail account,
select read-only permissions before consent, and test bounded retrieval.
Do not expose a public tunnel, run inference, or connect a real mailbox.

The hosted OAuth service handles authorization-code exchange and refresh.
That service can see credentials; local connector execution does not make
authentication fully local. Inspect the actual consent screen and granted
scope rather than assuming a read-only action implies read-only access.

Record results in [the S4 managed OAuth report](../spikes/S4-results/managed-oauth.md).
Separate authentication, retrieval, and model-processing measurements.

## Dashboard-free follow-up

The owner also authorized testing a Fulcrum-owned connection screen. A fresh
Community Edition instance is provisioned through its normal local signup API;
the proof generates the Google authorization URL, saves the connection, lists
the synthetic label, creates an unpublished fixed read flow and reads its
execution output through local APIs. No Enterprise embedding SDK, plan-gate
changes or Activepieces dashboard is part of that flow.

The live browser proof returned three synthetic messages. This establishes
technical feasibility for the pinned version. Production packaging, durable
local identity/Keychain handling and shared-app distribution support remain
separate adoption requirements.

## Adoption gate

This experiment does not supersede ADR-0027 or add a runtime to Fulcrum.
Production adoption requires a follow-up decision covering shared-app
availability/terms, permission enforcement, installation/resource costs,
token custody, bounded backfill, durable catch-up, and output retention.
Fulcrum must continue treating connector output as untrusted input through
`SourceAdapter`; only `Domain.execute` changes canonical state.
