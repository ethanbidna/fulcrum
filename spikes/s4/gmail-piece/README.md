# Read-only Gmail Activepieces prototype

Run with Node 22 from the repository root:

```sh
cd spikes/s4/gmail-piece
npm ci --ignore-scripts
npm run check
npm test
```

The adapter uses the public Activepieces action registry in a standalone Node
process and implements Fulcrum's `SourceAdapter` interface. The synthetic probe intercepts all requests. The package is isolated
from Fulcrum's app and workspace dependency graph.

1. Use `get_history_anchor` before backfill.
2. Call `list_backfill_page` with the selected label, fixed start and end
   times, and a page size of 1–50. Keep those inputs fixed when following
   `nextPageToken`. Continue through empty pages if a token is present.
3. After backfill, pass the original anchor to `list_history_page`. Keep the
   anchor and label fixed until the last page. Persist the new checkpoint only
   after processing that page. A `gmail_history_expired` error calls for a new
   bounded backfill, starting with a fresh anchor.

See the [Gmail message list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
and [history list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
contracts for page tokens and history IDs.

The piece declares `gmail.readonly`, which grants mailbox-wide read access at
Google. Requests apply the selected label in Fulcrum. The host supplies a
short-lived access token and owns consent, refresh, scope selection, page
budgets and cursor persistence. Keep continuation state bound to the same
account and label.

The adapter uses Fulcrum's existing scheduler and machine-local SQLite queue.
The synthetic restart probe verifies that the queue retains the original
backfill window and page token. The queue stores references, hashes and
cursors. It keeps message text in memory only.

The message action checks the label with a minimal request before retrieving
the full message and checks the label again on the response. Normalization
uses inline plain text with a snippet fallback for HTML-only messages or
attachment-backed bodies. It skips attachments and has no open-original URL.
History batches are processed in groups of up to five messages, with the
remaining IDs kept in the continuation until the page is complete.

The injected access-token provider must stay bound to the same account as its
opaque local account key. This spike runs without production desktop setup.
Live OAuth, refresh, links, packaging and the production execution decision
remain pending.
