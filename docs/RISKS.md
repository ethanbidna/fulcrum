# Risk register

Likelihood/impact: H/M/L. "Spike" = backlog item that retires or confirms the risk. Nothing in this table has been validated yet.

| ID | Risk | L | I | Mitigation / fallback | Spike |
|---|---|---|---|---|---|
| R1 | 2019 Intel MBP cannot run a useful Llama model without swapping, overheating or unacceptable latency | H | H | Constrained tier (3B→1B, extraction only, plugged-in only); viewer mode; designate an Apple Silicon or always-on Mac as ingestion device | S2 |
| R2 | Small local models produce unreliable structured extraction (invalid JSON, hallucinated commitments, wrong attribution of who-does-what) | H | H | Closed candidate schema; span required; repair-once-then-drop; explicit-commitment rule for Tasks; eval set from synthetic fixtures; everything undoable | S2 |
| R3 | Graphiti needs many LLM calls per episode and a capable structured-output model; too slow/inaccurate on small local models | H | M | Native SQLite ContextIndex is the default; Graphiti optional for full tier only | S3 |
| R4 | Graphiti's embedded/local graph store options are limited (licenses: GPL/SSPL; maintenance status of embedded options uncertain) | M | M | Adapter boundary; rebuildable; skip Graphiti if no acceptable store | S3 |
| R5 | Activepieces self-hosting requires Docker/Postgres/Redis — too heavy for non-technical users and Intel RAM | H | M | `SourceAdapter` interface; native adapters; possibly use Activepieces pieces as libraries | S4 |
| R6 | Activepieces pieces are trigger/action oriented and may lack historical backfill, thread retrieval, cursors or stable permalinks | M | H | Per-capability matrix; native adapters where gaps exist | S4 |
| R7 | Granola has no suitable supported API for personal export | M | M | Verify official options; fall back to user-initiated export/import or file-folder watching | S5 |
| R8 | Slack/Google OAuth for a personal unverified app: consent-screen limits, restricted scopes (Gmail is a restricted scope requiring verification for broad distribution), workspace admin approval for Slack apps | H | H | Start with user-owned OAuth client ("bring your own app") documented for alpha; plan verification before public release; IMAP/App Password fallback is **not** recommended | S4 |
| R9 | Dropbox/Google Drive behave unexpectedly with append-only logs (torn reads, delayed propagation, online-only placeholders, conflicted copies) | M | H | Single-writer files, torn-tail tolerance, dedupe, placeholder detection, restore-to-new-workspace | S1 |
| R10 | Concurrent edits on two Macs produce confusing outcomes | M | M | Deterministic LWW + material-conflict Questions + History | S1 |
| R11 | Packaging a Node core as a Tauri sidecar: size, startup time, native modules (SQLite), universal binary, notarization | M | M | Prefer built-in `node:sqlite` or Bun; measure; fall back to Rust core if unworkable | S7 |
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

## Explicitly not validated in Phase 0

- Any connector authentication, backfill, pagination, permalink or rate-limit behavior.
- Any model's speed, memory use or extraction quality on any Mac.
- Graphiti on any local configuration.
- Sync behavior under any real sync client.
- Tauri packaging, signing, notarization or updates.
- MCP with any real client.
