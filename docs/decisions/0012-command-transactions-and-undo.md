# ADR-0012: Atomic commands and replayable undo

- **Status:** Accepted
- **Date:** 2026-11-08
- **Refines:** ADR-0005 replay details; ADR-0006/0007 authority boundaries

## Context

C3 turns the pure C2 rules into the shared command write path. The reference
fold rejected all creates after tombstones, preventing the documented undo
operation from restoring deleted records. Rejections have a signature rather
than an ID. Mandatory nullable MoSCoW also needs a different null treatment
from optional fields. Some records, notably edges, have no persisted
`protectedFields` property.

## Decision

- A command is prepared against isolated state, schema checked with the v1
  validators, policy checked, and invariant checked before any append. The
  persistence port assigns sequence/HLC and commits a complete batch durably
  or fails without acknowledging it. Subscribers run only after that commit.
- Question resolution is one event, including the selected child commands.
  Child commands retain the authenticated actor, pass the same validation and
  policy checks, and cannot embed undo. Recursive or oversized resolutions
  are rejected. AI cannot choose a user's resolution or change settings,
  devices, field protection, source records or remembered user rejections.
- Run undo prepares compensating events in reverse order and submits them in
  one atomic batch. Each has `undoOf` referring to its original event. A later
  write to an affected field prevents the whole batch. Timestamp maintenance
  and automatic protection additions do not count as competing user edits to
  another field. Undo preserves manual protection and adds a Rejection for
  each AI suggestion it reverses.
- A `create` with `undoOf` may restore a tombstoned record; an ordinary create
  still cannot. The live-record duplicate rule and event total order remain.
  The reference fold and production replay implement the same exception.
- Rejection collections are keyed by `signature`, including checkpoint loads.
- Null clears optional fields, including settings. A required nullable field
  (`initiative.moscow`) retains null. This corrects the reference fold to the
  existing v1 schema; no record or event encoding is added.
- Explicit field protection and manual edits can be derived from event
  history for records without `protectedFields`. Explicit protection changes
  are read from the audited command (including selected question resolutions),
  and undo restores their previous protection state. This does not execute
  stored commands during replay. C4 must retain enough history to rebuild
  these decisions and the undo preimages; a checkpoint alone is insufficient.
- The schema validators, local identity, model reconciliation proof, MCP scope,
  ID/clock functions and persistence port are trusted application dependencies.
  Source text and command arguments cannot supply or replace them. Validators
  use the canonical schemas with Ajv, rather than a second persisted contract.
- Idempotency returns the original event result, including a complete run-undo
  batch. A key cannot cross actor identities, and current MCP authorization is
  checked again before returning the saved result.

## Consequences

The core can be tested through `Domain.execute` with the real JSON Schemas and
an in-memory commit port, independently of the model and connectors. This does
not validate fsync, crash recovery or sync: those remain C4/S1 work. Existing
v1 fixture expectations are unchanged. These are pre-release replay corrections;
all readers must include them before any workspace writes are distributed.
