# Playbook: ordered steps for coding agents

This file is static: it defines **what** each step is, what it needs, and what the owner must do. Current status lives in [PROGRESS.md](PROGRESS.md). The procedure for picking and running a step is in [AGENTS.md](../AGENTS.md#continuing-the-plan).

Columns:
- **Needs** — steps that must be `done` first (including any owner action on them).
- **Owner action** — what only the owner can do. A step with an owner action becomes `done` only when the owner ticks its box in PROGRESS.md.

## Phase A — feasibility (M0) and scaffold

| Step | Item | Issue | Needs | Owner action | Extra instructions |
|---|---|---|---|---|---|
| 1 | S1 workspace sync harness | #1 | — | Run `docs/spikes/S1-procedure.md` on two Macs (Dropbox and Google Drive) and fill in the results table | Build a CLI in `spikes/s1/` (init, device, write, checkpoint, fold, watch) reusing `tools/reference/`. Simulated tests: two devices, offline conflicts, torn tail, conflicted copy, zero-byte placeholder, crash mid-append and mid-checkpoint, clone detection. Write the procedure doc with a results table. Do not change merge semantics; record gaps in `docs/spikes/S1-findings.md` with failing tests. |
| 2 | C1 monorepo scaffold | #8 | — | — | pnpm workspaces; keep `tools/test` passing; `npm test` (or `pnpm test`) runs all workspace tests; add the gitleaks CI job if missing. Update README/CONTRIBUTING with the new commands. |
| 3 | S2 Llama benchmark | #2 | — | Install Ollama; run the benchmark on the 2019 Intel MacBook Pro (and an Apple Silicon Mac if available); commit the results file | Eval set (≥ 40 synthetic items incl. user vs. colleague commitments, priority opinions, injection attempts) and a benchmark script in `spikes/s2/` that writes results. Give exact commands. Leave the recommendation section empty until results exist. |
| 4 | S7 Tauri + core sidecar packaging | #7 | 2 | Run the measurement script on the Intel Mac; record notarization result or "no Developer ID" | Compare Node SEA vs Bun compile; confirm FTS5 in the chosen SQLite; script the measurements. |
| 5 | S6 MCP shim | #6 | 2 | Add it to Claude Desktop and complete the manual checklist | Serve from `fixtures/states/portfolio.state.json`. Provide copy-paste client config and a short checklist. |
| 6 | S4 connector capability matrix | #4 | — | Create a throwaway Slack workspace and Google account containing only fake messages; register OAuth apps as instructed; run the prototypes | Research first, then small prototypes in `spikes/s4/` for Slack and Gmail. Credentials only from environment variables; never committed. |
| 7 | S5 Granola access | #5 | — | — | Research only; no reverse-engineering of private files. Output `docs/spikes/S5.md` with a recommendation. |
| 8 | S3 Graphiti | #3 | 3 | Run the spike on hardware and commit results | Compare against a minimal native SQLite alias resolver on the same fixtures. |
| 9 | Decision checkpoint | — | 1, 3, 4, 5, 6, 7, 8 | Review and approve the PR (merging it = approval) | Read every `docs/spikes/*`. Update ADRs 0001–0005 and 0007–0009 to Accepted or Superseded from measured results; update `docs/OPERATIONS.md` tiers/thresholds and `docs/RISKS.md`; adjust later backlog items and this playbook's extra instructions where assumptions changed. One PR summarizing every decision change. |

## Phase B — core product on fixtures (M1)

The owner authorized model-independent core work alongside the feasibility
studies on 2026-11-08. C2 can start after C1; unfinished hardware checks and
model/context adoption still require the decision checkpoint. This changes the
build order, not the criteria for accepting a runtime or driver.

| Step | Item | Issue | Needs | Owner action | Extra instructions |
|---|---|---|---|---|---|
| 10 | C2 invariants and policy | #9 | 2 | — | Port `tools/reference/invariants.mjs` and `card-state.mjs` into `packages/domain` (TypeScript); keep reference tests as cross-checks. |
| 11 | C3 commands, events, undo | #10 | 10 | — | — |
| 12 | C4 store driver | #11 | 11 | — | Apply S1 findings; reuse the S1 harness tests. |
| 13 | C5 projections | #12 | 11 | — | — |
| 14 | C6 core process and transports | #13 | 12, 13 | — | Follow the S7 outcome recorded in ADR-0009. |
| 15 | C7 SQLite index and search | #14 | 13 | — | — |
| 16 | U1 app shell | #15 | 14 | Open the app and confirm it feels right | Runs in a browser against the dev core and in Tauri. Read `docs/DESIGN_RULES.md` fully. |
| 17 | U2 portfolio board | #16 | 15, 16 | Review | Attach screenshots made from fixtures to the PR. |
| 18 | U3 flow canvas | #17 | 17 | Review | Attach screenshots or a short recording. |
| 19 | U4 inspector and focused view | #18 | 18 | Review | Demonstrate that an edit in the focused view appears in the full canvas. |
| 19a | U4a in-app command bar | #57 | 19 | Review local command entry, preview/apply and undo | Owner explicitly requested both in-app and MCP before U5; ADR-0017 |
| 20 | U5 list and history | #19 | 19 | Use the app by hand for about a week; file issues for anything that bothers you | — |

For U2, the owner explicitly delegated U1 review/merge and asked to proceed on
2026-11-08. Its U1 implementation prerequisite is satisfied by merged #52;
subjective usability and native launch checks remain pending in step 16. This
exception does not complete any Owner checkbox or accept a model/runtime.

For U3, the owner delegated agent review/merge of U2 and continuation on
2026-11-08. Merged #53 satisfies the implementation prerequisite; portfolio
usability and native checks remain pending, with no Owner box completed.

For U4, the owner delegated agent review/merge of U3 and continuation on
2026-11-08. Merged #54 satisfies the implementation prerequisite; owner usability
and native checks remain pending. No Owner checkbox is completed by this exception.

## Phase C — context and ingestion (M2)

| Step | Item | Issue | Needs | Owner action | Extra instructions |
|---|---|---|---|---|---|
| 21 | I1 adapters, queue, scheduler | #20 | 20 | — | — |
| 22 | I3 extraction | #22 | 21 | — | Use the S2 eval set. Until the decision checkpoint accepts a tier, engineering checks use an explicit provisional local model; no unattended writes or model adoption. |
| 23 | I4 native ContextIndex | #23 | 15, 21 | — | Add the Graphiti adapter only if ADR-0004 accepted it at step 9. |
| 24 | I5 reconciler | #24 | 22, 23 | — | — |
| 25 | I2 first real connector | #21 | 21, 6 | Connect the test account; optionally a real account with a narrow scope | Follow the reviewed S4 outcome through ADR-0011 (supersedes ADR-0002); Activepieces execution remains provisional until recorded. |
| 26 | U6 context view | #25 | 19, 21 | — | — |
| 27 | U7 timeline | #26 | 19 | — | — |

For I1, the owner requested continuation after merged U5 (#59) on 2026-11-09.
That satisfies the implementation prerequisite for step 21; step 20's week-long
usability review remains unchecked. This exception accepts no model, connector
or hardware behavior.

## Phase D — autonomy and questions (M3)

| Step | Item | Issue | Needs | Owner action | Extra instructions |
|---|---|---|---|---|---|
| 28 | A1 questions engine | #27 | 24 | — | — |
| 29 | U8 Questions Center | #28 | 28 | Review | — |
| 30 | A2 priorities and KPIs | #29 | 13, 16 | — | — |

## Phase E — productization (M4)

| Step | Item | Issue | Needs | Owner action | Extra instructions |
|---|---|---|---|---|---|
| 31 | P3 background, sleep/wake, resources | #32 | 21 | Run the Intel manual test (scenario 12) | — |
| 32 | P4 settings, backup, hand-over | #33 | 12, 31 | — | — |
| 33 | P1 MCP server | #30 | 14, 5 | Test in Claude Desktop | Build on the S6 shim. |
| 34 | P2 first-run wizard | #31 | 17, 22 | Run it on a clean macOS user account | ADR-0018: hardware suggestions, model/origin choices, managed downloads, optional API keys; no Terminal |
| 35 | P6 encryption — design | #35 | 12 | Approve the design PR (merging it = approval) | Design doc + ADR only; no implementation. |
| 36 | P6 encryption — implement | #35 | 35 | — | Implement the approved design. |
| 37 | P5 signing, notarization, updates | #34 | 4 | Get an Apple Developer ID and add the GitHub Actions secrets Codex lists | Write the workflow; never commit secrets; no public downloads until signing works. |

## Audit (recurring)

After every 5 steps marked `done`, the next run is an audit instead of a step: check the code and UI against the [AGENTS.md product invariants](../AGENTS.md#product-invariants-you-must-not-break) and the spec's non-goals (progress displays, status columns, Task owners, nested graphs, chat, AI-written summaries, wrong MoSCoW values, unprotected AI writes, data outside the workspace layout, real personal data). Open GitHub issues for violations, fix nothing, and record the audit in PROGRESS.md.

### Owner priority: conversational parity

On 2026-11-09 the owner asked that every manual addition also be generatable
from an AI command, before continuing the list. Bring the command adapter portion
of P1 forward after U4.
P1 remains incomplete until its scoped settings, installation, headless startup,
packaging and owner client checks pass. The owner then explicitly requested BOTH MCP and an in-app command bar; U4a
implements that interaction before U5 under ADR-0017. The owner authorized
agent review/merge and then U5 after U4a implementation review;
existing owner/native checks remain pending. See ADR-0016.


### Standing review and merge authorization

On 2026-11-09 the owner authorized agents to review, approve and merge plan PRs
after required checks pass, then continue one plan unit per request. This does
not complete Owner checkboxes or accept pending model, connector, usability or
hardware results.
