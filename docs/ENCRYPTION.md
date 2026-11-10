# Workspace encryption design

Status: design for P6 / step 35; implementation is step 36. The draft storage
implementation is tracked in [P6 review](reviews/P6.md). Production app entry
points cannot yet unlock encrypted workspaces. The v1 schemas are unchanged. [ADR-0021](decisions/0021-workspace-encryption.md) records the decision.

## Scope and threat boundary

Protect canonical content at rest in a copied or cloud-synced workspace from
someone who lacks its key. Encrypt entire events, including commands, evidence,
actors and undo metadata, and entire checkpoints. Authenticate before parsing
content or exposing state. Encryption does not authorize employer data storage.

The manifest, workspace/key IDs, device-directory UUIDs, segment names, times,
file sizes and traffic patterns remain visible. Filenames must never contain
user titles or source identifiers. No padding or metadata-hiding promise.
Machine-local indexes, context, queues, backups of old plaintext workspaces,
exports, process memory, swap and model-runtime memory need separate protection;
this is not full-disk encryption. Recommend FileVault and appropriate account
security without claiming they were validated here.

A compromised unlocked Mac or any holder of the workspace key can read and forge
content. AEAD is not a device signature or authorization system. Whole-file
removal, truncation at a complete event boundary, rollback to an old valid copy,
and a sync provider withholding files are not generally detectable on a fresh
Mac. Existing sequence checks and locally remembered frontiers help detect some
loss; they cannot prove remote completeness. No server, telemetry or key escrow.

## Cryptographic profile

Use the maintained [libsodium implementation of XChaCha20-Poly1305-IETF](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction),
with a 32-byte master key and fresh random 24-byte nonces per encryption.
Combined ciphertext includes its 16-byte authentication tag. The extended nonce
permits random allocation across independent writers without a shared counter.
Retries reuse an already-produced envelope or encrypt again with a fresh nonce;
never derive a nonce from event IDs, clocks, device IDs or sequence numbers.

Generate keys/nonces with the library's OS-backed random generator, never a
seeded test generator in production. Fail closed if entropy or initialization
fails. See [random data](https://doc.libsodium.org/generating_random_data).
Use [crypto_kdf](https://doc.libsodium.org/key_derivation) with eight-byte ASCII
context `FULCRUM2` to derive 32-byte purpose keys: ID 1 for events, 2 for
checkpoints, 3 for manifest verification. Never use the master key directly as
an AEAD key. A random public UUID `keyId` identifies this master key; it is not a
hash, a password or a secret.

Use the upstream [libsodium.js wrappers](https://github.com/jedisct1/libsodium.js)
behind the core's crypto-driver interface. Step 36 must pin a maintained release,
verify the required AEAD/KDF/random APIs and packaged WASM assets on both Mac
architectures, and pass upstream-compatible vectors. No dependency is added by
this design. A missing runtime/API must disable encrypted open, with no cipher
fallback. AES-GCM was considered; its shorter nonce requires a different
allocation design. Secretstream was considered; independent event envelopes
fit existing append, torn-tail and conflicted-copy replay without stream state.
No custom primitive, password cipher or network pairing protocol is introduced.

## Keys, native storage and lifecycle

A native `WorkspaceKeyStore` owns Keychain access. Use Security.framework generic
password items, service `Fulcrum.WorkspaceKey.v1`, account
`<workspaceId>:<keyId>`, with the 32 raw key bytes as value. Set
`kSecUseDataProtectionKeychain=true`, `kSecAttrSynchronizable=false` and
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. This supports the intended
background policy after first unlock; it does not promise isolation while the
Mac is unlocked. Apple's [data-protection keychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
and [accessibility rules](https://developer.apple.com/documentation/security/ksecattraccessible)
require explicit macOS handling; [the selected accessibility class](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)
keeps key migration out of the automatic transfer path.

The signed native helper owns the required Keychain entitlements/access group;
only that helper accesses the item. A trusted launcher starts the bundled helper
with inherited private pipes and bounded frames; paths/operations are fixed by
the application, not source text. It brokers keys only to the core session,
with no key-returning method on the general UI/MCP socket. Never pass keys through renderer JS, MCP,
command arguments, environment variables, diagnostics or the installation's
existing CLI-secret creation path. A source/model cannot select key IDs,
recipients, destinations or unlock operations. No per-read biometric requirement
that would prevent opted-in background operation. Denial/locked/unavailable
Keychain pauses encrypted open; never fall back to a plaintext key file.
Actual entitlements, helper identity, reboot/login and prompt behavior must be
verified in step 36 and packaged signing in P5; development success is not proof.

Key generation is permitted only during explicit new-workspace setup or
migration. Opening an existing encrypted workspace with a missing key offers
Import recovery key or Cancel; it must never silently generate a replacement.
Keep key buffers scoped to the open core/store session, clear mutable buffers
on close and terminate decrypted workers. JS/WASM garbage collection can leave
copies; do not promise guaranteed zeroization or protection from memory dumps.
Before first unlock, show locked state without opening caches or starting AI.

Initial scope permits background access after first unlock, including screen
lock. Explicit application lock closes the store, cancels jobs/subscriptions,
clears projections and denies UI/MCP reads/writes until unlock; quitting the
core has the same key-lifetime boundary. This does not erase cached files.
"Remove Fulcrum data from this Mac" must warn if it removes the last available
key and require recovery confirmation before deleting workspace-key items.

## Recovery and second-Mac transfer

Use a generated recovery card, not a human-chosen password. Its exact fields are
`{format,version,workspaceId,keyId,encodedKey,checksum}`: format is
`fulcrum-recovery`, version is 1, and encodedKey is the 32-byte master key as
unpadded base64url. Include a SHA-256 checksum of the UTF-8 JSON array
`["fulcrum-recovery",1,workspaceId,keyId,encodedKey]`, as 64 lowercase hex
characters. The checksum detects transcription errors; only successful AEAD
manifest verification authenticates the imported key. Parsing rejects duplicate
or unknown fields, wrong lengths, noncanonical base64url and unsupported versions.
The card is a plaintext secret equivalent to every copy of that workspace.

1. Generate a fresh workspace/key identity and store/read back its key locally.
   Display the card only in a native sensitive-data panel, on explicit request.
   No automatic clipboard copy, screenshot, email, upload or recovery file in
   `exports/`. If saving a card, require an explicit destination outside the
   workspace and its sync root; no default file is written.
2. Ask the owner to save it in an appropriate password manager or offline medium
   separate from the workspace. Confirm by re-entering the saved card through
   the native panel and verifying the sealed manifest. Activation/migration
   cannot finish until this recovery check succeeds. No secret goes to webview
   state, logs, model prompts or MCP responses.
3. On the second Mac, open the fully downloaded encrypted workspace, display its
   public workspace/key IDs, and ask for the saved card through the native
   panel. The user transfers it out of band using a channel they trust; Fulcrum
   does not auto-sync keys or operate a transfer service. Check IDs/checksum,
   authenticate the manifest, then persist/read back the key in that Mac's
   Keychain. A wrong key leaves files and existing Keychain items untouched.
4. Only then decrypt/replay the workspace, register a new local device through
   Domain.execute, and rebuild local indexes. Do not copy device.json, connector
   credentials, runtime profiles or ingestion ownership. Opening starts as
   viewer/editor unless canonical designation and explicit local setup permit
   ingestion. A key transfer alone never enables sources, hosted AI or MCP.

If one Mac's key is lost, import the saved card or explicitly reveal it on a
still-unlocked authorized Mac. If every key/card is lost, encrypted data is
unrecoverable; there is no reset or support override. Backups alone are not a
key backup. Rotation or suspected compromise requires an explicit copy to a
new workspace/key and new recovery card, using the migration rules below.
There is no remote revocation: old keys still decrypt old copies/history.

## Version 2 storage contract — proposed, not installed

Step 36 adds `schemas/v2/` and a storage codec; it must not repurpose v1's
reserved fields or weaken its validators. The directory layout stays exactly
`workspace.json`, `log/`, `checkpoints/`, `exports/`. Inner canonical ChangeEvent
and WorkspaceStateDoc semantics remain v1; outer encrypted storage is v2.
Separate storage-version guards from logical-document versions in the store,
core composition and bundled validators; changing the manifest number alone
cannot enable v2. Keep v1 read/write support explicit, without an encrypted
workspace ever falling back to the plaintext codec.

| File | Planned encoding |
|---|---|
| `workspace.json` | Strict plaintext manifest: existing identity/creation fields, `schemaVersion: 2`, `minReaderVersion: 2`, and required encryption descriptor below |
| Each complete log line | One strict encrypted envelope plus LF; plaintext is the exact original event bytes without LF |
| Each checkpoint | One strict encrypted envelope; plaintext is the complete validated checkpoint JSON |
| `exports/` | Never implicitly written or copied during migration; explicit plaintext export requires disclosure and a user-selected destination |

Manifest encryption descriptor: `scheme: "xchacha20poly1305-ietf-v1"`, `keyId`
and `check: {nonce,ciphertext}`. The check uses purpose key 3 and seals UTF-8
JSON serialization of this fixed-order array:
`[format,schemaVersion,workspaceId,createdAt,minReaderVersion,scheme,keyId]`.
After authentication, compare the decoded array with the validated manifest.
The exact descriptor/scheme/version is allowlisted; source files cannot select
crypto algorithms, KDF costs, code or arbitrary key lookups. Keychain requests
are scoped to the explicitly opened workspace and require its native unlock flow.

Event/checkpoint envelope fields are exactly
`{encoding:"fulcrum-encrypted-v1",kind,keyId,nonce,ciphertext}`.
`kind` is `event` or `checkpoint` and must match its directory. Nonce and
ciphertext use canonical unpadded base64url. Use purpose key 1 or 2 respectively.
For all three kinds, associated data is UTF-8 JSON serialization of the array
`["Fulcrum",2,kind,workspaceId,keyId,deviceId]`; manifest checks use
`kind="manifest"` and `deviceId=null`. Events/checkpoints use their containing
UUID directory, not a filename, so legitimate conflicted-copy renaming works.
The decrypted event's deviceId must also match. Verify checkpoint identity and
frontier against authenticated retained events before using it.

Validate bounded envelopes first; authenticate before UTF-8/JSON/schema parsing.
Reject duplicate JSON keys, unknown fields, bad lengths, unexpected kind/key ID,
invalid tags and plaintext lines in v2. No compression. Planned named limits:
`MAX_MANIFEST_BYTES=64 KiB`, `MAX_RECOVERY_CARD_BYTES=1 KiB`,
`MAX_ENCRYPTED_SEGMENT_BYTES=1 MiB`, `MAX_CHECKPOINT_PLAINTEXT_BYTES=32 MiB`,
`MAX_CHECKPOINT_ENVELOPE_BYTES=48 MiB`. Check encoded and decoded sizes before
allocation/commit; actual envelope/base64 overhead counts toward the segment
budget. Oversized atomic batches fail before any publication. Limits need
boundary tests, not automatic enlargement from untrusted headers.

Authenticate every complete event before dedupe. Compare exact decrypted event
bytes for duplicate event IDs; random ciphertext differences are not collisions.
Different plaintext for one event ID is an integrity failure. Preserve per-device
sequence validation, HLC ordering, field conflicts, evidence, protections,
idempotency and full retained history for undo. AEAD adds no device authority.

Keep ADR-0013's append/fsync, no-replace publication and whole-batch visibility.
An unterminated last line is reported/ignored as a torn tail and is never reused
for appending. A malformed or unauthenticated complete log line fails the open;
never skip it to show an apparently complete portfolio. Invalid checkpoints are
reported and ignored only if full authenticated log replay succeeds. Missing or
unreadable placeholders withhold state; an invalid checkpoint is not permission
to ignore a hydration failure. No key or any failed authoritative event means
no decrypted partial view, commands, ingestion, search or MCP disclosure.

Old readers must refuse v2, not show empty/read-only state they cannot decode.
Removing encryption fields or substituting plaintext into a v2 directory is a
format failure. Remember encrypted identities/minimum versions machine-locally
to detect observed downgrades. A fresh Mac cannot distinguish a full rollback
from a legitimately older workspace; no anti-rollback guarantee is claimed.

## Migration, backup and restore

Refine ADR-0005's no-rewrite rule by copying into a new workspace ID with a new
key, never by overwriting source logs or switching a live shared manifest.
Encryption setup, export, key operations and migration are trusted local
administration, unavailable to AI/connector/MCP commands. They change storage,
not canonical business records; all subsequent business edits still use
Domain.execute. User-visible Settings → Privacy & Data owns the focused setup
flow; P4 supplies settings/navigation and P6 supplies its storage implementation.

| Phase | Required action and crash behavior |
|---|---|
| Preflight | User pauses all other Macs, confirms updated readers and complete download, and stops local commands/ingestion. Hold the local core lock; drain writes. Capture a stable source inventory/frontier. Provider completeness remains an S1 limitation, not something a local lock proves. |
| Backup | Make a durable, verified machine-local backup of manifest, every retained log and needed checkpoints outside sync/workspace. Read it back and validate/replay it. A v1 backup is plaintext: disclose this, restrict access and retain it until explicit owner cleanup. If backup verification fails, stop without creating a destination. |
| Prepare | Generate/read back destination key; confirm saved recovery card. Exclusively create a fresh destination folder. A private machine-local journal holds source/destination IDs, inventory and phase; it holds no keys, content or synced paths inside the workspace. |
| Copy | Write only ciphertext to destination log/checkpoint areas with no-replace publication and fsync. Preserve exact original event bytes/IDs, device IDs, seq, HLC, command/proof/undo metadata. Rebuild checkpoints with the new workspaceId. Write the authenticated destination manifest last; an interrupted pre-manifest folder is incomplete and cannot open as a workspace. |
| Verify | Re-open/read every destination envelope with a fresh key-store read; authenticate and fully replay. Compare ordered event bytes/counts/frontiers and normalized domain/protection/undo results with source (allow only the new workspaceId). Verify source inventory/frontier stayed unchanged; new source edits abort activation and require a fresh comparison/copy. |
| Activate | Only after all checks, switch this Mac to the new workspace. Create new machine-local identity/caches for its new workspaceId; do not copy credentials or old cursors. Acknowledge success, display old plaintext/backup locations locally and direct every other Mac to this new folder/key. Keep the old source and verified backup; never silently delete them. |

A destination with a published manifest is immutable as a migration result:
never resume by overwriting it. Revalidate a finished candidate or start another
fresh destination. Before manifest publication, resume only against the matching
private journal and unchanged source inventory, rechecking all existing output;
otherwise abandon that candidate. Recovery data never authorizes deletion of an
unrelated directory. Insufficient disk space or any write/auth failure prevents
activation. No progress marker or migration journal belongs in the workspace.

No app operation can atomically freeze remote offline Macs. Later edits to the
retired source are not silently merged across workspace identities: identify
the divergence and require explicit recovery. Cloud history, old Macs, Trash,
APFS snapshots, plaintext backups and prior exports may retain plaintext.
Enabling encryption does not erase them or prove policy compliance. Disabling
encryption is a separate explicit plaintext-copy/export operation with the same
backup/verification gate; never downgrade an encrypted folder in place.

Normal backups of an encrypted workspace copy ciphertext and the authenticated
manifest, with no key inside the archive. Restore first needs the original key,
then decrypts/validates every retained event and copies into a new workspace ID,
new key and new recovery card. It never overwrites the live workspace. Missing
key, incomplete history or invalid authoritative data leaves the source intact
and prevents activation. Do not silently fall back to an older key or snapshot.
Local caches remain rebuildable and may contain plaintext; they are not included
in the portable backup and are never uploaded by encryption setup.

## Step 36 acceptance gates

- Add versioned schemas/codec and old-reader rejection tests; no v1 reinterpretation.
- Upstream-compatible known-answer vectors, independent decrypt, random nonce
  production binding, purpose/AAD separation, wrong key, bit flips, substituted
  manifest/device/workspace/kind, malformed/duplicate/oversized envelopes.
- Same plaintext event with different ciphertext dedupes; changed event bytes,
  sequence collision/gap, complete corrupt lines and placeholder files fail.
  Torn tails and conflicted-copy filenames retain current semantics.
- Golden projections/conflicts, question maintenance, retry/idempotency,
  protections, focused/full views and run undo match plaintext full-history replay.
- Real filesystem/crash tests at backup, key persistence, copy, manifest fsync,
  verification and activation boundaries; insufficient disk, changed source,
  restart/resume and failed checkpoint paths never acknowledge partial success.
- Keychain-port unit tests and actual signed-helper tests on Intel/Apple Silicon:
  missing/denied/locked key, first unlock/reboot, entitlement identity, explicit
  lock, close, recovery re-entry and second-Mac import. No secrets in argv,
  environment, renderer, error frames, diagnostic logs or workspace inventories.
- Recovery loss/rotation, encrypted backup/new-ID restore and retained plaintext
  disclosures; no automatic erasure, remote revocation or provider-completeness claims.
- Run disposable two-Mac Dropbox/Drive cases after S1 prerequisites permit;
  model/connector behavior and signing/distribution retain their own gates.

This design review establishes none of these implementation or hardware passes.
