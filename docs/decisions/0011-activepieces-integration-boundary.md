# ADR-0011: Route source integrations through Activepieces

- **Status:** Accepted; [ADR-0027](0027-gmail-piece-execution.md) selects the Gmail execution mode
- **Date:** 2026-11-08
- **Supersedes:** [ADR-0002](0002-integration-boundary.md)

## Context

The owner clarified that source integrations must use the open-source
Activepieces tool. Granola should use its supported API by default, with CSV
only when API access cannot be provided. Earlier spike reports suggested native
provider adapters as an option; that recommendation is no longer the selected
direction. Their capability and permission findings remain useful evidence.

## Decision

- All source integrations go through Activepieces pieces behind Fulcrum's
  `SourceAdapter`. Reuse, extend or author a piece when capability is missing;
  do not silently bypass it with an independent native connector.
- Granola API access is the default. Explain eligible-plan/admin requirements.
  CSV is an explicit fallback for unavailable/denied/blocked API access and
  uses an Activepieces import piece as well.
- Fulcrum owns scope opt-in, bounded backfill, checkpointing, dedupe and source
  normalization. Integration output is untrusted data; only `Domain.execute`
  changes canonical state. No model or source may select arbitrary piece actions,
  API routes, credentials or recipients.
- Use the open-source edition/components. Hosted Activepieces is not enabled
  by default. Choose how to execute each piece using its measured capabilities
  and footprint. This ADR does not approve a daemon or database server.
- Preserve local inference, read-only source permissions, machine-local secrets
  and non-technical setup goals. Any conflict with the selected execution mode
  must be surfaced and resolved explicitly rather than hidden in a fallback.

## First connector

Gmail is first for personal use. [ADR-0027](0027-gmail-piece-execution.md)
records the execution mode and evidence for I2.

## Consequences and validation

The [S4 report](../spikes/S4.md) remains historical capability research; its
native-adapter recommendation is superseded here. Existing native probes are
test instruments, not the production integration route. The
[S5 report](../spikes/S5.md) records the Activepieces Granola piece and gaps in
cursor/scope/transcript support. Later connector work must test extensions,
OAuth/key handling, least privilege, crash recovery, offline catch-up, memory,
packaging and local secret handling. No connector implementation or runtime
installation is part of this decision update.
