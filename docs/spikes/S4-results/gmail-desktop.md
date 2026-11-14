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

## Local footprint

Measured on Intel macOS 15.7.9 with Node 23.11.0.

| Measurement | Result |
| --- | ---: |
| Existing live test server at idle, median of 30 RSS samples | 178,376 KiB (174.2 MiB) |
| Isolated probe with mocked Gmail responses, RSS after import | 226,942,976 bytes (216.4 MiB) |
| Same isolated probe, process peak RSS over backfill and incremental sync | 238,411,776 bytes (227.4 MiB) |
| SQLite queue after two synthetic messages and close | 28,672 bytes (28 KiB) |
| Installed spike dependencies, including development tools | 52,720 KiB (51.5 MiB) |
| Installed Activepieces framework directory alone | 1,048 KiB (1.0 MiB) |
| Native debug test app bundle | 41,240 KiB (40.3 MiB) |

Idle RSS includes the development server. Peak RSS comes from a separate
Node process running the real probe and SQLite queue against mocked provider
responses. Disk sizes use allocated space. The two memory measurements have
different process boundaries. The live backfill retry failed before returning
a result and a reconnect prompted for Google consent. Live peak RSS and the
self-hosted runtime comparison remain pending.
