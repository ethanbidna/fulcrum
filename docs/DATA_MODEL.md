# Data model

The canonical contract is the JSON Schema in [`schemas/v1/`](../schemas/v1). This page explains it. If the two disagree, the schema is wrong or this page is wrong — fix one and add a test; do not let them drift.

## Records

| Record | Schema | Purpose |
|---|---|---|
| Initiative | `initiative.schema.json` | Top-level portfolio card and the canvas for exactly one graph. Not a node. |
| Node (flow object) | `flow-object.schema.json` | `task` · `dependency` · `decision` · `milestone`. Belongs to one initiative. |
| Edge | `flow-edge.schema.json` | `contains` · `depends_on` · `leads_to` · `related_to`. |
| Group | `records.schema.json#/$defs/group` | Visual grouping on the canvas. Presentation only. |
| Category | `records…/category` | User-defined portfolio grouping. |
| Objective | `records…/objective` | Ranked strategic objective, optional KPI. Independent of MoSCoW. |
| Entity | `records…/entity` | Person, team, org, system; aliases and connector IDs. |
| Source | `records…/source` | Pointer to an external item; optional excerpt; content hash. |
| Assertion | `records…/assertion` | Evidence-backed temporal claim about an initiative/node/edge field. |
| Question | `records…/question` | Contextual clarification with 2–3 executable resolutions. |
| Rejection | `records…/rejection` | Remembered "no" so AI does not re-suggest the same thing. |
| Change event | `change-event.schema.json` | Immutable log entry; the authority. |
| Workspace state | `workspace-state.schema.json` | Checkpoint body / fixture shape. |

All IDs are UUIDs (v7 recommended). IDs for records that two Macs might derive independently (for example a sync-conflict Question) are **UUIDv5 of their `dedupeKey`** in a fixed Fulcrum namespace, so both devices create the same record and the merge dedupes it.

## The five primitives

| Primitive | Who acts | States | Notes |
|---|---|---|---|
| Initiative | — | lifecycle: `proposed` → `active` ↔ `paused` → `completed`/`archived`; `rejected` | `proposed` only from AI; becomes `active` only via `initiative.approve` by the user. |
| Task | **the user only** | `open` · `done` · `cancelled` | Schema forbids `responsibleEntityId`/`assignee`/`owner` on Tasks. |
| Dependency | anyone/anything else | `waiting` · `satisfied` · `blocked` · `expired` · `unverified` · `cancelled` | `kind`: person, approval, access, delivery, event, technical, other. Optional `responsibleEntityId`. |
| Decision | `decider`: `user` or an entity | `open` · `decided` · `cancelled` | ≥2 `options`; `outcome` is an option id. Non-user decider ⇒ treated like a Dependency for actionability. |
| Milestone | — | `pending` · `achieved` · `missed` · `cancelled` | A checkpoint, never a percentage. |

"Blocked" is a **derived** condition (an unmet prerequisite path) or an explicit Dependency state — not a sixth primitive. Any node may have `supersededBy`, which removes it from actionability while keeping history.

## Edges

Edges read as sentences: **`from` `type` `to`**.

| Type | Meaning | Constraints |
|---|---|---|
| `A depends_on B` | B is an execution prerequisite of A | No cycles. May cross initiatives (shared Dependency). Optional `prerequisiteGroupId`. |
| `A contains B` | B is organizationally inside Task A | Both Tasks; one parent per child; no cycles; same initiative. **Never implies dependency or auto-completion.** |
| `A leads_to B` | Sequence or conditional route | Same initiative. `condition.optionId` only when A is a Decision. Loops allowed (revisiting). |
| `A related_to B` | Informational link | May cross initiatives. No execution semantics. |

The renderer draws `depends_on` arrows prerequisite → dependent so the canvas reads in flow direction. Storage keeps the sentence direction.

### AND / OR prerequisites

A node's incoming `depends_on` edges without a group are ANDed. A node may declare `prerequisiteGroups: [{id, mode: "all"|"any"}]`; edges with that `prerequisiteGroupId` are combined by the group's mode; groups are ANDed with each other and with ungrouped edges. No gateway nodes.

### Conditional routes and joins

Incoming `leads_to` edges form an implicit **any**-join: a node is *reached* once one incoming route's source is satisfied and, for conditional routes, the Decision's `outcome` matches. A node is *skipped* when every incoming route is a conditional route the Decision did not take. Use `depends_on` (optionally grouped) for an explicit AND-join.

### Cross-initiative dependencies

A shared external Dependency lives in one initiative. Other initiatives link to it with a cross-initiative `depends_on` edge whose home `initiativeId` is the dependent node's initiative; the canvas shows it as a reference node with a link to its home. This avoids cloning Dependencies and keeps one canonical record.

## Invariants

Enforced by the domain on every command; codes are stable API (MCP and UI show them). Reference implementation: [`tools/reference/invariants.mjs`](../tools/reference/invariants.mjs).

| Code | Rule |
|---|---|
| `DUPLICATE_ID` | IDs are unique across all records. |
| `NODE_INITIATIVE_MISSING` | Every node belongs to an existing initiative. |
| `EDGE_ENDPOINT_MISSING`, `EDGE_SELF_LOOP` | Edges connect two existing, different nodes. |
| `EDGE_HOME_INITIATIVE_MISMATCH` | `edge.initiativeId` = initiative of `fromId`. |
| `EDGE_CROSS_INITIATIVE_FORBIDDEN` | Only `depends_on`/`related_to` may cross initiatives. **This is the one-graph-per-initiative rule.** |
| `CONTAINS_REQUIRES_TASKS`, `CONTAINS_MULTIPLE_PARENTS`, `CONTAINS_CYCLE` | `contains` is a forest of Tasks. This is the **no-nested-graphs** rule: a focused view is a subtree filter, never a separate graph. |
| `DEPENDS_ON_CYCLE` | Prerequisites are acyclic. |
| `CONDITION_REQUIRES_DECISION_LEADS_TO`, `CONDITION_UNKNOWN_OPTION` | Conditions only on Decision `leads_to` edges and only for real options. |
| `PREREQUISITE_GROUP_REQUIRES_DEPENDS_ON`, `PREREQUISITE_GROUP_UNKNOWN` | Group refs are valid. |
| `DECISION_OUTCOME_UNKNOWN`, `DECISION_OUTCOME_MISSING` | A decided Decision has a valid outcome. |
| `GROUP_OUTSIDE_INITIATIVE` | Visual groups do not span initiatives. |
| `QUESTION_TARGET_INVALID`, `ASSERTION_TARGET_INVALID` | Targets exist and (for questions) belong to the question's initiative. |
| `EVIDENCE_SOURCE_MISSING` | Every evidence ref points to a known source. |
| Schema-level | Task has no external owner; MoSCoW ∈ {Must Do, Should Do, Could Do, Won't Do}; no percent-complete field anywhere; questions have 2–3 resolutions. |

Policy rules (actor-dependent, e.g. "AI cannot activate an initiative") are listed in [DOMAIN_COMMANDS.md](DOMAIN_COMMANDS.md#autonomy-policy).

## Evidence and provenance

```
Source  ──(evidenceRef, optional excerpt range)──▶  Assertion  ──(reconciled into)──▶  field on Initiative / Node / Edge
                                                       │
                                                       └── status: pending · applied · suggested · rejected · superseded · conflicting
```

- Evidence attaches at three levels: initiative, node, **edge**. Initiative Context aggregates all three.
- Two clocks: `source.happenedAt` (when it happened) and `source.ingestedAt` / `assertion.observedAt` (when Fulcrum learned it). `validFrom`/`validTo` bound a claim in time.
- `certainty: explicit | inferred`. Inferred nodes/edges render as dashed or with a small provenance mark — not confidence badges.
- A field written by the AI always carries `evidenceRefs` on its event. A field written by the user needs none and wins.

## Protected fields and manual precedence

- `initiative.protectedFields` defaults to `["moscow"]`. Any manual user edit to a field adds that field to the record's `protectedFields`.
- AI writes to a protected field are never applied. The assertion becomes `suggested`; if material, one Question is raised (`reason: protected_field_challenge`).
- The user can unprotect a field (`field.unprotect`) — the only way to let AI maintain it again.

## Derived state

Never stored; always recomputed from records.

Reference implementation: [`tools/reference/card-state.mjs`](../tools/reference/card-state.mjs).

- **Satisfied**: Task `done|cancelled`; Dependency `satisfied|cancelled`; Decision `decided|cancelled`; Milestone `achieved|missed|cancelled`; or superseded.
- **Actionable (user)**: an `open` Task, or an `open` Decision with `decider: user`, whose prerequisites are met, which is reached, and which has no open `contains` children (the children are the actionable work).
- **Card state** (exactly one, in this order):
  1. *My next action* — first actionable node by `manualRank`, then `targetDate`, then creation.
  2. *Blocked by X* — a `blocked`/`expired` Dependency gating unfinished live work.
  3. *Waiting for X* — a `waiting`/`unverified` Dependency gating unfinished live work.
  4. *Next step unclear*.
- **Freshness**: from machine-local ingestion status (last successful pull per source, pending queue length). Never "up to date" while work is queued.
- **Rail**: Next available actions (all actionable nodes across active initiatives), Waiting on (gating Dependencies), Meaningful changes (recent events excluding cosmetic ones), Questions count.

No projection computes or displays a completion percentage.

## Focused view

Double-clicking a Task opens a focused view: the Task, its `contains` descendants, and the `depends_on`/`leads_to` edges among them plus their immediate external prerequisites (shown as reference nodes). It is a **filter over the same canonical records**; edits there are ordinary commands. Breadcrumbs return to the full initiative canvas.

## Versioning

- `workspace.json#schemaVersion` = workspace format version. Each event has `v`; each checkpoint has `v`.
- Schemas live in `schemas/v<N>/`. A breaking change creates `v<N+1>` plus an **upcaster** from N to N+1 for events and checkpoints. Old events are never rewritten.
- Details and the read-only fallback for older apps: [WORKSPACE_FORMAT.md#migrations](WORKSPACE_FORMAT.md#migrations).
