# Engineering checkpoint — 2026-11-10

All nine requested engineering items have implementations or reviewable decision
artifacts: U6 #73, U7 #75, A2 #76, P4 #77, P1 #78, P2 #79, P5 #80, S3 #81 and this
checkpoint. Their owner/hardware acceptance is separate. The owner explicitly
authorized testing later. [ADR-0026](decisions/0026-engineering-checkpoint.md)
records the resulting decisions.

## Evidence and decisions

| Area | Evidence read | Engineering decision | Acceptance still pending |
|---|---|---|---|
| S1 workspace | S1-findings/procedure; local simulation/crash/replay tests; production C4 | Keep v1 event-log/fold and private rebuildable caches | Actual two-Mac Dropbox/Drive matrix, hydration/completeness and clone limits |
| S2 local models | S2 procedure, 48-case evaluation design; I3 runtime/evidence tests; P2 synthetic compatibility | Model-neutral interfaces; AI off until explicit setup; no accepted extractor | Real precision/recall/attribution/injection review, resources, pause, battery and responsiveness |
| S3 Graphiti | Shared 48-episode native report: seven alias cases pass without inference; Intel store probe error 86 | Native SQLite ships; current embedded Intel wheel is no-go; Graphiti remains optional experiment | Supported store, Apple Silicon probe, repeated local-model comparison and distribution license review |
| S4 connectors | Slack/Gmail capability matrix and mocked probes; all six live result rows pending | Activepieces boundary from ADR-0011; extend pieces rather than bypass them | Throwaway-account auth/refresh/scopes, pagination/catch-up/links, footprint and execution route |
| S5 Granola | Official API/export/integration research; no private data accessed | API via Activepieces default, CSV fallback only when API unavailable | Eligible access, scopes, full transcripts/cursors, speaker identity, import dialect and repeat identity |
| S6/P1 MCP | SDK legacy/current and Inspector report; full tools, scopes, write policy, private log/install/headless tests | stdio shim to shared authenticated core; off/read-only/excerpt-off defaults | Claude Desktop dialogs/confirmation and actual packaged Keychain/headless behavior |
| S7/P5 packaging | Node/Bun sidecar/app CI reports; production Node SEA schema/FTS5 and native Intel/ARM CI | Tauri + provisional Node SEA, explicit signed updates, no development transport | Controlled hardware, complete shell/WebKit footprint, actual universal signed/notarized DMG and upgrade |
| Schemas | C1 generation check, runtime Ajv validation and golden replay | Keep JSON Schema v1 authoritative | Signed Keychain and two-Mac v2 acceptance pending; see [local P6 verification](reviews/P6-local-verification.md) |

Historical S4 native-adapter advice is superseded by ADR-0011. Original Llama-only
tiers/hosted exclusions are superseded by ADRs 0018/0023. Single runner samples
and a synthetic compatibility probe do not resolve either adoption decision.

## ADR disposition

| ADR | Disposition after this checkpoint |
|---|---|
| 0001 | Accepted engineering: Tauri/browser-first; empirical release gates retained |
| 0002 | Superseded by 0011; no independent native connector fallback |
| 0003 | Superseded by 0018/0023 for model/provider/setup; no historical tier accepted |
| 0004 | Accepted native authority/index split; Graphiti adoption declined for current Intel wheel, otherwise pending |
| 0005 | Accepted event-log format; actual sync-provider validation pending |
| 0007 | Accepted scoped stdio/shared-policy architecture; client/credential acceptance pending |
| 0008 | Accepted versioned JSON Schema contract |
| 0009 | Accepted single TypeScript writer; Node SEA implementation provisional under 0024 |

## Sequence after this batch

The first real connector remains blocked, and encryption engineering has merged:

- I2 / step 25: first real Activepieces connector, currently blocked on S4's
  owner results and selected execution route. Preserve the boundary and exact
  gap report in reviews/I2-prerequisites.md.
- P6 / step 36: encrypted workspace implementation merged in #83 under ADR-0021.
  Local synthetic checks, native tests and Intel executable self-tests pass.
  Signed Keychain and two-Mac acceptance remain pending in reviews/P6.md.

Owner validation remains on sync, model quality/hardware, connector accounts,
MCP, UI usage, background behavior, onboarding and signed release/update. The
exact copy-paste procedures are in backlog/PROGRESS.md and the linked review/
spike documents. No box was ticked by this batch. The recurring audit counter
remains independent of engineering artifacts awaiting owner acceptance.

## Final adoption review procedure

1. Complete the pending spike procedures using synthetic data. Commit reviewed
   count-only reports and explicit unavailable/failed rows. Do not run competing
   model/resource trials together or infer a provider pass from a local fixture.
2. Compare Node/Bun packaging and model accuracy/resources on the target hardware;
   retain current choices only if the evidence supports them. Otherwise write
   a superseding ADR and an implementation issue rather than changing claims.
3. Decide Graphiti from store support, measured benefit over native and licensing.
   “Do not ship Graphiti” is a valid final outcome. A failed experiment is evidence.
4. Resolve S4's Activepieces execution/least-privilege/pagination route and record
   remaining connector gaps before unblocking I2. Test actual MCP confirmation,
   clean-user launch, signing and updates through their own procedures.
5. Review Operations thresholds and Risks against those reports. Accept, decline
   or explicitly defer every feature/tier, with a reason. Open one final adoption
   PR updating this matrix and the affected ADRs. Merge it, then tick only step
   9's Owner box. Existing step boxes remain the owner's separate decisions.
