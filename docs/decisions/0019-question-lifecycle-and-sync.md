# ADR-0019: Question lifecycle and sync choices

Status: Accepted

Supersedes ADR-0012 only for the bounded restore resolution below.

## Context

A1 needs questions that remain contextual, consolidate repeated evidence, honor
user deferrals, and survive replay across devices. Production replay previously
folded values without exposing the reference fold's conflicts. Ordinary creates
cannot restore tombstones, and ADR-0012 disallowed undo inside resolutions.

## Decision

- The pure domain question planner admits medium/high materiality with two or
  three catalog-valid choices that pass domain preparation when raised. An empty command list is a deliberate keep action.
  Similar means the same initiative, target including field, reason and concrete
  command choices; prompt wording is not an identity. Different decisions are
  not merged merely because their text resembles each other.
- Derived question IDs use UUIDv5 of the dedupe key in namespace
  `a1774be0-3f7b-5dc6-a7e3-28574b6df571`. The store driver owns SHA-1/UUID encoding;
  pure callers receive an identity function. The core supplies this function.
- Live repeated questions retain identity, creation time, combined evidence and
  deferral. Closed questions stay closed. Strictly newer source `happenedAt`
  evidence can create a new contextual occurrence. Observation time and model
  prose never reopen a rejected decision. Dated deferrals become open when the
  core next observes that they are due; null means an indefinite deferral.
- Newer applied evidence matching the canonical field can obsolete an ambiguity,
  provided equally recent contradictory claims do not remain. Protected fields
  are not rewritten. Lifecycle maintenance emits commands through `Domain.execute`.
- Replay reports concurrent writes, missing-record writes, write-after-delete
  and duplicate creates using the reference fold's classifications. Material
  conflicts generate fixed domain templates, never commands taken from sources.
  Nonmaterial conflicts keep their ordinary event history without questions.
- `sync.chooseValue` accepts a contextual target, a whitelisted material field,
  value and expected writer. Only user/MCP actors may execute it. Ordinary schema,
  invariant, MCP scope and manual-protection rules still apply. A later field
  writer makes the choice stale rather than overwriting the newer edit.
- A sync-conflict resolution may contain exactly one `change.undo` of an event
  containing a tombstone. It uses the existing stale-checked undo preparation,
  then appends question closure to the same compensating event with `undoOf`.
  Both undo scope and question scope are checked. Other nested undo and run undo
  remain forbidden. Restore returns the deleted preimage and links; it does not
  apply the offline edit that arrived after deletion.
- A deleted node/edge's question targets its surviving initiative. Multiple
  ignored writes to that deleted record consolidate into one restore question.
  Conflict templates whose choices cannot pass domain preparation are omitted;
  the events remain available in History. Later causal writes obsolete an old
  field conflict. A subsequent collision after closure gets an occurrence key
  derived from the base sync key and winning event, so both devices agree.
- The core maintains questions on open, reload, commands and reads. Idempotency
  keys based on conflict events prevent historical collisions reopening after
  restart. This requires no model, connector, network, timer daemon or popup.

## Consequences

No v1 persisted record or event shape changes. The new command name is an audit
label; replay continues applying stored ops without executing command text.
The synthetic fixture's existing choices now use canonical command argument
names. UI grouping/evidence display remains U8. Real sync-provider and two-Mac
validation remains S1; synthetic replay/core tests do not complete that check.
