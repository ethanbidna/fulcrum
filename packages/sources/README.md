# Source drivers

`SourceAdapter` provides opted-in scope discovery, bounded incremental pages,
rehydration by source reference and original links. Calls must honor the supplied
AbortSignal. A completed scan returns an incremental `checkpoint`; `next` is only
a continuation within that scan. Adapters must keep pagination stable across
restarts and return items newest-first within each thread.

`SyntheticSourceAdapter` emits seven days of invented Vendor evaluation updates;
it needs no account, network, credentials or model.

`SqliteIngestionQueue.open` requires an existing machine-local directory outside
the workspace. SQLite transactions atomically retain references/hashes and page
positions. The queue stores no message text, author names, credentials or links.
It retains successful/ignored hash receipts; changed text queues a new version.
Full text is fetched again at processing time and a changed/missing source fails
closed. Queue files are private, versioned and bound to one workspace identity.
Corruption fails closed; it is never silently replaced with an empty queue.
