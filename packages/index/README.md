# Local search (C7)

`SqliteReadIndex` implements the public `ReadIndex` interface with Node 22's
built-in SQLite/FTS5. It owns no domain state and performs no canonical writes.
The core composition root supplies a validated, acknowledged snapshot provider
and holds the shared profile lock. UI code imports only domain query types.

```ts
const index = await SqliteReadIndex.open({
  localDirectory,
  workspaceDirectory,
  getSnapshot: () => domain.getSnapshot(),
  onProgress: ({ phase, completed, total }) => showCounts(phase, completed, total),
});
await index.apply(appliedChange);
const hits = await index.search('vendor review', { kinds: ['node'] });
```

The local directory must already exist and must be machine-local, outside the
workspace. Symlinked directories/files and hard-linked database files are
refused. The production core uses its fixed Application Support profile. The
driver does not infer whether an arbitrary caller-provided directory is synced.

The database contains only derived documents: initiatives, nodes, entities and
source titles/permitted excerpts, with initiative membership and digests. No
credentials, canonical event authority or model data is stored there. Source
`excerpt` fields are indexed only under `cachePolicy: excerpt`. Search matches
source excerpt text and returns a wrapped `untrustedExcerpt` only when
`includeExcerpts: true`; title-only source search is the default.

Queries use literal Unicode word terms combined with AND. Operators, SQL and FTS
column syntax are not accepted as instructions. Bounds: 500 characters, 32 terms,
30 results by default, at most 100. Optional `initiativeIds`, `kinds` and `limit`
filters are parameterized. Empty scopes return no results. These options are not
an external-client authorization policy; MCP remains P1 work.

A full rebuild replaces documents in one transaction. Incremental application
projects the current acknowledged snapshot and changes only differing/deleted
rows, including indirect scope-link changes. Replaying an old notification cannot
reapply stale event values. Missing/stale caches rebuild on open with count-only
progress; observer failures cannot abort publication. SQLite corruption errors
preserve the old file as `index.sqlite.invalid` (or a unique suffix if occupied).
Invalid copies can contain prior excerpts; they remain private local diagnostics,
not part of the portable workspace. No secure-erasure guarantee is made.

`status()` reports `rebuilding`, `ready` or `unavailable`, with document counts.
The core exposes this through `Domain.query('status.index', {})`, and search
through `Domain.query('search', {text, scope?})`. Index failure leaves acknowledged
commands and canonical reads available; search returns `INDEX_UNAVAILABLE`.
After runtime deletion, close/reopen the core to rebuild. Close before deleting
cache files. Normal clients cannot select paths or database settings through RPC.

Run `pnpm check`. Tests use actual SQLite/FTS5, canonical synthetic fixtures,
incremental changes, source privacy, scope filtering, corrupt/deleted cache
recovery and core command/reopen integration. No new model or hardware acceptance
is claimed. [ADR-0015](../../docs/decisions/0015-local-search-cache.md) records the
tradeoffs. SQLite's [FTS5 documentation](https://www.sqlite.org/fts5.html) describes
the external-content table, triggers and secure-delete option used by the driver.
