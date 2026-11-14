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
