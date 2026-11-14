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
This run used the test page in Chrome. Native webview acceptance, runtime
footprint, and selection of the production route remain pending.
