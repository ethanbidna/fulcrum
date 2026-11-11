# ADR-0015: Rebuildable SQLite search

- **Status:** Accepted
- **Date:** 2026-11-08
- **Refines:** ADR-0005 and ADR-0014

## Decision

The Node core uses built-in `node:sqlite` with FTS5. The database is
`index.sqlite` in the machine-local profile, never in the portable workspace.
It holds derived documents and cache metadata only. No database server, native
addon, inference service or persisted workspace schema is added.

Index initiative titles/descriptions, node titles/details, entity labels/aliases
and external IDs, source titles and permitted excerpts. Sources with
`cachePolicy: none` contribute no excerpt text. Excerpt matching and returned
`untrustedExcerpt` snippets require explicit `includeExcerpts: true`; default
source search matches titles only. Search syntax is literal Unicode word terms
combined with AND, bound as SQL parameters, not user-supplied FTS/SQL syntax.

`ReadIndex.apply(change)` obtains the current acknowledged snapshot from a
trusted provider. It projects candidate documents and compares their digests,
updating/deleting only changed rows in a SQLite transaction. This avoids a second
implementation of event folding and correctly refreshes indirect source/entity
scope links. Projection is O(workspace records); incremental SQL writes are
limited to changed documents. Full rebuild replaces all derived rows atomically.

Scope filters cover record kinds and initiative memberships. Initiative/node
membership uses their canonical home; source membership follows graph evidence,
assertions/questions and linked objectives; entity membership follows canonical
references. Shared hits are deduplicated and return only matching initiative IDs
when filtered. These are read filters, not completed MCP authorization: P1 still
must enforce trusted client settings before accepting scope/excerpt options.

Opening a missing or stale index rebuilds from folded state. Report actual
completed/total document counts, never an initiative completion metric. The core
launcher emits count-only `index-progress` records before `READY` for a native
launcher to display. SQLite corruption/not-a-database errors preserve the invalid
file before building a new cache. Unsupported cache versions fail search rather
than being silently interpreted. Canonical files are never repaired from SQLite.

Cache publication follows acknowledged domain commits. Cache errors must not
revoke an acknowledged write or prevent ordinary canonical reads. Search fails
with `INDEX_UNAVAILABLE`; `status.index` reports availability/counts. Reopening
rebuilds after deletion. Runtime deletion is reported unavailable until reopen.
Validated external events trigger a complete cache rebuild before subsequent
search. The store's single-profile lock also excludes competing index writers.

## Limits

Tests execute real SQLite, FTS5, core commands and reopen paths on synthetic data.
They do not validate cloud sync, signed standalone packaging, browser/Tauri UI
or hardware performance. Node's SQLite API remains runtime-specific; this does
not select a shipping SEA/Bun runtime or adopt Graphiti. SQLite secure-delete
settings reduce stale cache content, but cache invalid copies, backups and
filesystem snapshots are not a secure-erasure guarantee.
