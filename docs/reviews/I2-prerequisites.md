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
