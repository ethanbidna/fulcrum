# Live Gmail desktop test

On November 13, 2026, the Fulcrum test page connected to a designated Gmail
account using Google's desktop OAuth flow in Chrome. Google required the
account to be on the test-user list and the Gmail API to be enabled in the
test project. The account granted read-only Gmail access.

| Check | Observed result |
| --- | --- |
| Label selection | Fulcrum showed the custom synthetic label after reconnecting. |
| Backfill | 1 message across 1 page. |
| Incremental sync after labeling a second message | 1 message across 1 page from the saved checkpoint. |

Each scan succeeded using the probe path that refreshes the access token
before scanning. The incremental scan reopened the disposable SQLite queue.
The OAuth and sync run above used the test page in Chrome.

An owner screenshot of the native **Fulcrum Gmail Test** macOS window shows
the synthetic label selected, with 1 message across 1 page reported for
backfill and 1 message across 1 page reported for incremental sync. This
confirms the native window displayed successful results for both scans.
The owner also confirmed that reconnecting from the native window opened
Google consent in Chrome and that the synthetic label appeared after
returning to Fulcrum. Runtime footprint and selection of the production
route remain pending.
