# Domain commands, autonomy policy and undo

Every mutation — from the UI, the MCP server, the reconciler or a connector — is a **command** executed by `packages/domain`. There is no other write path. MCP tools are thin wrappers over these commands ([MCP.md](MCP.md)).

## Envelope

```ts
type Actor = 'user' | 'ai' | 'connector' | 'mcp' | 'system';

interface CommandEnvelope<N extends CommandName = CommandName> {
  name: N;
  args: CommandArgs[N];
  actor: Actor;
  idempotencyKey?: string;       // repeated key ⇒ returns the original result, writes nothing
  evidenceRefs?: EvidenceRef[];  // required for actor 'ai' on any state write
  runId?: string;                // groups one reconciliation run for batch undo
  reason?: string;               // short, shown in History (no AI prose essays)
}

type CommandResult =
  | { ok: true; eventId: string; ops: Op[]; raisedQuestionIds: string[]; suggestedAssertionIds: string[] }
  | { ok: false; error: DomainError };

interface DomainError {
  code:
    | 'VALIDATION_FAILED'        // JSON Schema failure; details = Ajv errors
    | 'INVARIANT_VIOLATION'      // details.invariant = code from DATA_MODEL.md#invariants
    | 'POLICY_DENIED'            // details.rule = rule id below
    | 'PROTECTED_FIELD'          // AI/MCP-without-confirmation write to a protected field
    | 'NOT_FOUND'
    | 'STALE_BASE'               // optimistic check failed (UI edited an outdated value)
    | 'WORKSPACE_READ_ONLY';     // newer schema, online-only files, or not this device's role
  message: string;
  details?: unknown;
}
```

Execution order: schema-validate args → load affected records → policy check (actor) → compute ops → validate resulting records (schema) → check invariants on the affected subgraph → append event → update projections → notify subscribers.

## Command catalog (v1)

| Area | Commands |
|---|---|
| Initiative | `initiative.create` (user/mcp only, lifecycle `active`) · `initiative.propose` (ai: lifecycle `proposed`) · `initiative.approve` · `initiative.reject` · `initiative.update` (title, description, targetDate, teamEntityId) · `initiative.setMoscow` · `initiative.setLifecycle` · `initiative.setCategories` · `initiative.rank` (manual order) |
| Category | `category.create` · `category.rename` · `category.rank` · `category.delete` |
| Node | `node.create` · `node.update` (title, details, targetDate, kind, responsibleEntityId, decider, options) · `node.setState` · `node.setGroup` · `node.setPrerequisiteGroups` · `node.supersede` · `node.delete` (tombstone) · `decision.decide` (sets `outcome` + `state: decided`) |
| Edge | `edge.create` · `edge.update` (label, condition, prerequisiteGroupId) · `edge.delete` |
| Group | `group.create` · `group.rename` · `group.delete` (members keep existing; `groupId` cleared) |
| Evidence | `source.record` (connector) · `assertion.record` · `assertion.reject` · `evidence.attach` · `evidence.detach` |
| Entity | `entity.create` · `entity.update` · `entity.addAlias` · `entity.merge` · `entity.split` |
| Objectives | `objective.create` · `objective.update` · `objective.rerank` (ties = equal rank) · `objective.delete` · `alignment.set` |
| Questions | `question.raise` · `question.resolve` (runs the chosen resolution's commands in the same event) · `question.defer` · `question.markObsolete` |
| Protection | `field.protect` · `field.unprotect` |
| Suggestions | `suggestion.reject` (stores a Rejection signature) |
| Undo | `change.undo` (one event) · `run.undo` (all events in a `runId`) |
| Workspace | `device.register` · `settings.setIngestionDevice` · `settings.setDefaultCachePolicy` |

## Autonomy policy

Implements PRODUCT_SPEC "Autonomy policy (approved)". Rule ids are stable; `POLICY_DENIED` returns them.

| Rule id | Rule |
|---|---|
| `P1_NO_AI_ACTIVATION` | `actor: ai` may only `initiative.propose`. `initiative.create`/`approve`/`setLifecycle(active)` require `user` or `mcp`. |
| `P2_AI_TASK_ONLY_FOR_EXPLICIT_COMMITMENT` | `ai` may `node.create(type: task)` only with an evidence-backed assertion `predicate: user_commitment`, `certainty: explicit`, whose speaker is the user. Otherwise it must create a Question or nothing. |
| `P3_EXTERNAL_WORK_IS_DEPENDENCY` | Work attributed to anyone other than the user is a Dependency (enforced by schema: Tasks cannot carry an owner). `ai` creates Dependencies automatically only for unambiguous commitments. |
| `P4_PROTECTED_FIELDS` | `ai` writes to a field in `protectedFields` are never applied → assertion `suggested`; one Question if material. `mcp` writes to protected fields apply (the user asked through their MCP client) but are tagged and appear in Meaningful changes. |
| `P5_EVIDENCE_REQUIRED` | Every `ai` state write carries `evidenceRefs` or is stored as a suggestion, not applied. |
| `P6_MANUAL_PRECEDENCE` | A `user` edit to a field adds it to `protectedFields`. `ai` cannot revert a manual correction. |
| `P7_NO_REINTRODUCTION` | `ai` commands whose suggestion signature matches a Rejection are dropped unless new evidence (newer `happenedAt`) exists and the rejection was `untilNewEvidence`. |
| `P8_PREFER_UPDATE` | The reconciler must attempt entity/node matching before `create`; `ai` creates with no candidate-match record are rejected. |
| `P9_MATERIAL_QUESTIONS_ONLY` | `question.raise` requires `materiality` medium/high and a `dedupeKey`; an open question with the same key is updated, not duplicated. |
| `P10_CONNECTOR_SCOPE` | `actor: connector` may only `source.record`. |
| `P11_INGESTION_DEVICE` | `ai`/`connector` commands are accepted only on the designated ingestion device ([ADR-0006](decisions/0006-single-ingestion-device.md)). |
| `P12_MCP_SCOPE` | `mcp` commands are limited by MCP settings: read-only mode, initiative/category allow-list ([ADR-0007](decisions/0007-local-mcp-security.md)). |

Source text is **never** interpreted as an instruction. The extractor emits typed candidates; the reconciler maps candidates to commands from a fixed set. Nothing in a message can name a command, a tool or a setting.

## Undo model

- Undo is a **new event** with `undoOf` whose ops restore each field's previous value (`create` ⇒ `tombstone`; `tombstone` ⇒ re-`create` with the last state). History stays append-only.
- `run.undo` reverts every event in an AI reconciliation run in reverse order — "undo what the AI did this morning".
- If a later event changed the same field, undo for that field is a conflict: the UI shows both values and asks; it never silently overwrites newer work.
- Undoing an AI change also records a Rejection (P7), so the same suggestion does not come back.
- UI keyboard undo (⌘Z) maps to `change.undo` of the last `user` event from this device in this session.

## Queries (read side)

Queries never mutate. Served from the in-memory folded state and the SQLite index.

`portfolio.list({groupBy, sortBy, filter})` · `portfolio.rail()` · `initiative.get(id)` · `graph.get(initiativeId)` · `graph.focus(nodeId)` · `node.get(id)` · `context.forTarget(target)` · `evidence.get(sourceId)` · `questions.list({initiativeId?, state?})` · `objectives.list()` · `history.list({target?, actor?, since?})` · `search(text, scope)` · `status.freshness()`

## Events emitted for projections

`AppliedChange { eventId, actor, ops, raisedQuestionIds }` is published to subscribers (UI, MCP resource-change notifications, index). The UI re-reads affected projections; it does not patch local state optimistically beyond the in-flight command.
