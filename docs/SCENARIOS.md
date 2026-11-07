# Golden scenarios and fixtures

All data is synthetic. People, companies and messages in fixtures are invented.

## Fixtures

| Path | What it is |
|---|---|
| [`fixtures/states/portfolio.state.json`](../fixtures/states/portfolio.state.json) | A workspace state (checkpoint shape) with five initiatives covering every Phase 0 fixture requirement. |
| [`fixtures/workspace-example/`](../fixtures/workspace-example) | A real on-disk workspace: manifest, two devices' event logs (with a sync-client conflicted copy and a torn tail), and a checkpoint. |
| [`fixtures/scenarios/expectations.json`](../fixtures/scenarios/expectations.json) | Language-neutral expected results. The reference model and the future core package must both pass it. |

`npm test` validates fixtures against `schemas/v1` and runs the reference model in [`tools/reference/`](../tools/reference) against the expectations.

### Coverage of required fixture cases

| Required case | Where |
|---|---|
| New initiative proposal (not active until approved) | Initiative "Onboarding survey refresh" (`lifecycle: proposed`) + Question `…0003` with approve/reject resolutions |
| Explicit personal Task | Node "Test design capabilities" ← assertion `user_commitment` (explicit) ← synthetic meeting note |
| External Dependency | "Security approval" (Security team), "Reference call with existing customer", "Legal review", "API credentials" |
| Conditional decision | "Select vendor" with options proceed/stop; conditional `leads_to` routes; an OR prerequisite group |
| Milestone | "Recommendation delivered" |
| Priority conflict | "Data retention policy": protected Must Do vs. a colleague's Could Do opinion → `suggested` assertion + `protected_field_challenge` Question; objectives with a rank tie |
| Evidence on node and edge | Evidence on Task and Dependency nodes; assertion + evidence on the edge "Run pilot depends_on Security approval" |
| Questions Center | Three open contextual Questions (edge, initiative field, proposal) |
| Child Tasks in one graph | "Test design capabilities" `contains` two child Tasks, which also have a `depends_on` between them |
| Cross-device collision | `workspace-example`: both Macs change MoSCoW offline → deterministic winner + material conflict + deterministic question key |

## Scenarios from the product spec

| # | Scenario | Verified by | Status |
|---|---|---|---|
| 1 | Seven days asleep → wake → clear portfolio, no admin backlog | Ingestion catch-up integration test with a synthetic adapter producing 7 days of items | Backlog (M2) |
| 2 | "I'll test the vendor" → one Task + clickable source | Fixture shape ✅; extraction eval (S2) + reconciler test | Partly (shape only) |
| 3 | Colleague's promised review → Dependency, not Task | Schema forbids owned Tasks ✅; reconciler test | Partly |
| 4 | New idea proposed, not activated without approval | Fixture ✅; policy P1 test | Partly |
| 5 | External opinion doesn't override protected MoSCoW | Fixture ✅ (`domain.test.mjs`); policy P4 test | Partly |
| 6 | Aliases resolve or raise one identity question | ContextIndex test with alias fixtures | Backlog (M2) |
| 7 | Unavailable approval blocks only dependent work | `domain.test.mjs` ✅ | Reference ✅ |
| 8 | Conflicting source claims: both shown, chronology kept, user choice preserved | Reconciler test | Backlog (M3) |
| 9 | Second Mac: indexes rebuilt, no credentials, no duplicate IDs | Store test with two simulated devices ✅ (fold); manual two-Mac test (S1) | Partly |
| 10 | Model/connector unavailable → prior state + truthful freshness | Status projection test | Backlog (M2) |
| 11 | MCP and UI edits share commands and history | MCP contract test asserting identical events | Backlog (M4) |
| 12 | Intel: CPU/RAM/temperature measured; AI pausable without UI freeze | S2 benchmark + manual test | Backlog (M0) |
