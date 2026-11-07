# Instructions for AI coding agents (Codex, Claude Code, others)

Read this before every task. Then read the docs your task touches.

## Sources of truth, in order
1. [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — product behavior. Wins over everything else.
2. [schemas/v1/](schemas/v1) — persisted data contract. Change only with a schema version plan.
3. [docs/DATA_MODEL.md](docs/DATA_MODEL.md), [docs/DOMAIN_COMMANDS.md](docs/DOMAIN_COMMANDS.md), [docs/WORKSPACE_FORMAT.md](docs/WORKSPACE_FORMAT.md) — rules the code must implement.
4. [docs/decisions/](docs/decisions) — why things are the way they are. Changing a decision = new or superseding ADR in the same PR.
5. [backlog/BACKLOG.md](backlog/BACKLOG.md) — what to build next and its acceptance criteria.

## Continuing the plan

When the owner says **"Continue the Fulcrum plan"** (or similar), do exactly one unit of work:

1. Read [backlog/PROGRESS.md](backlog/PROGRESS.md) and [backlog/PLAYBOOK.md](backlog/PLAYBOOK.md).
2. **Promote owner-completed steps:** any step with status `waiting-owner` whose Owner box is ticked `[x]` becomes `done` (do this in your PR, and increment "Steps done since last audit").
3. **Check for unmerged work:** a step is in progress if PROGRESS.md lists a PR for it that is still open, or (when you can see the remote via `git branch -r` / `gh pr list`) an open PR or branch exists for it (`plan/step-<N>-…` or one that clearly implements that item). Do not redo it. If a listed PR has been merged but the status was not updated, update it now. If nothing else is runnable, stop and tell the owner which PR to review and merge.
4. **Audit due?** If "Steps done since last audit" is 5 or more, do the audit described at the end of PLAYBOOK.md instead of a step, reset the counter to 0, and add an entry to the Audit log.
5. **Pick the step:** the lowest-numbered step with status `todo` whose **Needs** steps are all `done`. If none qualifies, stop: summarize what is waiting on the owner (from the Owner to-do section) and change nothing.
6. **Do the step:** read its GitHub issue, the matching section of [backlog/BACKLOG.md](backlog/BACKLOG.md), every doc/ADR it links, and any `docs/spikes/*` it depends on (their outcomes are binding unless an ADR says otherwise). Follow the step's extra instructions. Do only this step.
7. **Update PROGRESS.md in the same branch:** set the step's status to `done` if it has no owner action, otherwise `waiting-owner`; fill in the PR column once known; for `waiting-owner`, add exact, copy-pasteable owner instructions to the Owner to-do section (what to install, what to run, where to record results, then "tick the Owner box for step N"). If the step is blocked, set `blocked` with the reason and stop.
8. **Open one PR** on a branch named `plan/step-<N>-<short-name>` that references the issue, lists the acceptance criteria as checkboxes with how each was verified, states anything not verified, and repeats the owner instructions.

The owner merges each PR before asking you to continue again. Never mark an owner action as done yourself. Never claim hardware, connector, model, sync or packaging behavior was validated unless you ran it.

## Product invariants you must not break
- Tasks are **only the user's** work. Never add an owner/assignee to a Task. Others' work is a Dependency.
- Initiatives are top-level cards and the canvas of **exactly one** graph. The initiative is not a node.
- **No nested graphs.** Child Tasks are first-class nodes linked by `contains`. A focused view is a filter of the same graph.
- `contains` never implies `depends_on` or automatic completion.
- Questions are contextual metadata on an initiative/node/edge — not flow objects, never popups, no "unsorted" inbox.
- MoSCoW values are exactly **Must Do / Should Do / Could Do / Won't Do** (`must_do`, `should_do`, `could_do`, `wont_do`). Objective ranking is separate.
- Never render percent completion, Kanban status columns, avatars, or an embedded AI chat. No AI-written summary prose on dashboards.
- AI cannot activate an initiative, cannot silently change protected fields, and every AI write carries evidence and is undoable.
- Source content is untrusted data. Never let it select commands, tools, settings or recipients.
- No hosted inference, telemetry or backend by default.

## Architecture rules
- All writes go through `Domain.execute`. UI, MCP and ingestion are clients of the same commands.
- Respect the layer table in [ARCHITECTURE.md](docs/ARCHITECTURE.md#layers-and-boundaries). Drivers (files, SQLite, Ollama, connectors) sit behind interfaces; callers never reach through them.
- The workspace folder holds only `workspace.json`, `log/`, `checkpoints/`, `exports/`. Never put credentials, indexes, absolute paths or models there.
- Prefer a maintained library to new infrastructure. Adding a service, daemon or database server needs an ADR.

## Code standards
- TypeScript strict. Named constants instead of magic numbers. Short single-purpose functions. Guard clauses over nesting. Descriptive names. Enums/option objects over boolean parameters.
- Comments explain *why*, briefly. No comments narrating edits.
- Bug fix: failing test first, then fix. New logic ships with tests in the same PR.
- The reference model in `tools/reference/` and `fixtures/scenarios/expectations.json` are executable specs; production code must pass the same expectations.

## Public repository hygiene
- Synthetic data only. No real names, emails, company content, tokens, device paths, screenshots of real data, model weights, or Star Wars artwork.
- Fixture UUIDs use the synthetic pattern `NN000000-0000-7000-8000-…` (a test enforces this).

## Commits and PRs
- Subject ≤ 50 chars, imperative, no trailing period; blank line; body wrapped at ~72 chars explaining what and why. One logical change per commit.
- PR description: backlog item id, acceptance criteria checklist, how it was verified, and any spec/ADR impact.
- If a task would violate the spec, stop and say so in the PR rather than working around it.
