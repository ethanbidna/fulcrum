# Ingestion scheduler

`IngestionScheduler` depends on driver interfaces, not files or network APIs.
Scope opt-in is explicit through `configure`; no scope is enabled by discovery.
Every tick checks the current designated device before calls and after awaited
results. Manual editing remains available on viewer devices.

One tick runs at a time. Scans use a 14-day bound, pages of 50, at most 20 pages
per scope/tick, a 60-second request deadline and bounded exponential retries.
Incomplete scans resume from committed continuations. Healthy scopes continue
when another source fails. Ready items run newest-first, including within each
thread. Relevance uses trusted user identity, title/alias terms, linked threads,
commitment phrases and author exclusions; source text never selects commands.

The durable queue holds references, not full text. A future extraction consumer
rehydrates text, receives an abort signal and a stable connector/remote-id/hash
idempotency key, and must use that key for its Domain writes. Delivery is at
least once across a crash between processing and receipt acknowledgement.
Successful receipts and canonical source hashes suppress duplicate work.
Failed items remain explicit; they are not silently retried or called current.
Model extraction, contextual thread batching, canonical source recording and
reconciliation are subsequent steps, not a dummy implementation here.

`status()` reports counts and last fully checked time. Pending work without an
extraction consumer says Local AI unavailable, never Up to date. A paused,
viewer, failed or incomplete scan cannot report current. The core exposes this
as `status.freshness`; Settings/source controls and native sleep/resource signals
are later steps. This step does not replace the portfolio's existing unknown
freshness indicator with unvalidated per-initiative freshness.

The composition root accepts optional `WorkspaceOptions.ingestion` with adapters,
explicit scopes and an optional trusted processing callback. No configuration
means no queue, timer, connector or inference. With configuration the existing
core runs a background timer; no additional service is introduced. Close cancels
active requests before closing the local queue and workspace.
