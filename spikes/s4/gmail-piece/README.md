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
See the [live OAuth and sync results](../../../docs/spikes/S4-results/gmail-desktop.md)
and the [Gmail decision](../../../docs/decisions/0027-gmail-piece-execution.md).
Production packaging and links remain open.

## Desktop test build

A developer prepares the Google project once. Enable the Gmail API, set the
OAuth audience to External → Testing, and add the throwaway Gmail account.
Create a **Desktop app** OAuth client and download its JSON configuration
outside the checkout. [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
describes the client and loopback flow.

Install the root and probe dependencies with Node 22 LTS. To launch the native
window, also install Rust/Cargo and Xcode Command Line Tools. From the root:

```sh
pnpm install --frozen-lockfile
npm --prefix spikes/s4/gmail-piece ci --ignore-scripts
read -r 'FULCRUM_GMAIL_TEST_CLIENT_FILE?Path to Desktop OAuth client JSON: '
read -r 'FULCRUM_GMAIL_TEST_ACCOUNT?Throwaway Gmail address: '
export FULCRUM_GMAIL_TEST_CLIENT_FILE FULCRUM_GMAIL_TEST_ACCOUNT
node --experimental-transform-types tools/dev-shell.mjs
```

In a second Terminal at the root:

```sh
pnpm --filter @fulcrum/desktop tauri dev --config '{"build":{"beforeDevCommand":null},"plugins":{"updater":{"pubkey":""}}}'
```

The window opens directly to the test. Use two plain-text synthetic messages
received in the last 14 days. Apply a test label to the first one.

1. Click **Connect Gmail**, sign in with the designated account, and grant the
   read-only scope. Return to Fulcrum and choose the test label.
2. Click **Run backfill**. Confirm the count is one.
3. Apply the same label to the second message in Gmail. Click **Check for new
   mail** and confirm the incremental count is one.
4. Record pass/fail and counts only in `docs/spikes/S4-results/`. Stop the dev
   server to discard the in-memory OAuth grant and disposable local queue.

This build uses the same adapter and queue as the CLI probe. The browser
callback uses PKCE and binds to loopback. The grant stays in the test process
and is refreshed before each scan. Only label names and IDs and the scan
counts reach the window. Google grants mailbox-wide read access, so use a
throwaway account. Testing-mode authorization expires after seven days.
The test does not open a Fulcrum workspace or exercise production credential
persistence. For a browser preview of the same UI, open
`http://127.0.0.1:5173` on the Mac running the dev server.

## Optional CLI live probe

Use the [S4 Gmail setup](../README.md#gmail-native-api-probe) to prepare a
throwaway account, enable the Gmail API, and obtain a refresh token limited to
`gmail.readonly`. For this probe, prepare two recent synthetic messages with
plain-text bodies and apply the test label to only the first one. The command
will prompt you to label the second message after the first scan.

Run in zsh from this directory after `npm ci --ignore-scripts`:

```sh
(
  export S4_SYNTHETIC_ONLY=yes
  read -r 'GMAIL_TEST_LABEL?Gmail test label ID: '
  read -rs 'GMAIL_TEST_CLIENT_ID?Test OAuth client ID: '; print
  read -rs 'GMAIL_TEST_CLIENT_SECRET?Test OAuth client secret: '; print
  read -rs 'GMAIL_TEST_REFRESH_TOKEN?Test refresh token: '; print
  export GMAIL_TEST_LABEL GMAIL_TEST_CLIENT_ID GMAIL_TEST_CLIENT_SECRET GMAIL_TEST_REFRESH_TOKEN
  node --experimental-transform-types live.mjs
)
```

The probe refreshes credentials before each scan, closes and reopens the
disposable SQLite queue, and prints page and message counts. Each scan allows
at most ten pages. An expired history cursor fails the probe so a recovery
backfill cannot be mistaken for an incremental read. Record the counts and
outcome in a reviewed S4 results PR.
