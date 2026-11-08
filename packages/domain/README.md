# Domain core (C2)

Pure TypeScript rules over schema-validated workspace records. No filesystem,
network, model runtime or event append is performed here.

- `checkInvariants(state)` validates a whole snapshot with the stable codes from
  `docs/DATA_MODEL.md`.
- `checkAffectedInvariants(before, after, changedIds)` validates the connected
  affected graph, following references in both snapshots so deletions retain
  dependants. ID collisions are checked against the whole workspace. A shared
  prerequisite or evidence source can widen validation across initiatives.
- `checkPolicy(intent, context)` evaluates P1–P12. Command handlers must derive
  intents from validated command arguments and authenticated actor/device/MCP
  settings. Source content cannot supply that context. Allowed results include
  required manual field protection, MCP audit tagging and question update IDs;
  denied results distinguish rejection, suggestion and dropped reintroductions.
- `deriveCardState` and the graph helpers port the reference projections and
  pass the same portfolio/decision golden expectations. Call them only after
  schema and invariant validation.

A commitment assertion's internal value is `{speakerEntityId, unambiguous}`.
Task creation requires `user_commitment`, explicit certainty and the configured
user's identity; dependency creation requires an explicit, unambiguous
`external_commitment` identifying another known entity. The assertion must
reference the proposed node and carry sources also present on the intent.
This is a policy boundary, not proof that an extractor interpreted a source
correctly. Pending assertions used during creation are part of the prospective
atomic command state; they are never persisted pointing to a missing node.

The reconciler supplies its match attempt through `PolicyContext.match` for
creation. A matched record requires an update rather than another create. For
MCP, `initiativeIds` must cover every affected initiative, including proposed
scope changes; an unrestricted portfolio operation requires unrestricted scope.
Unknown settings fail closed. Source-backed retries compare event time
(`happenedAt`) against rejection time, not ingestion time.

C3 adds `Domain.execute`: strict command arguments, trusted context, required
protection/suggestion effects, events and undo. `DomainPorts` supplies canonical
Ajv state/event validators and an atomic durable commit interface. The driver
assigns causal sequence/HLC; no state or subscriber changes before its success.
`getSnapshot`, `history` and `subscribe` return isolated views of acknowledged
state. Start with a base snapshot and its subsequent retained events; replay
builds the field writers, protection metadata and undo preimages.

The command tests use the real JSON Schemas and an in-memory commit port;
C4 still needs the filesystem driver and crash recovery. There is no
end-to-end ingestion path yet. See `docs/DOMAIN_COMMANDS.md` for argument
conventions and ADR-0012 for replay/undo behavior.
No persisted schema, model selection or feasibility decision changes in C2.

Run `pnpm check`; focused tests: `pnpm exec vitest run tools/workspace/domain-core.test.mjs`.
