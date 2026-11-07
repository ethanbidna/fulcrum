# ADR-0005: Portable workspace = per-device append-only event logs + checkpoints; SQLite is a local cache

- **Status:** Accepted · Sync-provider behavior **provisional** (S1)
- **Date:** 2026-11-07

## Context
The workspace must live in a user-chosen folder (local, Dropbox, Google Drive), move between Macs, survive concurrent edits, and never sync a live database. The handoff proposed per-record JSON files (`initiatives/*.json`, …) plus `changes/<device>/*.jsonl`.

## Options
1. **Per-record mutable JSON files** — readable, but two Macs editing the same record rewrite the same file ⇒ sync-client conflicted copies, lost updates, no field-level merge.
2. **SQLite file in the synced folder** — forbidden by the spec; corrupts under sync.
3. **Per-device append-only event logs + per-device checkpoints** — every file has exactly one writer; merge is a deterministic fold.
4. **CRDT library (Automerge/Yjs) documents** — strong merge semantics, but opaque binary formats, harder to inspect, and more than we need for field-level LWW.

## Decision
Option 3, specified in [WORKSPACE_FORMAT.md](../WORKSPACE_FORMAT.md):
- `log/<deviceId>/*.jsonl` append-only; `checkpoints/<deviceId>/<hlc>.json` atomic writes; `workspace.json` immutable except on migration.
- Field-level LWW over a total order `(hlc, deviceId, seq)`; concurrent writes detected with `baseEventId`; material conflicts become Questions with deterministic IDs.
- SQLite (FTS5, read models) and any context store are **machine-local and rebuildable**.
- Human-readable exports are a feature (`exports/`), not the storage format.

## Consequences
- Every device converges; no file is ever written by two Macs.
- Reading requires a fold — fast for single-user volumes; checkpoints bound startup cost.
- The format is plain JSON lines and can be read with any tool.
- Reference implementation and tests exist (`tools/reference/fold.mjs`, `tools/test/merge.test.mjs`).

## Validation (S1)
Two Macs, Dropbox and Google Drive (mirror and stream modes): concurrent offline edits, torn tails, conflicted copies, placeholder files, propagation latency, checkpoint fallback, clone-detection after Migration Assistant.
