# ADR-0013: Durable workspace publication and recovery

- **Status:** Accepted
- **Date:** 2026-11-08
- **Refines:** ADR-0005 and ADR-0012

## Context

C4 must turn the command layer's commit port into acknowledged filesystem
writes. Ordinary appends cannot publish a multi-event run undo atomically:
a concurrent reader might observe complete earlier lines before the rest of
the batch. Sync may also deliver a same-name segment between checking its
existence and publishing it. S1 identified placeholder and identity-recovery
limits that must remain explicit.

## Decision

- Keep all machine state outside the workspace. One `proper-lockfile` core
  lock covers a local profile; device identity and lock ownership are local.
  A live owner PID prevents stale-heartbeat takeover, including after sleep.
  Lock compromise stops further writes. A dead owner's stale lock is reclaimed
  after its timeout. PID reuse or unverifiable ownership fails closed; no
  unrelated process is signaled.
- Single events append and fsync an existing compatible daily segment. Rotate
  at a day boundary, before exceeding 1 MiB, or after a torn tail. Never repair
  shared bytes in place or append onto a torn tail.
- A new segment is written and fsynced under an ignored temporary name, then
  published by an atomic **no-replace hard link**, followed by directory fsync.
  Remove the temporary link afterward. This prevents an incoming same-name
  segment from being replaced. A multi-event batch always uses its own segment
  so readers see the whole batch or none. A transaction larger than 1 MiB is
  rejected before publication; callers can undo individual changes instead.
- Update local acknowledged sequence metadata before returning success. Any
  write error requires reopening before another append. A crash after durable
  publication but before identity persistence can look like a clone; rotate
  conservatively rather than risking another writer's log.
- Read every final segment, including conflicted copies. Dedupe identical event
  bytes; reject ID/sequence collisions, wrong-device placement, missing sequence
  ranges, unreadable/empty placeholders and symlinked workspace children. Ignore
  unterminated tails and temporary files. Retry reads whose inventory changed.
  This cannot prove that a sync provider has exposed every remote file name.
- Checkpoints use fsync, atomic rename and directory fsync, retaining the newest
  three per device. A trusted application snapshot provider enables checkpoint
  maintenance after 500 events and on orderly close. Maintenance failure is a
  diagnostic; acknowledged events remain in the log. Never delete event logs.
- Select checkpoints only when their contiguous frontiers are locally present,
  their maximum HLC matches covered events and every outside event sorts later.
  Keep the complete event history available to rebuild C3 undo/protection
  metadata. Checkpoints are optional caches, not an alternative authority.
- Newer workspaces are read-only only when the minimum-reader contract permits
  the installed reader and the data remains decodable. Unsupported minimum
  versions or encryption are refused; no partial authoritative state is shown.
- Native filesystem notifications have a 500 ms polling fallback. Stop accepting
  new commits before draining existing writes and releasing the core lock.

## Consequences and validation limits

Local tests use the real filesystem, canonical schemas and compiled child
processes killed during append, checkpoint creation and batch publication.
The cross-device golden fixture passes unchanged through the store and
reference fold. C3 executes against the actual commit port and survives reopen.
No schema migration or new event encoding is introduced.

Dropbox/Drive behavior, hard-link support on streamed folders, placeholder
hydration races, latency and equal-frontier cloned writers remain S1 hardware
checks. `proper-lockfile` and application liveness checks do not establish
successful two-Mac synchronization. Unsupported filesystems fail the write;
they never fall back to replacing an authoritative segment.
