# Codex prompts, in order

Use one fresh Codex session per step. For each step, copy the **standard prompt** below, fill in the item ID and issue number, and paste the step's **extra instructions** (if any) underneath it.

Steps marked **🧑 You** have a part only you can do (real hardware, accounts, Apple Developer ID, or a decision). Codex builds the tools and opens a PR; you run the tests, paste the results into the PR or `docs/spikes/<ID>.md`, then merge. Do not start a step until the steps it depends on are merged.

## Standard prompt

```text
Implement backlog item <ID> (GitHub issue #<N>) in github.com/ethanbidna/fulcrum.

Before writing code, read:
1. AGENTS.md — rules you must follow. They override your defaults.
2. Issue #<N> and the matching section in backlog/BACKLOG.md (acceptance criteria).
3. Every doc and ADR the item links to, plus docs/PRODUCT_SPEC.md sections it touches.
4. Any docs/spikes/*.md reports for spikes this item depends on — their recommendations are binding unless an ADR says otherwise.

Rules:
- Do only this item. Do not start other backlog items or add features the spec excludes (no percent complete, Kanban columns, chat, avatars, Task owners, nested graphs).
- All writes go through the domain command layer. Respect the layer/import table in docs/ARCHITECTURE.md.
- Schemas in schemas/v1 change only with a version and upcaster plan; if you think one must change, explain why in the PR.
- New logic ships with tests. Bug fixes start with a failing test. The reference model (tools/reference) and fixtures/scenarios/expectations.json are executable specs your code must pass where relevant.
- Synthetic data only. No real names, emails, tokens, device paths or screenshots of real data.
- Never claim hardware, connector, model, sync or packaging behavior was validated unless you ran it. Write "not verified" instead.
- If the item conflicts with the spec or an ADR, stop and explain in the PR instead of working around it. If you change a decision, add or update an ADR in the same PR.
- Commit messages: subject ≤ 50 chars, imperative, no trailing period; body explains what and why.

Done when: every acceptance criterion is met or explicitly marked as left for the owner, `npm test` (and any package tests) pass, and a PR is open that references #<N>, lists the acceptance criteria as checkboxes, says how each was verified, and lists anything the owner must do.
```

## Order

### Phase A — feasibility (M0) and scaffold

| Step | Item | Issue | Who | Extra instructions |
|---|---|---|---|---|
| 1 | S1 workspace sync harness | #1 | Codex → **🧑 You**: run the procedure on two Macs with Dropbox and Google Drive, fill in the results table | Build a CLI in `spikes/s1/` (init, device, write, checkpoint, fold, watch) reusing `tools/reference/`; simulated tests for two devices, offline conflicts, torn tail, conflicted copy, zero-byte placeholder, crash mid-append/mid-checkpoint, clone detection; write `docs/spikes/S1-procedure.md` with a results table. Do not change merge semantics; record gaps in `docs/spikes/S1-findings.md` with failing tests. |
| 2 | C1 monorepo scaffold | #8 | Codex | Can run in parallel with step 1. Use pnpm workspaces, keep `tools/test` passing, and move `npm test` to run all workspace tests. Add the gitleaks job if missing. |
| 3 | S2 Llama benchmark | #2 | Codex → **🧑 You**: install Ollama and run the benchmark on the 2019 Intel MacBook Pro (and an Apple Silicon Mac if you have one) | Build the synthetic eval set (≥ 40 items, including colleague-vs-user commitments, priority opinions, injection attempts) and a benchmark script in `spikes/s2/` that records the metrics in the issue and writes a results file. Include exact commands for the owner. Leave the recommendation section for after results. |
| 4 | S7 Tauri + core sidecar packaging | #7 | Codex → **🧑 You**: run the measurement script on the Intel Mac; notarization needs an Apple Developer ID (skip and record as a blocker if you don't have one) | Compare Node SEA vs Bun compile; confirm FTS5 in the chosen SQLite. Script the measurements. |
| 5 | S6 MCP shim | #6 | Codex → **🧑 You**: add it to Claude Desktop and try the listed checks | Serve from `fixtures/states/portfolio.state.json`. Give copy-paste config and a short manual checklist. |
| 6 | S4 connector capability matrix | #4 | Codex → **🧑 You**: create a throwaway Slack workspace and Google account containing only fake messages; register OAuth apps as Codex's instructions describe | Research first, then small prototypes in `spikes/s4/` for Slack and Gmail. Credentials come from environment variables only and are never committed. |
| 7 | S5 Granola access | #5 | Codex (research only) | No reverse-engineering of private files. Output is `docs/spikes/S5.md` with a recommendation. |
| 8 | S3 Graphiti | #3 | Codex → **🧑 You**: run on hardware | Starts after S2 results are in. Compare against a minimal native SQLite alias resolver on the same fixtures. |
| 9 | **🧑 Decision checkpoint** | — | You + Codex | Prompt: "Read every `docs/spikes/*.md`. Update ADRs 0001–0005 and 0007–0009 to Accepted or Superseded based on the measured results, update `docs/OPERATIONS.md` tiers and thresholds and `docs/RISKS.md`, and adjust backlog items whose assumptions changed. Open one PR summarizing every decision change for the owner to approve." Review this PR carefully; it sets the direction for everything after. |

### Phase B — core product on fixtures (M1)

| Step | Item | Issue | Who | Extra instructions |
|---|---|---|---|---|
| 10 | C2 invariants and policy | #9 | Codex | Port `tools/reference/invariants.mjs` and `card-state.mjs` logic into `packages/domain` in TypeScript; keep the reference tests as cross-checks. |
| 11 | C3 commands, events, undo | #10 | Codex | — |
| 12 | C4 store driver | #11 | Codex | Apply S1 findings. Reuse the S1 harness tests. |
| 13 | C5 projections | #12 | Codex | — |
| 14 | C6 core process and transports | #13 | Codex | Follow the S7 recommendation. |
| 15 | C7 SQLite index and search | #14 | Codex | — |
| 16 | U1 app shell | #15 | Codex → **🧑 You**: open it and check it feels right | Must run in a browser against the dev core and in Tauri. Read `docs/DESIGN_RULES.md` fully. |
| 17 | U2 portfolio board | #16 | Codex → **🧑 You**: review | Attach screenshots made from fixtures to the PR. |
| 18 | U3 flow canvas | #17 | Codex → **🧑 You**: review | Attach screenshots or a short screen recording. |
| 19 | U4 inspector and focused view | #18 | Codex → **🧑 You**: review | Show that the focused view is the same graph: edit in focus, confirm the change in the full canvas. |
| 20 | U5 list and history | #19 | Codex | — |

At this point Fulcrum is usable by hand with no AI. Use it for a week before continuing; file issues for what bothers you.

### Phase C — context and ingestion (M2)

| Step | Item | Issue | Who | Extra instructions |
|---|---|---|---|---|
| 21 | I1 adapters, queue, scheduler | #20 | Codex | — |
| 22 | I3 extraction | #22 | Codex | Use the S2 eval set and chosen tier. |
| 23 | I4 native ContextIndex | #23 | Codex | Include the Graphiti adapter only if the step-9 checkpoint accepted it. |
| 24 | I5 reconciler | #24 | Codex | — |
| 25 | I2 first real connector | #21 | Codex → **🧑 You**: connect your test account first, then (only if you're comfortable) a real account with a narrow scope | Follow the S4 recommendation. |
| 26 | U6 context view | #25 | Codex | — |
| 27 | U7 timeline | #26 | Codex | — |

### Phase D — autonomy and questions (M3)

| Step | Item | Issue | Who | Extra instructions |
|---|---|---|---|---|
| 28 | A1 questions engine | #27 | Codex | — |
| 29 | U8 Questions Center | #28 | Codex → **🧑 You**: review | — |
| 30 | A2 priorities and KPIs | #29 | Codex | — |

### Phase E — productization (M4)

| Step | Item | Issue | Who | Extra instructions |
|---|---|---|---|---|
| 31 | P3 background, sleep/wake, resources | #32 | Codex → **🧑 You**: run the Intel manual test (scenario 12) | — |
| 32 | P4 settings, backup, hand-over | #33 | Codex | — |
| 33 | P1 MCP server | #30 | Codex → **🧑 You**: test in Claude Desktop | Builds on the S6 shim. |
| 34 | P2 first-run wizard | #31 | Codex → **🧑 You**: run it on a clean macOS user account | — |
| 35 | P6 workspace encryption | #35 | Codex → **🧑 You**: approve the design ADR before implementation | Ask Codex to stop after the design PR; implement in a second session. |
| 36 | P5 signing, notarization, updates | #34 | **🧑 You**: Apple Developer ID and GitHub Actions secrets | Codex writes the workflow; you add the secrets. Don't publish downloads until this is done. |

## After every few steps

Every few steps, in a fresh session, ask Codex for an audit:

```text
Audit the repo against AGENTS.md "Product invariants" and docs/PRODUCT_SPEC.md non-goals. Search the code and UI for: percent/progress displays, status columns, Task owners/assignees, nested graphs, embedded chat, AI-written summaries, MoSCoW values other than Must/Should/Could/Won't Do, unprotected AI writes, data written outside the workspace layout, and any real personal data. Open issues for each violation; fix nothing in this session.
```
