# Read-only Gmail Activepieces prototype

Run with Node 22 from the repository root:

```sh
cd spikes/s4/gmail-piece
npm ci --ignore-scripts
npm run check
npm test
```

The piece uses the public Activepieces action registry in a standalone Node
process. The synthetic probe intercepts all requests. The package is isolated
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

The prototype returns message references and history records. The
`SourceAdapter` still needs to fetch and normalize message bodies, recheck
label membership and persist progress. Live OAuth, refresh, links and
packaging remain S4 acceptance work.
