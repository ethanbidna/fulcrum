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
C4 provides the filesystem driver and local process-crash checks. There is no
end-to-end ingestion path yet. See `docs/DOMAIN_COMMANDS.md` for argument
conventions and ADR-0012 for replay/undo behavior.
No persisted schema, model selection or feasibility decision changes in C2.

Run `pnpm check`; focused tests: `pnpm exec vitest run tools/workspace/domain-core.test.mjs`.

## C5 read projections

`Domain.query(name, args)` reads the last acknowledged state and returns an
isolated result. Queries do not emit events or subscriber notifications. IDs
in every view are canonical: editing a focused item uses the same commands as
editing the full graph. A query during an in-flight commit sees the previous
acknowledged state.

- `portfolio.list({})`: active initiative records with exactly one derived card
  state. Grouping and presentation controls belong to U2.
- `portfolio.rail({since?})`: all available user actions, unresolved gating
  Dependencies deduplicated across active initiatives, recent meaningful change
  entries and the open Question count. Satisfied OR alternatives do not create
  waiting items. Deferred Questions are not counted as open.
- `graph.get({initiativeId})`: home nodes/edges, visual groups and external
  endpoint records in `references`.
- `graph.focus({nodeId})`: root and all `contains` descendants; internal edges
  and outgoing immediate `depends_on` prerequisites. References are not expanded
  into another subtree or graph. Simple nodes return ordinary detail slices.
- `initiative.get({id})` and `node.get({id})`: canonical records.
- `history.list({target?, actor?, since?})`: newest-first event order with
  replay-derived before/after operations, actor, command, evidence refs, run ID
  and undo linkage. An ignored replay operation has no fabricated change.
  Full retained history is required to reconstruct undo and delete preimages.

The rail defaults to the last seven days, at most 20 entries. Its clock comes
from the trusted application port. Lifecycle, execution state, MoSCoW, dates,
outcomes, routes, prerequisites, supersession and objective alignment changes
are meaningful, as are initiative/node/edge/question/objective creation or
removal. Renames, descriptions, ordering, group membership, timestamp and
protection maintenance are retained in History but omitted from the rail.
There is no generated prose or completion metric. Freshness remains a separate
machine-local ingestion concern; these queries do not infer successful sync.

The pure projection helpers accept schema/invariant-validated records. Their
record references belong to that supplied state; `Domain.query` clones the
public result. Unknown queries, unsupported arguments and missing records fail
explicitly. C6/P1 must authenticate clients and restrict read results before
sharing them with a scoped external client; these methods are the internal
core read API, not an exposed transport.

C7 adds typed `search` and `status.index` queries through the injected
`DomainPorts.readIndex` interface. No SQLite/runtime module enters the domain.
Unavailable search has its own `INDEX_UNAVAILABLE` code; canonical reads and
commands remain available. Search scopes are filters, not MCP authorization.
