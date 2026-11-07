# S1 harness findings

## Validation boundary

The harness and local simulations exist. No real Dropbox or Google Drive sync
client has been exercised. Propagation latency, provider-created torn tails,
conflicted-copy naming, placeholder behavior and cross-device checkpoint delivery
remain unmeasured. ADR-0005 stays provisional; no format change is recommended
on simulated evidence alone. Follow [the procedure](S1-procedure.md).

The harness reuses the reference reader and fold without modifying schemas or
merge semantics. It deliberately performs full replay for authoritative state
and conflict reporting, while reporting the newest eligible checkpoint. It does
not claim to validate checkpoint-accelerated recovery or the future core store.
Checkpoints contain state, contiguous frontier, maximum HLC and field writers for
the harness's create/set histories. Other command histories are outside scope.

## Reference reader placeholder gap

`readWorkspace` accepts an empty `.jsonl` as an empty event set and supplies no
placeholder diagnostic, contrary to WORKSPACE_FORMAT's requirement not to fold a
partially downloaded workspace. An executable failing regression is recorded as
`test.todo` in `tools/test/s1.test.mjs`; Node executes the assertion but does not
fail the suite for this acknowledged upstream gap. Run it with
`node --test --test-name-pattern='reference reader should reject' tools/test/s1.test.mjs`.

The harness preflights readable nonempty JSON/JSONL files before invoking the
reader and withholds state/hash on failure. This does not identify provider
metadata, guarantee a complete remote inventory, or prevent a sync update racing
a read. A provider may hydrate a file during reading or not yet expose its name.
The real-client experiments must characterize these behaviors before production.
No reference implementation or schema was changed.

## Identity recovery limitation

The specified higher-sequence clone detector cannot distinguish a migrated copy
from a crash after log fsync but before local identity persistence. The harness
conservatively refuses further writes until `device` rotates the identity when
it sees a higher sequence. Equal-frontier clones remain undetectable until one
advances and its writes are observed by the other. This is a limitation of the
specified criterion, not a claim of safe simultaneous cloned writers. A stale
local lock after a killed CLI requires manual removal after verifying no writer
is alive. Locks and identity data never belong in the workspace.

## Scope and implementation

This is a throwaway Node ESM spike, matching the existing `.mjs` reference tools;
it does not establish the future TypeScript core. Existing Ajv dev dependencies
validate emitted events/checkpoints at runtime, so install with `corepack enable` and `pnpm install --frozen-lockfile` including
dev dependencies. No dependencies were added. All event mutations pass through
the spike's `Domain.execute`; no UI, connectors, network or telemetry are added.
Runtime IDs are UUIDv7; literal fixture IDs use the repository's synthetic pattern.
Synthetic labels are operator input and must not contain personal information.
