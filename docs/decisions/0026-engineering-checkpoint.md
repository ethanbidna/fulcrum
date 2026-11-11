# ADR-0026: Approve engineering direction, retain feasibility gates

- Status: Accepted engineering checkpoint; owner feasibility acceptance pending
- Date: 2026-11-10
- Refines ADRs 0001–0005 and 0007–0009

## Context

The owner requested the remaining nine items together, then explicitly said
“Just do them; we'll test later” when asked about pending measurement prerequisites.
Proceed with implementation and a reviewable checkpoint. Missing hardware,
account, signing and usability evidence cannot become an accepted result.

The checkpoint reviews every report/result under docs/spikes, the original ADRs,
and the implemented core, UI, settings, MCP, onboarding and packaging boundaries.
The evidence matrix is [CHECKPOINT.md](../CHECKPOINT.md). Historical recommendations
superseded by later owner decisions do not regain authority here.

## Decisions

1. Keep Tauri/React and one TypeScript core owning canonical writes through
   Domain.execute. The browser bridge remains development-only. Intel/Apple
   Silicon native CI and standalone SEA schema/FTS5 checks support implementation;
   clean-user launch, complete RSS, universal execution and notarization remain
   release acceptance, not proof supplied by CI.
2. Use Node 22 SEA for the provisional production release route in ADR-0024.
   This is an explicit engineering choice under deferred testing, not a claim
   that Node outperforms Bun. Keep the S7 comparison and fallback decision open
   until controlled measurements justify retaining or superseding that route.
3. Keep v1 append-only logs, deterministic fold and machine-local rebuildable
   indexes. Production durability/replay tests support those rules. Real Dropbox/
   Drive delivery, clone detection limits and remote completeness remain S1 gates.
   Do not change the data contract from an unrun provider test.
4. Keep native SQLite ContextIndex. Reject the current FalkorDBLite Intel wheel
   configuration after its actual error-86 store probe. The optional isolated
   Graphiti experiment in ADR-0025 may continue on supported hardware, but no
   Graphiti/SSPL engine is shipped or accepted for a hardware tier.
5. Retain Activepieces as the mandatory source integration boundary (ADR-0011).
   A custom/extended piece addresses capability gaps; independent native probes
   remain test instruments. No execution mode, OAuth success or public connector
   distribution is accepted without S4 results. I2 remains blocked, with no
   silent bypass through native APIs or hosted infrastructure.
6. Replace the remaining historical Llama-only installation/tier assumptions with
   ADRs 0018/0023: optional model/provider choice, explicit license/scope/budget,
   private keys and no fallback. AI starts off. No extractor/model tier is
   accepted. Setup's synthetic compatibility pass establishes neither extraction
   precision nor safe unattended reconciliation. S2 must supply those results.
7. Keep scoped, disclosed, disabled-by-default stdio MCP with shared domain policy
   and local activity. S6 SDK/Inspector checks and P1 synthetic protocol/parity
   tests support engineering. Claude Desktop confirmation, actual Keychain ACLs
   and packaged headless behavior remain owner checks.
8. Keep JSON Schema as the versioned persisted contract. P6 design is accepted
   separately; encryption implementation is still todo. No v2 records or
   encryption protection are claimed by this checkpoint.

## Approval and later acceptance

Merging this PR approves these engineering decisions and the revised build order.
It does not mark the existing Owner boxes. Step 9 remains waiting-owner until
S1/S2/S4/S6/S7/S3 results are recorded and the owner reviews a final adoption PR.
That PR must retain failures and explicit unavailable tests, resolve each gate
or deliberately decline the corresponding feature, then tick step 9's Owner box.
ADRs may be Accepted for architecture while their named empirical gates remain
pending; never flatten those two facts into a hardware acceptance claim.

No new threshold is invented to replace missing measurements. Operations keeps
its existing provisional resource policy, identifies the actual implemented
candidate catalog and separates manual/viewer capability from extraction adoption.
The risk register reflects confirmed engineering evidence and open user impact.
