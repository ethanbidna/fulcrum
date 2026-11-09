# Implementation backlog

Ordered. Work top to bottom within a milestone; spikes (M0) come before UI feature work. Each item is mirrored as a GitHub issue (created from this file by `tools/create-issues.mjs`); this file is the source of truth for scope and acceptance criteria.

Conventions for every item: follow [AGENTS.md](../AGENTS.md); new logic ships with tests; spikes produce a short report in `docs/spikes/<id>.md` with measured numbers and a recommendation, and update the relevant ADR status. Spikes may write throwaway code under `spikes/<id>/`; it is not product code.

## M0 — Feasibility spikes

### S1 · Spike: workspace event logs under Dropbox and Google Drive on two Macs
Labels: spike, store
Validate [WORKSPACE_FORMAT.md](../docs/WORKSPACE_FORMAT.md) with real sync clients. Build a tiny CLI (`spikes/s1/`) that appends synthetic events to `log/<deviceId>/` using the reference format and folds with `tools/reference/fold.mjs`.

**Acceptance criteria**
- [ ] Two Macs (or one Mac + one VM) on Dropbox; repeat on Google Drive for desktop in both mirror and stream modes.
- [ ] Concurrent offline edits to the same field on both devices converge to identical state on both after reconnect; conflict detected.
- [ ] Measured: propagation latency, occurrence of torn tails, conflicted copies, placeholder/online-only files, rename atomicity for checkpoints.
- [ ] Clone-detection procedure tested (copy `device.json` to the second Mac).
- [ ] Report recommends any format changes; ADR-0005 status updated.

### S2 · Spike: Llama extraction quality and resource use on a 2019 Intel MacBook Pro and Apple Silicon
Labels: spike, ai
**Acceptance criteria**
- [ ] Synthetic eval set (≥ 40 items) covering the candidate kinds in [INGESTION.md](../docs/INGESTION.md#5-extract-local-llama), including user vs. colleague commitments, priority opinions and injection attempts; committed under `spikes/s2/eval/`.
- [ ] For Llama 3.2 1B, 3B and Llama 3.1 8B (4-bit) via Ollama with JSON-schema output: JSON validity %, candidate precision/recall, misattributed-Task rate, injection-followed rate, tokens/s, peak RSS, swap, thermal state, battery drain per 100 items.
- [ ] Confirms UI stays responsive (core and Ollama at background QoS) and that pausing stops CPU use within 5 s.
- [ ] Recommended tiers and thresholds written back into [OPERATIONS.md](../docs/OPERATIONS.md); ADR-0003 updated.

### S3 · Spike: Graphiti with local Llama and an embedded graph store
Labels: spike, ai
**Acceptance criteria**
- [ ] Graphiti running against Ollama's OpenAI-compatible endpoint with at least one graph store whose license and maintenance status are acceptable (document the choice).
- [ ] On synthetic episodes: LLM calls per episode, episodes/minute, RSS, alias dedup accuracy on the scenario-6 fixtures, rebuild time from workspace data.
- [ ] Comparison against the native SQLite ContextIndex approach on the same fixtures.
- [ ] Go/no-go recommendation per hardware tier; ADR-0004 updated.

### S4 · Spike: connector capability matrix — Activepieces options vs. native adapters (Slack, Gmail)
Labels: spike, ingestion
**Acceptance criteria**
- [ ] For Slack and Gmail, each of: Activepieces pieces as libraries, self-hosted Activepieces runtime, native SDK — record auth/refresh, backfill depth, incremental cursor, threads/DMs, permalink precision (message-level, thread-level), rate limits, memory/disk footprint, install steps for a non-technical user.
- [ ] OAuth reality documented: Google restricted-scope verification needs, Slack app distribution/admin approval, "bring your own OAuth app" path for alpha.
- [ ] Uses a test workspace/account with synthetic content only; no real data committed.
- [ ] Recommendation for the `SourceAdapter` implementation strategy; ADR-0002 updated.

### S5 · Spike: Granola access path
Labels: spike, ingestion
**Acceptance criteria**
- [ ] Identify supported ways to get meeting notes/transcripts out of Granola for a single user (official API, export, integrations); document terms-of-service constraints.
- [ ] Recommend an adapter approach or a user-initiated import flow; no reverse-engineering of private caches without documented permission.

### S6 · Spike: MCP stdio shim with Claude Desktop
Labels: spike, mcp
**Acceptance criteria**
- [ ] Minimal `fulcrum-mcp` that serves `list_initiatives` and `get_graph` from `fixtures/states/portfolio.state.json` over stdio via the MCP TypeScript SDK.
- [ ] Verified in Claude Desktop and one other MCP client; config entry documented.
- [ ] Read-only enforcement and an `untrustedExcerpt` response demonstrated; elicitation support checked.
- [ ] ADR-0007 updated with findings.

### S7 · Spike: package a TypeScript core sidecar in Tauri for Intel and Apple Silicon
Labels: spike, packaging
**Acceptance criteria**
- [ ] Hello-world Tauri 2 app that launches a Node (SEA) or Bun-compiled sidecar, talks JSON-RPC over a Unix socket, and runs SQLite with FTS5 (built-in `node:sqlite` or `bun:sqlite`).
- [ ] Measured on both architectures: bundle size, cold start, idle RSS of shell + sidecar.
- [ ] Universal binary build and a notarization dry run (or documented blockers without a Developer ID).
- [ ] ADR-0009 and ADR-0001 updated.

## M1 — Core product (fixtures only, no real sources)

### C1 · Monorepo scaffold, CI and generated schema types
Labels: core
**Acceptance criteria**
- [ ] pnpm workspace with `apps/desktop`, `packages/{schema,domain,store,index,mcp,ingest,sources,llm,context}` per [ARCHITECTURE.md](../docs/ARCHITECTURE.md#layers-and-boundaries); TypeScript strict; Vitest.
- [ ] `packages/schema` generates TS types from `schemas/v1`; CI fails on regeneration diff.
- [ ] Lint rule enforcing the layer import table.
- [ ] Existing `tools/test` keeps passing in CI; gitleaks secret scan in CI.

### C2 · Domain: records, invariants and autonomy policy
Labels: core
Depends on: C1
**Acceptance criteria**
- [ ] Invariant checks with the exact codes in [DATA_MODEL.md](../docs/DATA_MODEL.md#invariants), run on the affected subgraph per command.
- [ ] Policy rules P1–P12 from [DOMAIN_COMMANDS.md](../docs/DOMAIN_COMMANDS.md#autonomy-policy), each with a passing and a denied test.
- [ ] Passes `fixtures/scenarios/expectations.json` (`portfolio`, `decisionOutcome`).

### C3 · Domain: command layer, change events and undo
Labels: core
Depends on: C2
**Acceptance criteria**
- [ ] `Domain.execute` for the v1 command catalog; results/errors exactly as specified.
- [ ] Commands produce field-level ops with correct `baseEventId`; idempotency keys honored.
- [ ] `change.undo` and `run.undo` produce compensating events; undo-after-newer-edit surfaces a conflict; undoing an AI change records a Rejection.
- [ ] Question resolution executes its commands atomically in one event.

### C4 · Store driver: segments, checkpoints, locking, recovery
Labels: core, store
Depends on: C1, S1
**Acceptance criteria**
- [ ] Implements `WorkspaceStore` per [WORKSPACE_FORMAT.md](../docs/WORKSPACE_FORMAT.md): fsync'd appends, daily/1 MiB segment rotation, atomic checkpoints, keep-3 policy, exclusive core lock, clone detection, torn-tail and conflicted-copy handling, placeholder detection.
- [ ] Passes `crossDeviceCollision` expectations against `fixtures/workspace-example`.
- [ ] Crash test: kill during append and during checkpoint write; reopen without loss of acknowledged events.
- [ ] Older-app read-only mode via `minReaderVersion`.

### C5 · Projections: card state, rail, focused view, history
Labels: core
Depends on: C3
**Acceptance criteria**
- [ ] Card state, actionability, reached/skipped, AND/OR prerequisites as in [DATA_MODEL.md](../docs/DATA_MODEL.md#derived-state); matches reference expectations.
- [ ] `graph.focus(nodeId)` returns a filtered view of the same records (contains-subtree + immediate prerequisites as references).
- [ ] Rail: next available actions, waiting on, meaningful changes, question count.
- [ ] No projection outputs a percentage.

### C6 · Core process and transports
Labels: core
Depends on: C3, C4, S7
**Acceptance criteria**
- [ ] `fulcrum-core` with JSON-RPC over a `0600` Unix socket, Keychain-backed client secret, idle shutdown, single-instance lock.
- [ ] `CoreTransport` for the UI with a dev-only WebSocket bridge for browser development (excluded from release builds).
- [ ] `AppliedChange` subscriptions delivered to clients.

### C7 · Local SQLite index and search
Labels: core
Depends on: C5
**Acceptance criteria**
- [ ] Machine-local `index.sqlite` with FTS5 over initiatives, nodes, entities, source titles/excerpts; full rebuild from folded state; incremental apply.
- [ ] Deleting the index and reopening rebuilds it with progress reporting.

### U1 · App shell and navigation
Labels: ui
Depends on: C6
**Acceptance criteria**
- [ ] Tauri app with sidebar: Initiatives, Priorities, Questions (quiet count), Settings; no Inbox, People or chat.
- [ ] Design tokens per [DESIGN_RULES.md](../docs/DESIGN_RULES.md): neutral surfaces, single muted blue accent, semantic red/amber/green used only for state; system font stack; keyboard focus styles.
- [ ] Runs in a browser against the dev core.

### U2 · Portfolio board
Labels: ui
Depends on: U1, C5
**Acceptance criteria**
- [ ] Spacious cards grouped by Category / MoSCoW / Team / Objective / None; sort by manual rank / MoSCoW / last changed / date; drag to manual-rank.
- [ ] Card shows only: title, optional description/category, compact MoSCoW, exactly one state line, optional date, quiet freshness and question indicators.
- [ ] Collapsible right rail. Proposed initiatives appear only via Questions, never as board cards.
- [ ] Renders `fixtures/states/portfolio.state.json`; snapshot tests for each card state.

### U3 · Initiative flow canvas
Labels: ui
Depends on: U2
**Acceptance criteria**
- [ ] React Flow + ELK.js layered auto-layout; pan/zoom/fit; drag nodes; inline rename; add node; drag-connect with edge-type picker; delete; ⌘Z undo.
- [ ] Node glyphs: Task square, Dependency hourglass/link, Decision diamond, Milestone flag; inferred = dashed; conditional route labels.
- [ ] The initiative is the canvas title, not a node. Visual groups render as light frames.
- [ ] Every edit is a domain command; invariant violations show inline with the code's human message.

### U4 · Inspector, focused view and breadcrumbs
Labels: ui
Depends on: U3
**Acceptance criteria**
- [ ] Single-click opens the inspector (attributes, state, evidence count, questions); collapsible; graph stays visible.
- [ ] Double-click a Task opens the focused view (filtered same graph) with breadcrumbs back; edits reflect everywhere immediately.
- [ ] Simple Tasks with child Tasks can be shown as a checklist in the inspector.

### U4a · In-app command bar
Labels: ui
Depends on: U4
Owner priority before U5; issue #57; ADR-0017.
**Acceptance criteria**
- [ ] Inline natural-language entry and contextual structured review; keyboard-first.
- [ ] Local model drafts only; no writes until explicit approval through Domain.
- [ ] Atomic apply with exact-request evidence, field protection and one undo.
- [ ] Stale/ambiguous/invalid/cancelled/unavailable drafts retain input without writes.
- [ ] Manual editing remains secondary; external MCP remains available independently.

### U5 · List and History views
Labels: ui
Depends on: U4
**Acceptance criteria**
- [ ] List view of the same nodes with hierarchy (contains), state, type, date, dependencies, source count, inline editing.
- [ ] History view: events with actor, command, before/after, evidence links; undo per event and per AI run.

## M2 — Context and ingestion

### I1 · SourceAdapter, synthetic adapter, queue and scheduler
Labels: ingestion
Depends on: C3
**Acceptance criteria**
- [ ] `SourceAdapter` interface; synthetic adapter generating days of fixture-based items.
- [ ] Machine-local durable queue; scope opt-in; dedupe; deterministic relevance filter; ingestion-device enforcement (P11).
- [ ] Scenario 1 integration test (7 days of items, newest-first catch-up, freshness label correct throughout).

### I2 · First real connector
Labels: ingestion
Depends on: I1, S4
**Acceptance criteria**
- [ ] One of Slack/Gmail per S4's recommendation: OAuth via system browser, tokens in Keychain, per-scope opt-in, bounded backfill, cursors, permalinks.
- [ ] Recorded-response tests (synthetic content); no real data in the repo.

### I3 · Extraction through ModelRuntime
Labels: ai, ingestion
Depends on: I1, S2
**Acceptance criteria**
- [ ] Ollama driver for `ModelRuntime`; candidate JSON Schema; repair-once-then-drop; spans required.
- [ ] Eval set from S2 runs in CI against a mocked runtime and locally against Ollama; regression thresholds documented.

### I4 · Native ContextIndex
Labels: ai, ingestion
Depends on: C7
**Acceptance criteria**
- [ ] Entities, aliases, externalIds, FTS; `resolveEntities` and `related` per interface; rebuildable.
- [ ] Scenario 6 fixtures: aliases resolve, or exactly one identity question is raised.

### I5 · Reconciler under the autonomy policy
Labels: ai, core
Depends on: I3, I4, C2
**Acceptance criteria**
- [ ] Pure `(candidates, resolutions, state, rejections) → {commands, questions, suggestions}`.
- [ ] Scenarios 2, 3, 4, 5, 8 pass as tests; update-before-create; batch `runId`; obsolete-question re-evaluation.
- [ ] Injection items from the S2 eval set produce no state change beyond allowed candidate kinds.

### U6 · Context view and evidence inspector
Labels: ui
Depends on: U4, I1
**Acceptance criteria**
- [ ] Initiative Context aggregates evidence from initiative, nodes and edges; per-object evidence in the inspector.
- [ ] Shows title/sender/happenedAt/ingestedAt, excerpt (if cached), explicit vs inferred, assertions supported, open original.

### U7 · Timeline view
Labels: ui
Depends on: U4
**Acceptance criteria**
- [ ] Shown only when the initiative has dated items; milestones, target dates, dependencies; optional event-history lane.
- [ ] Decide simple SVG vs vis-timeline in the PR description with reasons.

## M3 — Autonomy and questions

### A1 · Questions engine
Labels: core
Depends on: I5
**Acceptance criteria**
- [ ] Materiality gate, dedupe by key (deterministic UUIDv5 ids), consolidation of similar questions, defer, auto-obsolete on newer evidence, sync-conflict questions from the fold.
- [ ] No question without 2–3 executable resolutions; no notifications or popups.

### U8 · Questions Center
Labels: ui
Depends on: A1
**Acceptance criteria**
- [ ] Global quiet list grouped by initiative; per-initiative and per-node/edge display; evidence links; one-click resolutions; defer.

### A2 · Priorities and KPIs
Labels: core, ui
Depends on: C5
**Acceptance criteria**
- [ ] Ordered objectives with ties and optional 1–5 weight; optional KPI fields.
- [ ] Initiative alignment links (editable; AI-set ones show evidence); MoSCoW untouched by objective changes.

## M4 — Productization

### P1 · MCP server
Labels: mcp
Depends on: C6, S6
**Acceptance criteria**
- [ ] Tools per [MCP.md](../docs/MCP.md) over the core socket; scopes, read-only default, excerpt gating, access log.
- [ ] Contract test: MCP write and UI command produce identical ops (scenario 11).

### P2 · First-run wizard and local AI install
Labels: ui, packaging
Depends on: U2, I3
**Acceptance criteria**
- [ ] Steps in [ONBOARDING.md](../docs/ONBOARDING.md): workspace folder (incl. Drive offline check), device naming/ingestion role, hardware detection, Ollama guidance, license acceptance, model download with progress, self-test, sources, first initiative.
- [ ] Every step has retry and a safe skip; no Terminal required.

### P3 · Background operation, sleep/wake and resource policy
Labels: core, packaging
Depends on: I1
**Acceptance criteria**
- [ ] Wake/sleep, power and thermal signals from the Rust shell; policy table in [OPERATIONS.md](../docs/OPERATIONS.md#resource-policy) implemented and configurable.
- [ ] Freshness label never claims up to date while work is pending (scenario 10); Intel manual test (scenario 12).

### P4 · Settings, backup/restore and ingestion hand-over
Labels: ui, store
Depends on: C4, P3
**Acceptance criteria**
- [ ] Settings sections: Workspace, Sources & Integrations, Local AI, Privacy & Data, Background, MCP, Backup & Recovery, About/Diagnostics.
- [ ] Daily/weekly backups; restore into a new workspace; point-in-time view.
- [ ] Ingestion-device move flow and stale-device notice (ADR-0006).

### P5 · Signing, notarization, updates and notices
Labels: packaging
Depends on: S7
**Acceptance criteria**
- [ ] Universal signed and notarized DMG from CI (secrets in GitHub Actions only); Tauri updater with signed manifests.
- [ ] Third-party license notices generated into the bundle; license audit against [LICENSING.md](../docs/LICENSING.md).

### P6 · Workspace encryption
Labels: security, store
Depends on: C4
**Acceptance criteria**
- [ ] Design doc + ADR: key generation, Keychain storage, second-Mac key transfer, recovery.
- [ ] Encrypted event payloads with authenticated encryption; plaintext → encrypted migration with backup.
