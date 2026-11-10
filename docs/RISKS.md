# Risk register

Likelihood/impact: H/M/L. "Spike" = backlog item that retires or confirms the risk. Engineering controls have automated evidence; hardware/account/release acceptance remains open. See [the checkpoint](CHECKPOINT.md).

| ID | Risk | L | I | Mitigation / fallback | Spike |
|---|---|---|---|---|---|
| R1 | 2019 Intel MBP cannot run a useful local model without swapping, overheating or unacceptable latency | H | H | No accepted extractor or automatic fallback; optional explicit setup, manual/viewer mode, measured candidate selection; another ingestion Mac if accepted | S2 |
| R2 | Small local models produce unreliable structured extraction (invalid JSON, hallucinated commitments, wrong attribution of who-does-what) | H | H | Closed candidate schema; span required; repair-once-then-drop; explicit-commitment rule for Tasks; eval set from synthetic fixtures; everything undoable | S2 |
| R3 | Graphiti needs many LLM calls per episode and a capable structured-output model; too slow/inaccurate on small local models | H | M | Native SQLite ContextIndex is the default; Graphiti optional for full tier only | S3 |
| R4 | Graphiti's embedded/local graph store options are limited (licenses: GPL/SSPL; maintenance status of embedded options uncertain) | M | M | Native index ships; current embedded Intel wheel fails OS error 86; Kuzu deprecated; BSD wrapper does not approve SSPL engine distribution | S3 |
| R5 | Activepieces self-hosting requires Docker/Postgres/Redis — too heavy for non-technical users and Intel RAM | H | M | `SourceAdapter` with mandatory Activepieces pieces; measure library/runtime route; no independent native fallback (ADR-0011) | S4 |
| R6 | Activepieces pieces are trigger/action oriented and may lack historical backfill, thread retrieval, cursors or stable permalinks | M | H | Per-capability matrix; extend/customize read-only Activepieces pieces; I2 remains blocked on execution and account evidence | S4 |
| R7 | Granola API access or required pagination/transcripts may be unavailable for the selected plan/account/piece | M | M | Supported API via Activepieces default; explicit CSV import fallback only when API unavailable; no private caches (S5/ADR-0011) | S5 |
| R8 | Slack/Google OAuth for a personal unverified app: consent-screen limits, restricted scopes (Gmail is a restricted scope requiring verification for broad distribution), workspace admin approval for Slack apps | H | H | Start with user-owned OAuth client ("bring your own app") documented for alpha; plan verification before public release; IMAP/App Password fallback is **not** recommended | S4 |
| R9 | Dropbox/Google Drive behave unexpectedly with append-only logs (torn reads, delayed propagation, online-only placeholders, conflicted copies) | M | H | Single-writer files, torn-tail tolerance, dedupe, placeholder detection, restore-to-new-workspace | S1 |
| R10 | Concurrent edits on two Macs produce confusing outcomes | M | M | Deterministic LWW + material-conflict Questions + History | S1 |
| R11 | Packaging a Node core as a Tauri sidecar: size, startup time, native modules (SQLite), universal binary, notarization | M | M | Production Node SEA/FTS5 and native Intel/ARM CI pass; signing workflow prepared; actual universal/hardware/notary/upgrade checks open (ADR-0024) | S7 |
| R12 | Employer data stored in personal cloud folders violates employer policy | M | H | Onboarding notice; pointer-only cache policy; P6 design (not implemented); user responsibility stated plainly | — |
| R13 | Prompt injection via sources leads to wrong state or data exposure through MCP | M | M | Closed schemas, no outbound actions, excerpts off for MCP, undo | S6 |
| R14 | Scope creep turns Fulcrum into a task manager / PM tool | M | H | Spec non-goals in AGENTS.md; PR checklist; consistency audit per milestone | — |
| R15 | Background processing drains battery or annoys the user | M | M | Resource policy; visible pause; plugged-in-only default on Intel | S2 |
| R16 | Model license terms change or a model tier is withdrawn from Ollama's registry | L | M | Capability-tagged model selection; swappable runtime | — |
| R17 | MCP client ecosystem changes (transport/auth spec revisions) | M | L | Thin shim; pin SDK; contract tests | S6 |

## Encryption design risks (P6)

[ADR-0021](decisions/0021-workspace-encryption.md) and [ENCRYPTION.md](ENCRYPTION.md)
require implementation tests before claiming protection. Lost keys without a
saved recovery card mean permanent data loss. Migration needs enough disk for
backup and a verified new workspace; an offline Mac can still edit the retired
source. Provider history and local caches may retain plaintext. Native helper
entitlements, crypto packaging, signed identity, second-Mac recovery and actual
sync behavior are unvalidated; AEAD alone cannot prove completeness, prevent
whole-copy rollback or revoke a key from old copies.

## Open acceptance after the engineering checkpoint

- No real connector account/OAuth, source permissions, pagination/catch-up,
  permalink or rate behavior is accepted. Native probes are test instruments.
- No local model's extraction quality, sustained speed, battery, thermal or
  pause behavior is accepted on the target hardware. Setup compatibility is
  a separate synthetic check, and no extraction tier is enabled by it.
- Graphiti local inference/rebuild/quality is unmeasured. Its current embedded
  Intel store wheel failed execution; Apple Silicon and distribution review
  remain pending. Native alias resolution passed the shared synthetic cases.
- No real sync-client/two-Mac delivery or remote completeness is accepted.
- Native and production SEA CI pass on Intel/Apple Silicon; actual signed/
  notarized universal DMG, clean-user launch and upgrade remain unaccepted.
- SDK/Inspector and synthetic P1 MCP checks pass; Claude Desktop dialogs,
  Keychain ACLs and packaged headless behavior remain owner checks.

These are limits of the evidence, not claims that every engineering control
is untested. Owner procedures and the final adoption review are in CHECKPOINT.md.
