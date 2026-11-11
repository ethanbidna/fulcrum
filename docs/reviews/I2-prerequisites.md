# I2 prerequisite review

Step 25 is blocked before implementation. No connector, account access,
credential access, runtime installation or production dependency was added.

## Evidence

- [I2 in the backlog](../../backlog/BACKLOG.md#i2--first-real-connector) and
  [issue #21](https://github.com/ethanbidna/fulcrum/issues/21) require I1 and S4.
  I1 is done; S4 is still waiting on the owner in step 6.
- [S4](../spikes/S4.md) records source review and mocked probes only. All six
  owner-result rows are pending, with no Activepieces execution or footprint
  validation. There are no committed S4-results reports.
- [ADR-0002](../decisions/0002-integration-boundary.md) is superseded.
  [ADR-0011](../decisions/0011-activepieces-integration-boundary.md) requires
  Activepieces pieces and leaves library/runtime execution provisional.
  The historical native-provider recommendation cannot select I2's route.
- The playbook omitted S4 from step 25's Needs column and still linked the
  superseded ADR. This review aligns that row with the backlog and current ADR.

Choosing a production route now would invent the S4 outcome the step requires.
Using the native probes as the production connector would bypass the selected
Activepieces boundary. Account OAuth, refresh, scope, cursor and permalink
acceptance remain unverified.

## Unblock

1. Complete the [step 6 procedure](../../spikes/s4/README.md) using throwaway
   Slack/Google accounts containing synthetic content. Keep credentials local.
2. Include the Activepieces library/runtime comparisons relevant to selecting
   the first connector. Record read-only auth/refresh, bounded pagination and
   catch-up, scopes, threads/link precision, required host services and footprint.
   Explicit failures or not-run reasons belong in the results.
3. Commit reviewed synthetic/count-only reports under `docs/spikes/S4-results/`
   and fill the S4 matrix. Have the results reviewed and record the selected
   Activepieces execution route in the current integration decision.
4. Tick only step 6's Owner box when its owner checks are complete. After that
   step is promoted to done and a route is recorded, return step 25 to todo.
   Step 25's own account-connection acceptance remains pending implementation.

No Owner box is completed by this review. The completed-step counter stays at 2.
