# ADR-0021: encrypted workspace copies

- **Status:** Accepted design; implementation and validation pending
- **Date:** 2026-11-10
- **Refines:** ADR-0005 and ADR-0013 encrypted encoding/migration boundaries
- **Plan:** P6 step 35; step 36 implements this decision

## Decision

Use the [encryption design](../ENCRYPTION.md) as the step 36 contract. Keep the
single per-device event history and domain semantics; add an explicit v2 storage
codec that authenticates/decrypts before existing event validation and replay.
Encrypt complete events and checkpoints with libsodium XChaCha20-Poly1305,
fresh random nonces and purpose-separated keys. Authenticate manifest identity
and all encoding context. Keep encoded publication limits and ADR-0013's durable
single-event/whole-batch behavior. Reject unsupported readers and corrupt
complete events; never silently open a partial encrypted workspace.

Generate a random workspace master key, store it through a native non-syncing
Keychain driver and require a saved/re-entered recovery card. Transfer that key
out of band on explicit user action; never sync credentials or expose keys via
renderer/MCP/model channels. No hosted key service, password-reset backdoor or
new daemon. Keychain denies and missing keys fail closed. Background access is
after first unlock; app lock closes decrypted access. Native entitlements,
packaging and key-lifetime behavior require actual platform validation.

Encryption migration, rotation and restore create a new workspace identity in
a fresh destination, backed up and fully verified before activation. Preserve
event IDs and exact plaintext event bytes, retained history, undo/protection,
HLC and merge rules. Rebuild checkpoints/caches for the new workspace identity.
No in-place event rewriting, mixed plaintext/encrypted logs or live shared
manifest switch. Other Macs must explicitly move to the new workspace; local
locks cannot prevent an offline Mac writing the retired source.

## Alternatives and consequences

- Encrypting only ops leaks command arguments, evidence and audit content.
  Encrypting a whole mutable archive prevents the existing independent writers.
- AES-GCM would need another nonce-allocation design. Stateful encrypted streams
  add replay state to conflicted-copy and torn-tail recovery. Independent AEAD
  envelopes match the current event boundary with a maintained implementation.
- An optional password-derived wrapper adds password/KDF and recovery semantics;
  the initial design instead uses a generated high-entropy recovery card.
- Copy migration uses extra disk and changes workspace identity, but preserves
  the original and its backup and avoids cross-device in-place format races.
- Cloud observers still see metadata. Shared-key holders can forge events;
  whole-copy rollback/deletion and compromised local machines remain limits.
  Native signing, encrypted local caches and historical plaintext erasure are
  not established by this decision. Encryption never grants employer permission.

## Approval and evidence

Merging the design PR is step 35's approval under the standing review/merge
authorization in PLAYBOOK. No Owner checkbox or hardware acceptance is completed.
The PR contains documentation only: v1 schemas, source code, fixtures,
dependencies, keys and workspaces remain unchanged. Issue #35 stays open until
step 36's implementation criteria are met. Primary cryptographic/platform
references and the required implementation tests are in ENCRYPTION.md.
