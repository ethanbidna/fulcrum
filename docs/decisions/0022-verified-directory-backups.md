# ADR-0022: verified directory backups

- **Status:** Accepted with the P4 implementation PR
- **Date:** 2026-11-10
- **Refines:** ADR-0005 backup container and WORKSPACE_FORMAT.md

## Decision

Use machine-local private directories containing a verified portable workspace
copy and a completion receipt, rather than the earlier proposed zip container.
Reuse the existing schema, inventory and full-history reader to validate both
sides. Compare exact file hashes, events and stable source inventories before
publishing the receipt. A partial candidate is never listed as a completed
backup. Credentials, indexes, profiles and exports are excluded.

Daily and weekly schedules are opt-in and run while the core is awake. Keep
14 completed daily and 8 completed weekly copies per workspace; retain manual
copies. Prune only after the new copy is verified and its receipt is durable,
protecting that new copy even after a clock rollback. A failed backup never
starts retention cleanup. Incomplete candidates remain for explicit inspection.

Restore copies retained log bytes to a fresh workspace UUID, omits old identity
checkpoints and publishes the new manifest last. Reopen and compare complete
history before acknowledging the new copy. Keep the original and backup. The
read-only historical preview folds retained events without changing either.

## Consequences

Directories consume uncompressed disk but remain inspectable with the existing
portable format and avoid a second archive/extraction contract. Directory fsync
and private permissions use existing driver primitives; no dependency or service
is added. A second backup destination remains deferred to a native destination
flow; do not silently copy content into another sync root. Provider completeness,
real two-Mac behavior and encrypted backup support retain their separate gates.

The P4 tests use synthetic real filesystem copies and injected interruption/
write-failure boundaries. They do not establish new process-kill, hardware,
provider or encryption acceptance. Existing v1 schemas and event semantics stay
unchanged. This decision changes the planned backup container explicitly; it
does not assert that the earlier zip behavior was implemented.
