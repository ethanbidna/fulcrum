# I2 prerequisite review

I1 and S4 are complete. The owner approved the S4 results and deferrals
in [PR #96](https://github.com/ethanbidna/fulcrum/pull/96). Step 25 is ready
for implementation. The execution route is recorded in
[ADR-0027](../decisions/0027-gmail-piece-execution.md).

- The [Gmail desktop probe](../spikes/S4-results/gmail-desktop.md) passed
  read-only OAuth, refresh, backfill and incremental sync with synthetic mail.
- The [runtime comparison](../spikes/S4-results/activepieces-runtime.md)
  measured the self-hosted footprint. Live Gmail was excluded because the
  stock piece requests write permissions.
- The [S4 matrix](../spikes/S4.md#owner-results) records measured results and
  explicit reasons for cases that did not run.

I2 still needs production validation, including Keychain storage, packaged
execution and the open-original checks in the ADR.

## Packaged Gmail test

Use a designated throwaway Gmail account with synthetic mail. Configure a
Google Desktop OAuth client with Gmail API enabled and the account on its
test-user list. Install the downloaded client JSON outside the workspace:

```sh
mkdir -p "$HOME/Library/Application Support/Fulcrum"
install -m 600 "/path/to/desktop-client.json" "$HOME/Library/Application Support/Fulcrum/gmail-oauth-client.json"
```

Restart the native app and its core. Open a disposable workspace, designate
this Mac for ingestion, then open **Settings → Sources & Integrations**.
Connect the test account, select a synthetic label, and choose **Start sync**.
Check freshness before and after adding a newly labeled message. Restart the
app and core and confirm sync resumes without another consent prompt. Choose
**Disconnect Gmail** and confirm sync stops and the workspace's
`Fulcrum.Connector.Gmail` entry is removed from Keychain.

The adapter leaves exact Gmail links empty. An open-original fallback has
yet to be validated. Record counts and observations only.


## Interrupted processing

The core records the source pointer and canonical content hash before applying
reconciliation commands. It appends a separate `source.record` event with
a completion idempotency key derived from connector, remote ID and canonical
content hash only after the plan finishes.
The Gmail scheduler deduplicates against these completion events, rather than
source existence. An interrupted plan remains eligible after a queue restart
or ingestion-device handover. Existing source and reconciliation idempotency
keys prevent repeated accepted commands. Each command remains a separate atomic
event; the entire plan is not a transaction.

Cancellation is checked after extraction and inside the serialized write queue
before each command. Synthetic tests cover a late model response after cancel,
interruption after source recording, SQLite queue restart, and canonical hashes
for Unicode, line endings and surrounding whitespace. These tests do not
validate live Gmail, model quality, native packaging or real two-Mac sync.

A caller-supplied ingestion processor retains its explicit background resource
profile when interactive AI is disabled or changed. The automatic Gmail
processor follows the selected AI profile. The core admission test verifies
that its custom processor can start, pause and retain pending queue items.


November 18, 2026 verification ([PR #104](https://github.com/ethanbidna/fulcrum/pull/104)):
600 workspace tests passed with a 30-second per-test timeout. The reference run
passed 116 tests, with one existing skip and one existing TODO. Schema checks,
lint, TypeScript, core build and the compiled core's schema/FTS5/encryption
self-test passed. The standard five-second workspace timeout produced timeouts
in ingestion/encryption tests; the final longer-timeout run passed all tests.
No UI code changed in this follow-up.


## Duplicate preview processes

A native sync investigation found two preview shells connected to one core.
Their process-local wake counters alternated, restarting the wake grace period
and preventing source work. Stopping the stale shell let the grace period end;
the live source's checked timestamp advanced again. Failed extraction items
remain a separate issue; resumed source checks do not establish model quality.

The desktop now registers Tauri's pinned single-instance plugin before its
other plugins and native system observer. A second launch focuses the existing
window and exits. Credential helper modes still run before desktop startup.
This guard covers copies sharing a bundle identifier; previews with different
identifiers should not share a local profile.

The native regression uses a debug executable and disposable profile:

```sh
FULCRUM_NATIVE_TEST_BINARY=/absolute/path/to/debug/fulcrum-desktop \
  pnpm exec vitest run --project unit tools/workspace/native-single-instance.test.mjs
```

Build the debug frontend and native executable first. The native test is skipped
without that explicit executable. It reproduced two surviving shells before the
fix, then passed with the guard. All seven Rust tests passed. The debug launch
check allows ten seconds for initial startup on a busy Mac; its second process
must exit within five seconds. It does not use Google credentials or live mail.

When upgrading from an older unguarded preview, quit its existing copies once
before opening the updated bundle.


The rebuilt ad-hoc preview also passed a packaged second-launch check: the
second process exited successfully and one desktop shell remained. Deep/strict
code-signature verification passed, and notices were regenerated for 375
packages plus Node.js. This was a local ad-hoc build, not a notarized release.
The changed preview signature requires a separate macOS Keychain access check;
the first credential read after this rebuild waited for system authorization.
Do not count duplicate-launch validation as successful Gmail authorization or
extraction acceptance.


After the owner selected **Always Allow**, the updated preview's credential
helper read succeeded. The prior unpaused background setting was restored,
and Gmail completed a fresh source check with no scope error or pending retry.
The Sources & Integrations screen still showed sync enabled. No credentials,
message content, account identifiers or source IDs are included in this record.
Earlier extraction failures and queued analysis remain separate from the
verified Gmail authorization and source check; step 25 acceptance stays open.
