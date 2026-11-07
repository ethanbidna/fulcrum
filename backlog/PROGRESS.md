# Progress

Agents update this file in every PR; the owner ticks the **Owner** boxes. Step definitions are in [PLAYBOOK.md](PLAYBOOK.md); the procedure is in [AGENTS.md](../AGENTS.md#continuing-the-plan).

Statuses: `todo` · `waiting-owner` (agent work merged; owner action pending) · `done` · `blocked` (reason in Notes).

Steps done since last audit: 1

## Steps

| Step | Item | Status | Owner | PR | Notes |
|---|---|---|---|---|---|
| 1 | S1 workspace sync harness | waiting-owner | [ ] | #36 | Harness merged; real two-Mac test pending |
| 2 | C1 monorepo scaffold | done | n/a | #37 | Workspace, generated types, layer lint, and CI checks |
| 3 | S2 Llama benchmark | waiting-owner | [ ] | #38 | 48 synthetic cases, runner and scoring tests; Intel/Apple Silicon results pending |
| 4 | S7 Tauri + core sidecar packaging | todo | [ ] | | |
| 5 | S6 MCP shim | todo | [ ] | | |
| 6 | S4 connector capability matrix | waiting-owner | [ ] | #39 | Matrix and read-only probes; fake-account OAuth and footprint checks pending |
| 7 | S5 Granola access | todo | n/a | | |
| 8 | S3 Graphiti | todo | [ ] | | |
| 9 | Decision checkpoint | todo | n/a | | Merging the PR is the approval |
| 10 | C2 invariants and policy | todo | n/a | | |
| 11 | C3 commands, events, undo | todo | n/a | | |
| 12 | C4 store driver | todo | n/a | | |
| 13 | C5 projections | todo | n/a | | |
| 14 | C6 core process and transports | todo | n/a | | |
| 15 | C7 SQLite index and search | todo | n/a | | |
| 16 | U1 app shell | todo | [ ] | | |
| 17 | U2 portfolio board | todo | [ ] | | |
| 18 | U3 flow canvas | todo | [ ] | | |
| 19 | U4 inspector and focused view | todo | [ ] | | |
| 20 | U5 list and history | todo | [ ] | | Owner: use the app for a week |
| 21 | I1 adapters, queue, scheduler | todo | n/a | | |
| 22 | I3 extraction | todo | n/a | | |
| 23 | I4 native ContextIndex | todo | n/a | | |
| 24 | I5 reconciler | todo | n/a | | |
| 25 | I2 first real connector | todo | [ ] | | |
| 26 | U6 context view | todo | n/a | | |
| 27 | U7 timeline | todo | n/a | | |
| 28 | A1 questions engine | todo | n/a | | |
| 29 | U8 Questions Center | todo | [ ] | | |
| 30 | A2 priorities and KPIs | todo | n/a | | |
| 31 | P3 background, sleep/wake, resources | todo | [ ] | | |
| 32 | P4 settings, backup, hand-over | todo | n/a | | |
| 33 | P1 MCP server | todo | [ ] | | |
| 34 | P2 first-run wizard | todo | [ ] | | |
| 35 | P6 encryption — design | todo | n/a | | Merging the PR is the approval |
| 36 | P6 encryption — implement | todo | n/a | | |
| 37 | P5 signing, notarization, updates | todo | [ ] | | |

## Owner to-do

Agents list the exact instructions for each `waiting-owner` step here, newest first. When finished, tick the step's **Owner** box above (edit this file on GitHub) and delete its entry below.

### Step 6 — S4 connector tests

Wait for the S2 benchmark to finish before live API/runtime measurements. Use only new throwaway accounts containing fake content; do not use connected real accounts.

1. Install Node 22 LTS and follow [spikes/s4/README.md](../spikes/s4/README.md) in full. Run `npm ci` and `npm test` (after C1 merges, use `corepack enable` and `pnpm install --frozen-lockfile` instead of `npm ci`).
2. Create the fake Slack workspace/channel/thread. Register the internal app with the documented read-only user scopes and enter its token/channel ID through the procedure's hidden/environment prompts. Run `node spikes/s4/cli.mjs slack backfill`, then `node spikes/s4/cli.mjs slack resume` while incomplete. Test the selected private/DM scopes and exact permalink manually.
3. Create the fake Google account/label and own OAuth test project, enable Gmail API and only `gmail.readonly`, then follow the manual token/refresh setup. Run `node spikes/s4/cli.mjs gmail backfill`, `node spikes/s4/cli.mjs gmail resume` while incomplete, and `node spikes/s4/cli.mjs gmail incremental` after adding fake mail. Record refresh, quota, history expiry and open-original limitations.
4. Follow the optional Activepieces library/runtime comparison instructions after S2. Record real versions, permissions, setup friction, RAM/disk and any not-run reasons across all six source × option rows in `docs/spikes/S4.md`.
5. Review count-only reports under `spikes/s4/out/`; commit reviewed copies under `docs/spikes/S4-results/` with observations in a PR referencing #4. Never commit continuation files, tokens, IDs, links, addresses, paths or raw provider responses.
6. Tick the Owner box for step 6 above.

### Step 3 — S2 local Llama benchmark

1. Install Node 22 LTS and the official Ollama app on the 2019 Intel MacBook Pro; repeat on Apple Silicon if available. Check out this PR's branch (or `main` after merge). Run `npm ci` and `npm test`. If the C1 scaffold has merged, use `corepack enable` and `pnpm install --frozen-lockfile` instead of `npm ci`.
2. Follow [docs/spikes/S2.md](../docs/spikes/S2.md) in full: accept the Llama licenses, pull the three Q4 models, launch Ollama with background QoS, compile/run the thermal probe, then run:

   ```sh
   /usr/sbin/taskpolicy -b /usr/bin/nice -n 10 node spikes/s2/benchmark.mjs --output spikes/s2/out/intel.json
   ```

3. Repeat unplugged as `intel-battery.json`; run each model's interrupted pause trial and record actual CPU-idle timing. Follow the procedure's responsiveness check. On Apple Silicon, use the corresponding `apple-silicon` filenames. Record missing/failed checks honestly.
4. Review and commit the synthetic JSON reports, thermal logs and `observations.md` under `docs/spikes/S2-results/` as described in the procedure. Leave recommendations pending until measured results are reviewed at the decision checkpoint; never infer a hardware pass from the mock tests.
5. Tick the Owner box for step 3 above.

### Step 1 — S1 two-Mac sync test
You need two Macs (or a Mac plus a macOS VM), each signed in to the same Dropbox account, and later the same Google account in Google Drive for desktop. Use only the synthetic labels the procedure gives; no real work content.

1. On both Macs: clone the repo, install Node 22.13+ (22 LTS), then run `corepack enable` and `pnpm install --frozen-lockfile` and `npm test` from the repo root.
2. Follow [docs/spikes/S1-procedure.md](../docs/spikes/S1-procedure.md) top to bottom for each provider row: local folder, Dropbox, Google Drive (mirror mode), Google Drive (stream mode).
3. Fill in the results table at the end of that procedure (or attach sanitized results to issue #1). Check for personal paths or account names before committing.
4. Tick the Owner box for step 1 above.

Codex can keep working on steps that don't depend on this (2–7) in the meantime.

## Audit log

_No audits yet._
