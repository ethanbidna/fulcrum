# Workspace store (C4)

`FileWorkspaceStore` implements the filesystem driver and the domain's durable
commit port. It performs no domain commands or model calls.

```ts
const manifest = await FileWorkspaceStore.create(workspaceDirectory);
const store = new FileWorkspaceStore({
  localDirectory: machineLocalDirectory,
  deviceLabel: 'Desk Mac',
});
const opened = await store.open(workspaceDirectory);
```

The local directory must be outside the workspace and shared by all core
instances using the same machine profile. It holds `device.json`, `core.lock`
and local ownership metadata. The driver adds only `log/` and `checkpoints/`
to the portable workspace. `create` never replaces an existing manifest.

Application wiring (C6) supplies `store.commit` to `DomainPorts.commit`, uses
`opened.deviceId` as authenticated device identity, and runs `device.register`
through the domain when `registrationRequired` is true. It must honor read-only
and incomplete-workspace errors and stop ingestion when writes are unavailable.
Source content cannot choose local directories, clocks or writer identities.

- `commit(drafts)` assigns contiguous sequences and causal HLCs. `append(events)`
  accepts already assigned local events only when they extend the same history.
  Both acknowledge only after durable event publication and local sequence save.
- `read` / `readAll` return validated, deduplicated events and diagnostics, or an
  error with no partial authoritative state. Torn tails and identical conflicted
  copies are retained and reported. Missing ranges, placeholders and collisions
  block reading/writing until recovered.
- `writeCheckpoint` accepts an application-generated, schema-valid snapshot.
  `latestUsableCheckpoint` checks local coverage and ordering. Logs are retained
  for full replay and C3 undo/protection metadata even when a checkpoint exists.
- Bind `setCheckpointProvider(async () => domain.getSnapshot())` after creating
  the domain. The driver requests a snapshot after 500 acknowledged events and
  on orderly close; `checkpointDue` exposes the threshold. The callback must
  reflect the acknowledged domain state. Maintenance errors appear as
  `CHECKPOINT_WRITE_FAILED` and do not undo acknowledged events.
- `watch` combines native notifications with 500 ms polling. `close` refuses new
  writes, drains submitted work, checkpoints if configured, and releases the lock.

A write failure requires reopening. If the log advanced beyond the saved local
identity, open rotates the writer and reports `CLONED_DEVICE_ROTATED`; this can
also follow a crash before local metadata save. It does not prove another Mac
exists. Equal-frontier cloned writers remain an S1 limitation. Stale-lock
recovery waits for a dead owner's lock to age; an unverifiable/live owner is
never displaced automatically.

New event segments use no-replace hard-link publication. Multi-event batches
must fit within 1 MiB. Checkpoints use atomic rename. A filesystem lacking the
required operation returns a failure, with no unsafe publication fallback.
Schema assets from `schemas/v1/` must accompany the compiled driver; packaging
those assets is C6 work.

Run `pnpm check`. The storage suite has real filesystem tests and three compiled
child-process SIGKILL tests; these demonstrate local process-crash recovery,
not power-loss recovery or real Dropbox/Google Drive synchronization. See
[ADR-0013](../../docs/decisions/0013-workspace-store-publication.md) and the
[S1 findings](../../docs/spikes/S1-findings.md).
