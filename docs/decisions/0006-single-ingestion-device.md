# ADR-0006: One designated ingestion device per workspace

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
If two Macs both pull the same sources and run extraction, they would create duplicate assertions, race on reconciliation and double the AI changes (and double model cost). Connector credentials also must not be synced.

## Decision
- `settings.ingestionDeviceId` (a synced workspace setting) names the only device that may run connectors and AI reconciliation (policy P11).
- Other devices are viewer/editor: full manual editing, MCP, local index; no pulls.
- Moving ingestion: "Make this Mac the ingestion device" in Settings writes the setting; the new device must reconnect sources (credentials are Keychain-local) and backfills from a bounded window. Source dedupe by `(connector, remoteId)` prevents duplicates across the hand-over.
- If both devices change the setting concurrently, the normal LWW rule picks one and a material `sync_conflict` Question is raised; until resolved, only the winner ingests.
- Stale detection: if the ingestion device has not appended an event for N days (default 7), other devices show "Desk Mac hasn't checked sources since …" with an offer to take over.

## Consequences
- Simple and predictable. An always-on Mac can be the ingestion device later with no design change.
- Ingestion stops while that Mac sleeps — stated honestly in the freshness label.
