# Gmail piece in a local Node process

Gmail is the first integration for personal use. Evaluate direct execution
before considering a separate Activepieces service. Public macOS distribution
and release signing are deferred for this milestone.

## November 11, 2026 probe

Loaded [`@activepieces/piece-gmail@0.18.6`](https://www.npmjs.com/package/@activepieces/piece-gmail/v/0.18.6)
on Intel macOS with Node 22.23.4. The npm archive is 727,437 bytes compressed
and 2,461,743 bytes unpacked. Its manifest lists no external dependencies.
One import-only process peaked at 86,776 KiB RSS versus 28,828 KiB for a
separate empty Node process. This measures neither steady-state memory nor
Fulcrum packaging.

Invoked three registered read actions with a synthetic bearer token and
Nock 14.0.12 intercepting Gmail HTTPS requests. External network access was
disabled in the probe. Each expected request included the bearer token.

| Action | Synthetic response | Observed result |
|---|---|---|
| `gmail_get_profile` | A mailbox history ID | Returned the ID using only auth and action inputs |
| `gmail_list_history` | A history ID and continuation token | Returned the token, but the next invocation could not pass a page token through to Gmail |
| `gmail_search_email` | A label-filtered empty page with a continuation token | Sent the label query and page limit, then discarded the token |

The published OAuth definition requests Gmail send, compose and modify scopes
along with readonly. Fulcrum needs its own readonly desktop consent flow and
must keep token refresh outside the action. Invoking the package directly
accessed the piece's internal action registry. Treat that as spike evidence.

## Next engineering step

The [read-only piece prototype](../../../spikes/s4/gmail-piece/README.md)
adds page tokens for label-filtered backfill and incremental history. It
returns a new history checkpoint only on the final page. A synthetic run
through `SourceAdapter` and the existing SQLite queue resumed after reopening
the queue. Production execution mode remains provisional.

Live OAuth and refresh, history expiry, thread handling, opening originals,
rate limits, macOS packaging and runtime footprint remain open. Step 6's live
acceptance and step 25's production implementation remain pending. The
self-hosted route was not run.
