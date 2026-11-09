# Native context index

`SqliteContextIndex` implements the `ContextIndex` interface in ADR-0004 using
Node 22's built-in SQLite/FTS5. It is advisory and makes no domain writes, model
calls, network requests or identity merges. No Graphiti adapter is enabled.

Open with the workspace ID and an existing machine-local directory outside the
portable workspace. The core owns `context.sqlite` under its profile lock.
Opening checks directory ownership, rejects symbolic/hard-linked database files,
sets file mode 0600 and clears a cache belonging to another workspace. Corrupt
SQLite files are preserved as `.invalid-<id>`; unsupported cache versions fail.
The core replays folded state on open, after external reloads and acknowledged
commands. A cache failure disables that instance until reopen; ordinary reads
and acknowledged writes survive.

`Episode` is one canonical entity, source, assertion or projected graph target.
`snapshotEpisodes(snapshot)` produces these records without extraction. `ingest`
atomically upserts one record, replacing its aliases/external IDs and search text;
it does not acknowledge an ingestion queue or create authoritative records.
`rebuild(asyncEpisodes)` atomically replaces everything, including deletions,
merge/split changes and revoked excerpts. Interrupted replay rolls back. Reads,
ingests, rebuilds and close are serialized. Sources with `cachePolicy: none`
never retain excerpts in JSON or FTS. Retained excerpts remain untrusted data.

`resolveEntities` uses NFC, whitespace normalization and lowercase exact
label/alias matches. Explicit external IDs match connector plus exact remote ID,
with no fallback to a label when an ID is unknown. Merge chains resolve to live
canonical IDs; cycles, dangling chains and incompatible types resolve nothing.
Several matches return `ambiguous` with all candidates, never a guessed winner.
This also supports canonical `initiative_alias` entities; it does not infer new
entities or graph nodes from similar titles. Batches are limited to 100 mentions
of at most 500 characters each.

`related(target, limit)` accepts an initiative/node/edge, entity or literal text.
Initiatives include their graph; object targets retain their own assertions.
Entities follow canonical references and source senders, including merged IDs.
FTS searches titles, aliases and permitted excerpts; punctuation cannot select
SQL/FTS operators. This is an internal context retrieval API, not an externally
scoped MCP endpoint. Claims retain conflicting/superseded states, evidence refs,
validity bounds, event time and observation time. History sorts newest event
instant first, then observation instant and ID; it chooses no winning claim.
Each returned collection is independently capped by `limit` (1–100); referenced
sources outside that bound can be read through the canonical evidence API.

The initial core refresh rebuilds the small derived cache from a detached
snapshot. Retrieval scans canonical cached records after indexed identity/FTS
lookup; hardware/large-workspace performance is unmeasured. Incremental
publication can be added behind this interface if measurements justify it.

`packages/ingest.identityQuestion` prepares a fixed `question.raise` invocation
for a material, evidenced ambiguity on an existing Dependency, with two or three
candidate choices. The caller supplies the canonical Dependency, evidence and a
stable question ID; source content supplies no commands. The key is per target
and field, so `Domain.execute` updates the existing open/deferred question.
Choosing an identity runs `node.update` through the same domain transaction and
supports undo. Unresolved, nonmaterial, missing-evidence, Task or broader-than-
three-candidate inputs abstain. Wider ambiguity needs further evidence before a
concrete bounded choice is possible. I5 will invoke this planner; no unattended
reconciliation or automatic question publication is enabled here.

Verification: `tools/workspace/context-index.test.mjs` uses real SQLite and
`fixtures/scenarios/identity.json`, including person/project aliases, scoped
external IDs, merged identities, contextual question dedupe/selection/undo,
chronology, retention, replay, corruption and core cache failure recovery.
