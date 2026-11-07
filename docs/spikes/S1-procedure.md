# S1: two-Mac workspace experiment

Status: harness ready; **no Dropbox or Google Drive behavior validated**.
Use disposable synthetic workspaces only. Do not use an existing Fulcrum
workspace or real work content. Keep captures outside the workspace and review
for personal paths/account details before sharing. Do not commit raw captures.

## Prepare

1. On both Macs, check out the same harness revision, install Node 22+, then
   run `npm ci` and `npm test` from the repository root. One known reference
   reader regression is marked TODO; see [findings](S1-findings.md).
2. Record revision, macOS version, Node version, sync-client version, provider
   mode, and whether files are available offline. Synchronize both system
   clocks. Wall-clock latency is approximate and can be negative with clock skew.
3. Choose a fresh empty folder for each row in the results table. Set `WS` in
   each terminal to that Mac's corresponding folder. `WS` is a shell variable,
   not a literal directory name. Use only synthetic labels `Synthetic A` and
   `Synthetic B`. A label is stored in the workspace; never use a hostname.
4. The default identity is `~/.fulcrum-spike/device.json`. Keep this outside
   Dropbox/Drive. For isolated runs set `FULCRUM_SPIKE_HOME` to a fresh local
   directory outside any workspace on each Mac. Never share this directory
   except for the deliberate clone test below. Last-written sequences are
   tracked separately for each workspace UUID.
5. Initialize **only on A**, then wait for `workspace.json` on B:

   ```sh
   node spikes/s1/cli.mjs init "$WS"
   node spikes/s1/cli.mjs device "$WS" --label 'Synthetic A'
   ```

   On B, after the manifest arrives:

   ```sh
   node spikes/s1/cli.mjs device "$WS" --label 'Synthetic B'
   node spikes/s1/cli.mjs watch "$WS"
   ```

   Wait for both device registrations to reach both Macs. Compare `fold --json`
   frontiers and hashes before continuing. `watch` prints newline-delimited JSON
   with `observedAt`, diagnostics, frontier, conflicts, and state hash. It watches
   other devices' logs, including conflicted copies; it does not watch checkpoints.

## Connected writes and latency

On A, in a separate terminal:

```sh
node spikes/s1/cli.mjs write "$WS" --count 20 --interval-ms 500
node spikes/s1/cli.mjs checkpoint "$WS"
node spikes/s1/cli.mjs fold "$WS" --json
```

Each write prints `acknowledgedAt`, device ID, sequence, HLC and initiative ID
only after append fsync and local identity persistence. For each sequence, match
the first B watch sample whose frontier includes it. Record the difference from
`acknowledgedAt` to `observedAt`; report sample count, median and maximum. Repeat
B → A. Record coalesced/missing watcher notifications separately; an explicit fold
is the final convergence check. `fs.watch` notifications are observations, not
proof of provider delivery guarantees. Preserve any transient torn-tail diagnostics.

## Offline concurrent edits

1. Pick one `initiativeId` from A's write output. Confirm it exists on both Macs
   with identical hashes and frontiers. Set `INITIATIVE_ID` on both terminals.
2. Pause the sync client on **both** Macs (or disconnect both from the network).
3. On A run:

   ```sh
   node spikes/s1/cli.mjs write "$WS" --count 1 --interval-ms 0 --field-conflict "$INITIATIVE_ID"
   ```

4. On B run the same command with `--count 2`. The harness cycles MoSCoW values;
   differing counts create differing final values from the same initial state.
   Each event records the last field writer visible locally as `baseEventId`.
5. Resume both clients. Run watchers, then explicit `fold --json` on both Macs
   after the clients report sync complete. Compare hashes, frontiers and conflict
   event IDs. Expect a material `moscow` conflict and identical final state.
   Do not resolve it by editing log files. This spike reports conflicts; it does
   not implement the future Questions UI.

## Torn tails, copies, placeholders and checkpoints

1. During a longer `write --count 100 --interval-ms 50` run, observe B's watcher.
   Record naturally observed torn tails and conflicted-copy filenames (redact
   personal labels). Zero observations is a result, not proof they cannot occur.
2. In a disposable copy, append an unterminated JSON fragment to a segment.
   `fold` must report `TORN_TAIL_IGNORED` and preserve complete events. Copy a
   segment to a name ending in ` (Synthetic conflicted copy).jsonl`; expect
   `DUPLICATE_EVENT_IGNORED`, unchanged hash. These are injected filesystem cases,
   not observations of client behavior. `npm test` performs both automatically.
3. For Drive **stream** mode, first test its default availability, then explicitly
   make the whole workspace available offline and repeat. Attempt the client's
   supported online-only/eviction action on a disposable segment. Record whether
   reading blocks, downloads automatically, fails, or returns zero bytes. A
   zero-byte/read-failing file blocks the harness's authoritative hash and writes.
   Successful automatic hydration cannot be distinguished from a resident file.
   Do not interpret a synthetic zero-byte file as validation of Drive behavior.
4. Run five cycles of one write followed by `checkpoint` on A. Verify three
   finalized `.json` files remain under A's checkpoint directory. On B repeatedly
   run `fold` during delivery; record malformed/empty checkpoint observations,
   temporary files and read errors. Local rename atomicity does **not** establish
   atomic delivery by a sync client. Checkpoints are validated caches; the harness
   reports the newest eligible checkpoint but always folds all authoritative logs.
5. Pause B before A's checkpoint, write offline on B, then reconnect. Observe
   checkpoint eligibility/fallback after late events arrive. Compare final hashes
   using full replay. Existing reference tests cover the eligibility predicate.
6. Run `npm test` for deterministic child-process exits after half an append and
   after fsync of a checkpoint temporary file, before rename. These tests verify
   local recovery, not power-loss behavior or sync-client crash handling. For an
   optional manual kill, use a disposable workspace and record the last printed
   acknowledged sequence. After killing, remove only the machine-local
   `writer.lock` **after confirming no writer is running**, then reopen. Never
   delete or rewrite shared log segments. Run `device` if clone detection fires.

## Clone detection

1. With both clients caught up and all writers stopped, save A's machine-local
   `device.json` as a local backup. Copy that file to a fresh local identity
   directory on B. Point B's `FULCRUM_SPIKE_HOME` at the copied identity.
2. On A append one more event, then wait for that segment to reach B. This step
   is essential: the specified detector requires an observed sequence **higher**
   than the copied local last-written sequence.
3. On B run `device "$WS" --label 'Synthetic clone'`. Expect `cloned: true`, a
   new device UUID and a registration in its own log directory. Write again.
4. Verify B did not append to A's log and both folds converge. Restore B's normal
   local identity setting. Record that equal-frontier clones cannot be detected
   by this rule; simultaneous first opens of a clone are not proven safe.

## Provider matrix and results

For a local-folder baseline, use one Mac with two distinct `FULCRUM_SPIKE_HOME`
directories writing the same `WS`. For offline simulation, use `npm test` (two
separate directories whose per-device logs are later copied). A local directory
on each of two Macs has no propagation mechanism by itself.

Repeat the full sequence for Dropbox, Drive mirror, Drive stream default, and
Drive stream available offline. Do not silently substitute mirror for stream.
Record unsupported modes or unavailable controls as untested, with a reason.

| Provider / mode | Revision / OS / client | Latency n / median / max (A→B, B→A) | Torn tails seen | Conflicted copies | Placeholders / hydration | Checkpoint rename observations | Convergence yes/no | Clone result | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Local folder, two local identities | | | | | | | | | |
| Dropbox, two Macs | | | | | | | | | |
| Google Drive mirror, two Macs | | | | | | | | | |
| Google Drive stream default, two Macs | | | | | | | | | |
| Google Drive stream available offline, two Macs | | | | | | | | | |

Record injected cases separately from naturally observed provider behavior.
Attach sanitized results to issue #1. Update [findings](S1-findings.md) with
measurements and a format recommendation, then update ADR-0005's provisional
status only as supported by the results. S1 remains open until the real two-Mac
criteria and report are complete.

Watch also polls remote log metadata every 500 ms to catch missed notifications.
`WATCH_POLLING_FALLBACK` reports filesystem watcher failures. Include this interval
and fallback status in latency results; transient changes between polls may be missed.
