# Progress

Agents update this file in every PR; the owner ticks the **Owner** boxes. Step definitions are in [PLAYBOOK.md](PLAYBOOK.md); the procedure is in [AGENTS.md](../AGENTS.md#continuing-the-plan).

Statuses: `todo` · `waiting-owner` (agent work merged; owner action pending) · `done` · `blocked` (reason in Notes).

Steps done since last audit: 3

See [the remaining-work checklist](REMAINING.md) for the current follow-up queue and acceptance checks.

## Steps

| Step | Item | Status | Owner | PR | Notes |
|---|---|---|---|---|---|
| 1 | S1 workspace sync harness | waiting-owner | [ ] | #36 | Harness merged; real two-Mac test pending |
| 2 | C1 monorepo scaffold | done | n/a | #37 | Workspace, generated types, layer lint, and CI checks |
| 3 | S2 Llama benchmark | waiting-owner | [ ] | #38, #43, #44, #90 | Intel 3B/8B runs recorded. [Qwen3.5 holdout review](../docs/spikes/S2-results/qwen35-holdout/review.md) recommends keeping this configuration out of automatic extraction. Owner checks pending. |
| 4 | S7 Tauri + core sidecar packaging | waiting-owner | [ ] | #40 | Node/Bun apps, Rust tests and FTS5 pass Intel/ARM CI; controlled hardware/universal pending; no Developer ID |
| 5 | S6 MCP shim | waiting-owner | [ ] | #41 | SDK and Inspector stdio checks pass; Claude Desktop and confirmation UX pending |
| 6 | S4 connector capability matrix | waiting-owner | [ ] | #39, #92, #93, #94 | Gmail first; [read-only piece prototype](../spikes/s4/gmail-piece/README.md) resumes through SourceAdapter and the SQLite queue in the synthetic probe; live OAuth and footprint checks pending |
| 7 | S5 Granola access | done | n/a | #42 | API default through Activepieces; CSV fallback only; official research, no live access |
| 8 | S3 Graphiti | waiting-owner | [ ] | #81 | Shared-fixture native/Graphiti harness, locked local-only clients and count-only reports; Intel store probe fails OS error 86; model/Apple Silicon comparison pending |
| 9 | Decision checkpoint | waiting-owner | [ ] | #82 | Engineering checkpoint and ADR dispositions prepared; final model/hardware/sync/connector/release adoption review awaits recorded owner results |
| 10 | C2 invariants and policy | done | n/a | #45 | TypeScript invariants, affected validation, P1–P12 policy and golden projections; model-independent sequencing authorized |
| 11 | C3 commands, events, undo | done | n/a | #46 | Shared command API, atomic events and question resolutions, compensating undo, retry safety and replay checks |
| 12 | C4 store driver | done | n/a | #47 | Durable driver, atomic batches/checkpoints, locking/identity, placeholders, golden fixture and real process-crash tests; sync-provider checks remain S1 |
| 13 | C5 projections | done | n/a | #49 | Typed read queries, canonical focused graph references, waiting/action rail and replay-derived history; synthetic checks only |
| 14 | C6 core process and transports | done | n/a | #50 | Authenticated Unix core, Keychain driver, durable domain binding, UI transport and separate dev bridge; real Keychain/Tauri/signing remain unverified |
| 15 | C7 SQLite index and search | done | n/a | #51 | Machine-local FTS5, incremental snapshot-derived updates, scoped/excerpt-aware search, count progress and cache rebuild recovery |
| 16 | U1 app shell | waiting-owner | [ ] | #52 | Merged; Intel/ARM native tests/compile and browser review pass; actual native launch and owner feel pending |
| 17 | U2 portfolio board | waiting-owner | [ ] | #53 | Grouped fixture cards, independent sorting, atomic manual ordering and contextual rail; owner review pending |
| 18 | U3 flow canvas | waiting-owner | [ ] | #54 | Editable canonical flow with typed relationships and session undo; browser/native review limits recorded |
| 19 | U4 inspector and focused view | waiting-owner | [ ] | #55 | Merged; contextual inspector, canonical Task focus and child checklists; owner review pending |
| 19a | U4a in-app command bar | waiting-owner | [ ] | #58 | Merged; inline request/review/apply/undo; 398 tests and Intel/ARM builds pass; owner usability pending |
| 20 | U5 list and history | waiting-owner | [ ] | #59 | Merged; canonical List and evidence-linked History; 405 tests and Intel/ARM builds pass; owner week-long usage pending |
| 21 | I1 adapters, queue, scheduler | done | n/a | #61 | Synthetic adapter, atomic local queue, opt-in scopes, P11 scheduler and seven-day freshness tests; canonical-hash handover dedupe defect #63 fixed by P4 #77; live connectors/native sleep remain later |
| 22 | I3 extraction | done | n/a | #62 | Typed model-neutral runtime, Ollama driver, repair once, UTF-16 evidence spans, 48-case mock CI and bounded local smoke; quality/adoption and unattended reconciliation remain pending |
| 23 | I4 native ContextIndex | done | n/a | #65 | Native SQLite alias/external-ID resolution, FTS and temporal retrieval; scenario 6 question dedupe/selection/undo and rebuild/core-failure tests; no Graphiti or unattended reconciliation |
| 24 | I5 reconciler | done | n/a | #66 | Pure typed plans, exact matching, temporal claims, protected suggestions, contextual questions and run undo; synthetic Domain/S2 checks; no unattended consumer or model adoption |
| 25 | I2 first real connector | blocked | [ ] | #67 | Gmail selected for personal use. S4 live results and production execution mode are pending; see [prerequisite review](../docs/reviews/I2-prerequisites.md) |
| 26 | U6 context view | done | n/a | #73 | Canonical aggregate/object evidence, provenance/claims/two clocks, safe links, stale-response guards and Storybook keyboard/accessibility checks; synthetic only |
| 27 | U7 timeline | done | n/a | #75 | Optional canonical target-date/milestone timeline, explicit undated prerequisites, simple SVG plus accessible list; synthetic browser/domain checks |
| 28 | A1 questions engine | done | n/a | #68 | Deterministic question lifecycle, deferral/evidence consolidation, newer-evidence obsolescence, production fold conflicts and atomic restore choices; synthetic core/replay checks; real two-Mac sync remains S1 |
| 29 | U8 Questions Center | waiting-owner | [ ] | #69 | Grouped/scoped question review, contextual inspector actions, evidence links, defer and undo; automated/browser checks pass; owner usability review pending |
| 30 | A2 priorities and KPIs | done | n/a | #76 | Tied objective ranks, optional weights/KPIs, canonical alignment and retained AI evidence; MoSCoW isolation and browser/domain checks |
| 31 | P3 background, sleep/wake, resources | waiting-owner | [ ] | #70 | Native signals, configurable admission, queue cancellation and runtime limits; synthetic checks pass; Intel scenario 12 pending |
| 32 | P4 settings, backup, hand-over | done | n/a | #77 | Eight settings routes, verified local backups/retention, fresh-identity restore, read-only historical views and handover; fixes #63; ADR-0022 container change; synthetic checks only |
| 33 | P1 MCP server | waiting-owner | [ ] | #78 | Scoped live settings, disclosure/read-only/excerpt gates, private activity, confirmed client install, headless lifecycle and UI/MCP parity; packaged runtime and actual Claude check pending |
| 34 | P2 first-run wizard | waiting-owner | [ ] | #79 | Native workspace/device setup, shared model chooser, pinned managed downloads, scoped/budgeted optional provider keys and synthetic tests; clean-user/native/download/provider acceptance pending P5 |
| 35 | P6 encryption — design | done | n/a | #71 | ADR-0021 and v2 encoding/key/recovery/copy-migration contract; design only, step 36 implements; merging the PR is approval |
| 36 | P6 encryption — implement | waiting-owner | [ ] | #83 | v2 storage, native recovery, lock, migration and encrypted restore; local rerun recorded in #84; signed Keychain and two-Mac acceptance pending |
| 37 | P5 signing, notarization, updates | waiting-owner | [ ] | #80 | Universal production SEA resources, signing/notary workflow, explicit signed updater and generated notices; public signing and release setup deferred for personal use |

## Development startup follow-up

The documented `pnpm dev` entry now selects the ESM parser build, matching the core/release bundlers. The startup regression failed before the fix and passes afterward. Full checks pass with 79 reference and 557 workspace tests. Owner acceptance remains pending.

## Local verification

- 2026-11-10 — [Independent checks](../docs/reviews/local-checks-2026-11-10.md): 635 reference/workspace tests, 49 Storybook stories, seven native tests, Intel core/MCP executable self-tests and release notices pass. Follow-up browser edit/history/command/question checks pass; the release environment still needs configuration. Owner acceptance remains pending.

## Owner to-do

### Step 36 — P6 signed encryption acceptance

Follow [the P6 owner procedure](../docs/reviews/P6.md) using the provisioned
Developer ID build and disposable synthetic workspaces. Record results there,
then tick the Owner box for step 36.

Agents list the exact instructions for each `waiting-owner` step here, newest first. When finished, tick the step's **Owner** box above (edit this file on GitHub) and delete its entry below.

### Step 9 — Final feasibility/adoption review

Follow [docs/CHECKPOINT.md](../docs/CHECKPOINT.md), after recording the pending
S1/S2/S4/S6/S7/S3 and release procedures. Keep failed/unavailable results, update
the evidence matrix and affected ADRs/Operations/Risks, open and merge the final
adoption PR, then tick the Owner box for step 9. The engineering checkpoint PR
approves direction only and does not complete the earlier Owner boxes.

### Step 37 — P5 signed releases

Follow [P5 release procedure](../docs/reviews/P5.md): configure release-environment secrets/public key, dispatch the workflow, inspect notarized universal artifacts, test clean-user launch and signed update/cancellation/failure, record results, then tick the Owner box for step 37. No release was signed or published by the implementation.

### Step 8 — S3 Graphiti comparison

Follow [the S3 procedure](../spikes/s3/README.md): install the isolated locked
Python environment, run the no-inference store probe, then repeated explicit
local-model/native comparisons only after a supported store exists and S2 is
finished. Review count-only reports and observations in docs/spikes/S3-results,
update docs/spikes/S3.md and ADR-0004, then tick the Owner box for step 8. The
current Intel store failure is not a successful Graphiti measurement.

### Step 34 — P2 clean-user onboarding review

1. After P5 provides the signed application, install it in Applications on a clean
   macOS user account. Follow [docs/reviews/P2.md](../docs/reviews/P2.md), without
   Terminal or development tools and with synthetic data only.
2. Exercise workspace creation/open/retry, cloud-folder offline acknowledgment,
   person/device naming, kept and moved ingestion, no-AI/source skips and first
   initiative. Quit/relaunch and revisit setup from Settings.
3. Inspect model/origin choices, then explicitly test managed download/cancel/
   retry/verification and compatibility after any separate benchmarks finish.
   Optional provider tests require your own test key, sharing scope and token
   allowance; observe Keychain approval and denial. No model is adopted by a
   synthetic compatibility pass.
4. Record versions/results/blockers in `docs/reviews/P2.md`, then tick the Owner
   box for step 34. Do not commit keys, paths, real work or provider responses.

### Step 33 — P1 Claude Desktop and headless review

1. After P5 provides the signed application, install it in Applications and open
   a disposable synthetic workspace. Follow [docs/reviews/P1.md](../docs/reviews/P1.md).
2. In Settings → MCP, acknowledge sharing, enable read-only access, save and
   confirm Add to Claude Desktop. Quit/reopen Claude Desktop. Check named read
   tools, excluded scopes, excerpt opt-in, hidden questions and write denial.
3. Enable writes explicitly; create/update/undo a synthetic Task. Check History
   actor, activity and a declined confirmation when supported. Quit Fulcrum and
   retry a client read to test packaged headless startup. Disable sharing and
   verify denial; remove only the Fulcrum client entry afterward.
4. Record app/client versions, results and blockers in `docs/reviews/P1.md`,
   then tick the Owner box for step 33. Do not tick packaging or S6 checks from
   synthetic SDK results. No credentials, real content or personal paths in git.

### Step 31 — P3 Intel resource review

1. Wait for S2 to finish. Install Node 22 LTS, pnpm 10.11.0, stable Rust/Cargo
   and Xcode Command Line Tools. Run:

   ```sh
   git fetch origin
   git worktree add ../fulcrum-p3-review origin/main
   cd ../fulcrum-p3-review
   corepack enable
   pnpm install --frozen-lockfile
   pnpm check
   pnpm --filter @fulcrum/desktop build
   cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
   node tools/p3-review.mjs
   ```

2. Run the printed second-terminal native-shell command. Follow
   [docs/reviews/P3.md](../docs/reviews/P3.md) for pause/resume, presentation,
   real power, native sleep/wake, unavailable signals and the separate explicit
   installed-model trial on its owned loopback server. Do not disturb benchmark
   processes. Mock trials do not validate model CPU/memory or pause-to-idle.
3. Record versions, CPU/RSS/swap/thermal, pause-to-idle time, UI response,
   sleep/wake/grace, power and idle unload in `docs/reviews/P3.md`, with untested
   checks/blockers explicit; then tick the Owner box for step 31. Model adoption,
   connector, packaging and other Owner checks remain pending.

### Step 29 — U8 Questions Center review

1. Install Node 22 LTS and pnpm 10.11.0. From the repository root run:

   ```sh
   git fetch origin
   git worktree add ../fulcrum-u8-review origin/main
   cd ../fulcrum-u8-review
   corepack enable
   pnpm install --frozen-lockfile
   pnpm check
   pnpm dev
   ```

2. Open `http://127.0.0.1:5173/#questions` in the disposable synthetic workspace.
   Follow the answer, defer, undo, evidence, exact-context, keyboard and narrow
   window checklist in [docs/reviews/U8.md](../docs/reviews/U8.md). Do not interrupt
   the separate benchmark checkout; if 5173 is occupied, stop your prior preview
   before starting this one.
3. Record observations or blockers in `docs/reviews/U8.md`, then tick the Owner
   box for step 29 above. Other owner/native/hardware checks remain unchanged.

### Step 20 — U5 List and History review

1. With Node 22 LTS and pnpm 10.11.0, run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`. Open `http://127.0.0.1:5173`; choose Vendor evaluation. Use synthetic data only.
2. Open List. Check containment indentation, type, state, role, date, prerequisites and source counts. Edit a title directly; Enter or blur saves, Escape cancels. Use the command input for generated edits. Return to Flow and confirm it is the same node.
3. Open History. Inspect actor, command, before/after and attached evidence. Undo the title event; confirm restoration in List and Flow. Domain conflicts must show an error without silently overwriting later work. AI-run undo applies to the entire displayed run, including other initiatives.
4. Try browser Back/Forward/reload and narrow-window table scrolling. Evidence links open originals only when a safe HTTP(S) permalink exists. Native external-link, Keychain and visible-window behavior remain separately unverified.
5. Use the app by hand for about a week; file issues for anything that bothers you. Record observations in `docs/reviews/U5.md`, then tick only the Owner box for step 20. Ctrl-C stops/removes the disposable fixture. Other Owner checks and model adoption remain pending.

### Step 19a — U4a command review

1. Install Node 22 LTS and pnpm 10.11.0. Run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`. Open `http://127.0.0.1:5173`; choose Vendor evaluation. Use synthetic content only.
2. Press Cmd-K, enter `Rename Test design capabilities to Synthetic design review.`, then Enter. Review From/To, press Cmd-Enter to apply, and use Undo command. This exact rename does not need a model. Nothing should change before Apply.
3. To check generation, start an existing local Ollama with the installed provisional `qwen3:4b-instruct-2507-q4_K_M` model. No download is required by the app. Focus Test design capabilities and enter `Add a child task called Prepare launch notes under this task.` Review the Task and contains link before Apply. Confirm the parent stays open; Undo removes both. Generation can take up to two minutes on this Intel Mac. Invalid/deadline failures keep text and write nothing.
4. Try Cmd-K, Enter, Cmd-Enter, Escape, changing selection during planning, a narrow window, and Edit directly in the inspector. External MCP remains separately disabled unless explicitly configured; this UI does not enable sharing.
5. Record observations in `docs/reviews/U4a.md`, then tick only the Owner box for step 19a. Model adoption, native visible-window/Keychain/CSP, full P1 setup, sync and other Owner checks remain pending. Ctrl-C stops/removes the disposable fixture. The owner authorized agent review/merge and continuation to U5 while these usability checks remain unchecked.

### Step 19 — U4 inspector and focus review

1. Install Node 22 LTS and pnpm 10.11.0. Run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`. Wait for fixture seeding and open `http://127.0.0.1:5173`; select Vendor evaluation.
2. Select a node or relationship. Check attributes, state, direct evidence-source count and questions scoped to that exact object. Hide/reopen the inspector; the graph stays available. Edit a title/details, a state, or a relationship label; failures must retain the draft and show the domain message.
3. Fit graph, then double-click Test design capabilities (or use Focus task). Check the focused Task's children and immediate prerequisite references. Edit a child title; use the Vendor evaluation breadcrumb to return and confirm the same edit in the full canvas. Undo should restore it. Browser Back/Forward and reload must preserve the focused route.
4. In the parent's inspector, complete a child checkbox; verify only the child's state changes, not the parent's. Shared/prerequisite reference records are read-only here; Open home initiative returns to the full graph for editing. Inspect the focused-edit/full-edit screenshots under `apps/desktop/.impeccable/review/u4/` for the agent's demonstration.
5. Check narrow-window scrolling, focus and inspector collapse. Record observations in `docs/reviews/U4.md`, then tick only the Owner box for step 19. Native visible-window/Keychain/CSP, hardware, connector, model adoption and other Owner boxes remain pending. Ctrl-C removes the disposable session.

### Step 18 — U3 flow review

1. With Node 22 LTS and pnpm 10.11.0, run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`. Wait for the synthetic fixture, then open `http://127.0.0.1:5173` and select Vendor evaluation.
2. Check top-to-bottom flow, four primitive glyphs, named light group frames, dashed inferred relationships and labelled Decision routes. Pan/zoom/fit, drag a node, and use Auto-layout. Positions/viewport are ephemeral and do not alter canonical records or sync.
3. Add a synthetic Task; select it, Rename, save and reload to confirm durability. Drag between handles, choose a relationship and submit. Also try Connect nodes with the keyboard. Attempt Contains between a Task and Dependency and confirm the inline domain message. Delete a synthetic node/relationship; use Undo and ⌘Z outside text inputs. Native text-input undo stays local to its field.
4. Check narrow-window layout and back navigation. Record observations in `docs/reviews/U3.md`. Full inspector/focused navigation belongs to U4; native launch/Keychain/CSP and sync/hardware acceptance remain separately unverified. Ctrl-C stops the disposable session.
5. Tick only the Owner box for step 18 after review. Prior owner boxes remain pending; owner-delegated agent review/merge allowed continuation after U2.

### Step 17 — U2 portfolio review

1. Install Node 22 LTS and pnpm 10.11.0. From the repository root run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`. Allow the disposable fixture to finish seeding; open `http://127.0.0.1:5173`.
2. Review all four fixture card states and all five grouping options. Change sorting independently; only Manual order enables dragging and earlier/later controls. Reorder, reload and confirm it persisted. Group membership must not change. Collapse/reopen the context rail and inspect named recent changes.
3. Use New initiative to create synthetic content only. Check keyboard focus, narrow-window layout, quiet question counts and the explicit unknown freshness indicator. Proposed initiatives must not appear as board cards. No flow canvas or Questions Center is implemented in U2.
4. Record observations/blockers in `docs/reviews/U2.md`; screenshots are in `apps/desktop/.impeccable/review/u2/`. Ctrl-C stops/removes the disposable session. Native launch/Keychain still follow the separate U1 review instructions.
5. Tick only the Owner box for step 17 above after review. The owner explicitly authorized this step after agent review/merge of U1; pending U1 usability/hardware checks remain unchecked.

### Step 16 — U1 app shell review

1. Install Node 22 LTS and pnpm 10.11.0. From the repository root run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm dev`.
2. Open `http://127.0.0.1:5173`. Review the four destinations, selected location, Tab/Shift-Tab/Enter, browser back/forward, quiet question count and narrow-window layout. This is a disposable synthetic workspace; no model, connector or Keychain access. Ctrl-C stops it.
3. For native review, install stable Rust/Cargo and Xcode Command Line Tools; follow the exact two-terminal core/`pnpm --filter @fulcrum/desktop tauri dev` commands in `apps/desktop/README.md`. Use only the synthetic workspace. Record Keychain prompts and native launch blockers explicitly; standalone packaging/signing is not accepted by this step.
4. Record observations and any blockers in `docs/reviews/U1.md`. Confirm the shell feels right; unfinished portfolio/priorities/question/settings workflows are expected and explicitly labeled.
5. Tick the Owner box for step 16 above only after that review. Do not tick other pending owner checks.

### Step 5 — S6 Claude Desktop check

Follow [spikes/s6/README.md](../spikes/s6/README.md) in full; use only the committed synthetic fixture.

1. Install Node 22 LTS and Claude Desktop. From the repo root run `corepack enable`, `pnpm install --frozen-lockfile` and `pnpm check`.
2. Run `node spikes/s6/config.mjs`. Back up Claude Desktop's configuration, then merge the printed server entry into its existing `mcpServers` object using Settings → Developer → Edit Config. Do not overwrite other entries or commit generated paths. Fully quit and restart Claude Desktop.
3. Complete the README's list/graph/evidence/write-denial checks. Record `probe_client_capabilities` output as declared support only; it does not prove a confirmation dialog.
4. Repeat after generating with `node spikes/s6/config.mjs --excerpts`, then with `node spikes/s6/config.mjs --initiative 01000000-0000-7000-8000-000000000001`. Restart after each config edit. Verify excerpt wrapping and denial of excluded initiative reads.
5. Remove this server entry when finished. Record versions and pass/fail/blockers in `docs/spikes/S6.md`, review the synthetic results, and open a results PR referencing #6. Claude Desktop and confirmation UX remain unverified until recorded; never commit account details, personal paths or real chats.
6. Tick the Owner box for step 5 above.

### Step 4 — S7 packaging comparison

Wait until S2 finishes before controlled builds/measurements. Follow [spikes/s7/README.md](../spikes/s7/README.md) in full; it includes paths for both architectures, universal assembly and notarization.

1. Install Node 22 LTS, stable Rust/Cargo, Bun and Xcode Command Line Tools. Run `corepack enable`, `pnpm install --frozen-lockfile` and `pnpm check` from the repo root.
2. Run `node spikes/s7/build.mjs node app`, `cargo test --manifest-path spikes/s7/src-tauri/Cargo.toml`, and `node spikes/s7/build.mjs bun app`. Use the committed Cargo.lock. Record tool versions and any compilation/launch blockers; CI validation does not replace target-hardware checks.
3. Run the exact `measure.mjs` sidecar/app commands in the README at least five times per runtime on Intel, then repeat on Apple Silicon if available. Record visible-window timing and Activity Monitor shell/sidecar/WebKit RSS separately; health-RPC timing is not UI first paint.
4. Follow the README's two-architecture universal build and execute it on both targets. Record signing/notarization acceptance or **no Developer ID**; this Mac's identity check currently found none.
5. Review and commit reports under `docs/spikes/S7-results/`, fill `docs/spikes/S7.md`, and open a results PR referencing #7. Do not commit binaries, identities, paths, credentials or raw build logs.
6. Tick the Owner box for step 4 above.

### Step 6 — S4 connector tests

Wait for the S2 benchmark to finish before live API/runtime measurements. Use only new throwaway accounts containing fake content; do not use connected real accounts.

1. Install Node 22 LTS and follow [spikes/s4/README.md](../spikes/s4/README.md) in full. Run `npm ci` and `npm test` (after C1 merges, use `corepack enable` and `pnpm install --frozen-lockfile` instead of `npm ci`).
2. Create the fake Slack workspace/channel/thread. Register the internal app with the documented read-only user scopes and enter its token/channel ID through the procedure's hidden/environment prompts. Run `node spikes/s4/cli.mjs slack backfill`, then `node spikes/s4/cli.mjs slack resume` while incomplete. Test the selected private/DM scopes and exact permalink manually.
3. Create the fake Google account/label and own OAuth test project, enable Gmail API and only `gmail.readonly`, then follow the manual token/refresh setup. Run `node spikes/s4/cli.mjs gmail backfill`, `node spikes/s4/cli.mjs gmail resume` while incomplete, and `node spikes/s4/cli.mjs gmail incremental` after adding fake mail. Record refresh, quota, history expiry and open-original limitations.
4. Follow the optional Activepieces library/runtime comparison instructions after S2. Record real versions, permissions, setup friction, RAM/disk and any not-run reasons across all six source × option rows in `docs/spikes/S4.md`.
5. Review count-only reports under `spikes/s4/out/`; commit reviewed copies under `docs/spikes/S4-results/` with observations in a PR referencing #4. Never commit continuation files, tokens, IDs, links, addresses, paths or raw provider responses.
6. Tick the Owner box for step 6 above.

### Step 3 — S2 local Llama benchmark

1. Read [the prepared review](../docs/spikes/S2-results/review.md) and selected examples. The raw 3B/8B runs, all-case appendix and offline score audit are in [PR #43](https://github.com/ethanbidna/fulcrum/pull/43). Review the intended extraction behavior; neither configuration is ready for automatic writes.
2. The installed 3B and 8B quality runs are complete. Do not download/run 1B; it was excluded by owner choice. Keep remaining checks limited to `llama3.2:3b-instruct-q4_K_M` and `llama3.1:8b-instruct-q4_K_M` using each `--model TAG` separately.
3. Follow [docs/spikes/S2.md](../docs/spikes/S2.md) for separate unplugged battery trials, the Finder/TextEdit responsiveness check, and interrupted pause timing. Preserve failed/incomplete measurements. Apple Silicon is optional if available; record skipped hardware honestly. Do not infer a pass from the completed AC quality runs.
4. Record observed responsiveness, fans, pause seconds and reviewed thermal log references under `docs/spikes/S2-results/` in a results PR referencing #2. Keep unobserved manual fields null; do not commit personal paths or real content. Hardware tiers/thresholds remain provisional until the decision checkpoint.
5. Tick the Owner box for step 3 above only after completing/reviewing the required owner action.

### Step 1 — S1 two-Mac sync test
You need two Macs (or a Mac plus a macOS VM), each signed in to the same Dropbox account, and later the same Google account in Google Drive for desktop. Use only the synthetic labels the procedure gives; no real work content.

1. On both Macs: clone the repo, install Node 22.13+ (22 LTS), then run `corepack enable` and `pnpm install --frozen-lockfile` and `npm test` from the repo root.
2. Follow [docs/spikes/S1-procedure.md](../docs/spikes/S1-procedure.md) top to bottom for each provider row: local folder, Dropbox, Google Drive (mirror mode), Google Drive (stream mode).
3. Fill in the results table at the end of that procedure (or attach sanitized results to issue #1). Check for personal paths or account names before committing.
4. Tick the Owner box for step 1 above.

Codex can keep working on steps that don't depend on this (2–7) in the meantime.

## Audit log

- 2026-11-10 — Recurring audit through U6 / #73: no new confirmed violations; existing #63 remains open. See [evidence and limits](../docs/audits/2026-11-10-product.md). Owner checks unchanged.

- 2026-11-09 — Recurring audit through I3 / #62: one confirmed handover-dedupe schema mismatch filed as #63; no implementation fixes. See [audit evidence and limits](../docs/audits/2026-11-09-product.md). Audit PR #64; owner checks and model adoption remain pending.

- 2026-11-08 — First recurring audit through C4 / #47: no product-invariant violations identified in the implemented scope; no new issues or implementation fixes. See [audit evidence and limits](../docs/audits/2026-11-08-core.md). Audit PR #48; owner checks remain unchanged.
