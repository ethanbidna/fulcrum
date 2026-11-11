# Reconciliation plans

`reconcile(input)` is a pure, deterministic function over validated typed
candidates, canonical state, entity resolutions and remembered rejections. It
returns `{commands, questions, suggestions, proofs, baseFrontier, runId}`. It
performs no I/O, inference, source recording, queue acknowledgement or writes.

Inputs include a canonical source ID, its transient text, a trusted initiative
scope, user identity, observation time and run ID. `idForKey` is a trusted pure
port: use UUIDv5 in a fixed Fulcrum namespace so the same workspace/key yields
the same ID across machines. Tests supply synthetic stable IDs. Optional
`protections` carry audited protections absent from persisted record fields;
Domain remains the final authority for all protection and policy checks.

The caller must first validate candidates through `ModelRuntime`. The planner
also bounds batches to 32, rejects invalid/out-of-bounds spans, uses fixed
candidate dispatch and ignores unknown kinds. Raw text never supplies actor,
commands, tools, settings, recipients, IDs, scope or proofs. Evidence ranges are
retained only when the cached excerpt equals the transient text; otherwise a
source pointer is used rather than an incorrect excerpt offset.

## Mapping

| Candidate | Planned behavior |
|---|---|
| User commitment | Requires the canonical sender to be the user. Match a scoped Task by exact normalized title before creating. Creation carries a trusted explicit commitment assertion in the domain proof. |
| External commitment | Requires exactly one resolved live entity matching the canonical sender, distinct from the user. Match before creating a Dependency. Ambiguity on one existing live Dependency uses I4's contextual identity-question planner; unresolved new work abstains. |
| New initiative | Match existing titles before proposing. New records stay proposed, with approve/reject choices in a contextual Question; AI never activates them. |
| State change | Match one scoped node, accept only states valid for that primitive. Deciding requires an actual option through `decision_made`. |
| Decision made | Resolve one existing option ID/label and use `decision.decide`; both state and outcome protection apply. |
| Date | Accept an exact valid calendar date. Relative due hints require a separate validated date candidate; no guessed date parsing. |
| Priority opinion | Record a suggestion, never an automatic MoSCoW write. A differing classification raises one material contextual question. Agreement raises none. |
| Relationship | Resolve existing scoped endpoints, reuse matching edges, allow only depends_on/leads_to, and check graph invariants before proposing an edge. |

Matching uses NFC, whitespace normalization and lowercase exact titles/IDs within
the trusted initiative. It abstains on multiple matches and incompatible node
types. It does not invent entities or apply fuzzy identity guesses. Evidence
attaches to canonical records; existing Tasks are never reassigned or reopened
by another commitment.

## History, conflicts and manual choices

Assertions retain explicit evidence, observation time and source event time.
A prior newer claim supersedes an older incoming claim. A strictly newer,
unprotected nonmaterial fact may update the field; material differences and
ambiguous time ties preserve both claims and raise a contextual Question.
Protected fields produce suggestions. New evidence agreeing with the canonical
value can make an older conflicting/protected question obsolete without
choosing a user's resolution.

`assertion.setStatus` updates prior claims through the domain command path.
It accepts conflicting or superseded, validates replacement target/predicate,
rejects cycles and prevents AI from reviving rejected assertions. It does not
change the target's canonical value. Claim records may omit observedAt; the
domain supplies its trusted clock, keeping retry/rejection signatures free of
observation-time changes while events retain the actual timestamp.

An open/deferred question is updated by its dedupe key. Fresh evidence after a
closed question gets a new deterministic key/ID linked to that previous question;
closed history is retained. Keep current value runs `field.protect`, so that
explicit choice survives later source claims. Apply runs the ordinary field
command under the user's authority and protection rules.

Rejections compare stable semantic command invocations. Node/edge creation
arguments exclude evidence and clock metadata; those belong to the envelope
and separate evidence commands. Indefinite rejections survive source changes;
untilNewEvidence uses source happenedAt, never a later observation time. Undoing
a run also blocks replay of its rejected suggestion at a later processing time.

## Execution boundary

Every envelope carries AI authority, evidence, a shared run ID and a stable
idempotency key. `proofFor(plan, invocation)` returns only the exact prepared
creation's match/commitment proof; altered arguments get no proof. These are
trusted planner outputs, never fields accepted from source/model content.

A composition client must serialize the plan against its base frontier, bind
the proof lookup through the existing trusted DomainPorts callback and call
`Domain.execute` in commands, suggestions, questions order. Stop on the first
rejection and replan or compensate through run.undo. Each domain command is an
atomic event; this API does not claim whole-plan atomic publication. Domain
rechecks evidence, schema, manual precedence, designated device and all other
policies at execution time. All accepted writes remain auditable and undoable.

The production core does not publish these plans or enable a processing
consumer. No model tier is accepted. Queue acknowledgement, live connector
wiring and unattended writes remain disabled; audit #63 must be resolved before
unattended processing. No benchmark, inference, account or hardware result is
accepted by these synthetic tests.
