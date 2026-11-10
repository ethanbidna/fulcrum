# Portable workspace format

> *(provisional — spike S1).* The layout and merge rules below are implemented in the reference model and pass the fixtures in [`fixtures/workspace-example/`](../fixtures/workspace-example), but have **not** been tested under real Dropbox or Google Drive clients on two Macs.

## Principles

1. **Only create or append; never rewrite a shared file.** Sync clients handle new files and single-writer appends well and concurrent rewrites badly.
2. **Each device writes only its own files.** No two Macs ever write the same path, so the sync client never has to merge content.
3. **Events are the authority.** Checkpoints and the SQLite index are caches that can be deleted and rebuilt.
4. **Merge is deterministic.** Any device folding the same set of events produces byte-identical state.
5. **Nothing machine-specific in the workspace**: no credentials, absolute paths, indexes, models, connector databases or cursors.

## Layout

```text
<Workspace folder>/
  workspace.json                        # manifest; written at creation and migration only
  log/
    <deviceId>/
      2026-11-06-000001.jsonl           # append-only segment: one ChangeEvent per line
      2026-11-07-000014.jsonl           # new segment per day or at 1 MiB; name = date + first seq
  checkpoints/
    <deviceId>/
      <maxHlc>.json                     # WorkspaceStateDoc; keep the newest 3 per device
  exports/                              # optional human-readable exports (never read back)
```

Machine-local (never in the workspace): `~/Library/Application Support/Fulcrum/` → `device.json`, `core.lock`, `index.sqlite`, `context/`, `connectors/` (cursors, runtime data), `mcp-access.log`, `backups/`.

## Change events

Schema: [`change-event.schema.json`](../schemas/v1/change-event.schema.json). One event = one command (or one atomic batch, e.g. a question resolution that runs two commands).

| Field | Purpose |
|---|---|
| `eventId` | UUIDv7; global dedupe key. |
| `deviceId`, `seq` | Contiguous per-device sequence; detects gaps and gives the frontier. |
| `hlc` | Hybrid logical clock `<13-digit ms>-<4-digit counter>`; total order with `(deviceId, seq)` as tie-break. Advances past every HLC the device has read, so causally later events always sort later. |
| `actor` | `user` · `ai` · `connector` · `mcp` · `system`. |
| `command` | Name + args as invoked (for audit and History). |
| `ops` | Resolved field-level mutations (`create`, `set`, `tombstone`). Replay applies ops; it never re-runs command logic, so replay does not depend on code version. |
| `ops[].baseEventId` | For `set`: the last write to that field the author had seen. Enables conflict detection. |
| `undoOf`, `runId`, `idempotencyKey`, `evidenceRefs` | Undo linkage, AI batch grouping, retry safety, provenance. |

## Writing

1. Domain validates the command and produces ops.
2. Store assigns `seq`, `hlc`; serializes to one line; `appendFile` + `fsync` on the current segment.
3. Only after fsync is the change acknowledged to the UI/MCP. C4 also persists
   local sequence metadata before returning success. New segments use no-replace
   publication; multi-event batches publish as one complete segment, capped at
   1 MiB ([ADR-0013](decisions/0013-workspace-store-publication.md)).
4. Every N events (default 500) or on clean shutdown, write a checkpoint: write `checkpoints/<deviceId>/.tmp-<uuid>` then `rename` into place (atomic on APFS). Delete older checkpoints beyond 3.

## Reading and folding

Reference: [`tools/reference/workspace-reader.mjs`](../tools/reference/workspace-reader.mjs), [`fold.mjs`](../tools/reference/fold.mjs).

1. Read every `*.jsonl` under every `log/<deviceId>/`, **including** sync-client conflicted copies (e.g. `… (Desk Mac's conflicted copy).jsonl`).
2. Ignore an unterminated last line (torn tail — the sync client uploaded mid-append). Report `TORN_TAIL_IGNORED`.
3. Dedupe by `eventId`. Same id with different bytes ⇒ `EVENT_ID_COLLISION` (integrity error; surface, do not guess).
4. Pick the newest checkpoint that is **usable**: every event outside its frontier sorts after its `maxHlc`. Otherwise use an older one or replay from empty.
5. Sort remaining events by `(hlc, deviceId, seq)` and apply ops.

## Merge semantics

- **Field-level last-writer-wins** in total order. Commutative and idempotent, so every device converges.
- **Conflict detection**: when a `set` op's `baseEventId` is not the field's current writer, the author had not seen that write ⇒ concurrent edit. The fold records `{kind, id, field, values, eventIds, winner, material}`.
- **Material fields** (`initiative.moscow|lifecycle|title`, `node.state|outcome|title|type`, `edge` endpoints/type/condition): the device that notices raises a `sync_conflict` Question with `dedupeKey = sync:<kind>:<id>:<field>` (deterministic ID ⇒ no duplicate questions if both Macs notice). Resolutions: keep the winner / take the other value. After a closed occurrence, a new collision adds its winning-event occurrence to the key ([ADR-0019](decisions/0019-question-lifecycle-and-sync.md)).
- **Non-material fields**: winner stands silently; the conflict appears in History.
- `set` after `tombstone` ⇒ `write_after_delete` (material; question offers restore). Duplicate live `create` ⇒ first wins. A compensating `create` with `undoOf` may restore a tombstoned record ([ADR-0012](decisions/0012-command-transactions-and-undo.md)).

Golden test: [`fixtures/scenarios/expectations.json#crossDeviceCollision`](../fixtures/scenarios/expectations.json).

## Device identity

- `deviceId` is a UUIDv7 created on first launch and stored in machine-local `device.json`, plus a `device.register` event with a user-chosen label (no hostname, serial or path).
- **Clone detection**: on open, if `log/<deviceId>/` contains a `seq` higher than this machine's last written `seq`, another machine is using the same id (e.g. after Migration Assistant). The core then mints a new `deviceId` and registers it, never appending to the other machine's log.

## Sync providers

| Provider | Expected behavior | Must verify in S1 |
|---|---|---|
| Local folder | Trivial. | — |
| Dropbox | Uploads appends as new file versions; conflicted copies when two writers hit one file (should not happen by design). | Torn tails, latency, conflicted-copy naming, FSEvents on remote changes. |
| Google Drive for desktop | **Streaming mode may leave files online-only.** | Whether "available offline" is required for the workspace folder; how partial appends appear; rename atomicity. |
| iCloud Drive | Not a stated target; may evict files. | Out of scope for v1; warn if chosen. |

The app must detect online-only placeholders (read fails / zero-length) and show "Workspace not fully downloaded" instead of folding a partial event set.

## Migrations

- `workspace.json#schemaVersion` changes only through an explicit migration step on the user's command, with a backup taken first.
- Events are never rewritten. New code includes upcasters `v1→v2→…` applied on read. New checkpoints are written at the new version.
- `minReaderVersion`: an older app opening a newer workspace opens **read-only** with a clear message; it never appends events it cannot express.
- Two Macs on different app versions: the newer one may write new-version events only after the user confirms the other device is updated (shown in Settings → Workspace).

## Backup and restore

- **Automatic**: daily zip of `workspace.json`, `log/`, latest checkpoint into machine-local `backups/` (keep 14 daily, 8 weekly). Optional second backup location chosen by the user.
- **Restore**: always into a *new* workspace folder (new `workspaceId`) — never overwrite in place, so a synced bad state cannot clobber a good one.
- **Point-in-time view**: History can fold events up to any HLC for inspection without restoring.
- Sync-provider version history (Dropbox/Drive) is a secondary safety net, not relied upon.

## Size and compaction

Expected volume for one user: low thousands of events per month; excerpts ≤ 4 KB each. Segments are never deleted in v1. If the log grows past a threshold (e.g. 200 MB), a future **archive** command can snapshot state and move old segments to `archive/` after all devices' frontiers have passed them — design deferred until measured.

## Encryption (design accepted; implementation pending)

Current v1 readers reject encryption; the reserved `encryption` descriptor does
not enable it. [ENCRYPTION.md](ENCRYPTION.md) and
[ADR-0021](decisions/0021-workspace-encryption.md) specify the proposed v2 codec,
Keychain/recovery flow and copy migration. Step 36 must add versioned schemas
and validate the implementation before encrypted workspaces can be opened.

The plan encrypts entire events/checkpoints with authenticated encryption,
retains canonical event bytes and merge/undo semantics, and migrates into a
new workspace identity only after backup and full replay verification. Source
logs stay unchanged. Old plaintext copies, provider history, exports and local
caches are not erased or protected by enabling workspace encryption. No key
belongs in the portable folder. Personal cloud storage still requires the
owner's authorization; encryption is not a compliance determination.

## Executable driver

`packages/store` implements C4. Its tests cover the cross-device fixture and
local process crashes; real sync-provider behavior remains provisional. The
application binds a domain snapshot provider for checkpoint maintenance and
retains full logs for undo/protection reconstruction. Details and operational
limits: [store README](../packages/store/README.md).
