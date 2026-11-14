# I2 prerequisite review

I1 is complete. Step 25 remains blocked until the owner reviews and
completes step 6. The execution route is recorded in
[ADR-0027](../decisions/0027-gmail-piece-execution.md).

- The [Gmail desktop probe](../spikes/S4-results/gmail-desktop.md) passed
  read-only OAuth, refresh, backfill and incremental sync with synthetic mail.
- The [runtime comparison](../spikes/S4-results/activepieces-runtime.md)
  measured the self-hosted footprint. Live Gmail was excluded because the
  stock piece requests write permissions.
- The [S4 matrix](../spikes/S4.md#owner-results) records measured results and
  explicit reasons for cases that did not run.

Review the recorded cases and tick the Owner box for step 6 when its checks
are complete. Promote step 6 to done before making step 25 runnable.
I2 still needs its own production validation, including the Keychain,
packaged execution and open-original checks in the ADR.
