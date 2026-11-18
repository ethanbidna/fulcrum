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
