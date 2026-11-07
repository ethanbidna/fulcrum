# S4 throwaway-account probes

Read [the capability matrix](../../docs/spikes/S4.md) first. These are read-only
diagnostic probes, not production `SourceAdapter`s. No connected Codex account
is used. No send, draft, label mutation, channel creation or domain command is
implemented. Create the fake source content yourself in the vendor UIs.

Do the live account tests and resource measurements **after S2 finishes**.
Running Docker or installing large packages now would distort the model run.

## Local preparation

From the repository root on branch `plan/step-6-connector-matrix` (or `main`
after merge), install Node 22 LTS, then:

```sh
npm ci
npm test
```

If C1/PR #37 has merged, use `corepack enable` and
`pnpm install --frozen-lockfile` instead of `npm ci`. The probes add no npm
dependencies. Use zsh for the `read` commands below; secret values do not enter
shell history. Never use a real workspace/mailbox or paste tokens in chat.

## Slack native API probe

1. Create a throwaway Slack workspace. In its UI create a public channel named
   `s4-synthetic`, post at least 35 fake messages such as `Cedar sample 01`,
   and put two fake replies under an early parent. Include one fake user
   promise, one colleague promise, and one instruction attack as ordinary text.
   Repeat later in a fake private channel and a DM with a test participant if
   available. Never use a real teammate's DM as a substitute.
2. Visit [Slack app management](https://api.slack.com/apps), Create New App →
   From scratch, choose the fake workspace and name it `S4 synthetic reader`.
   Under OAuth & Permissions, add only the **User Token Scopes** needed for
   the conversation: `channels:history` for the public channel; add
   `groups:history`, `im:history`, `mpim:history` only for corresponding tests.
   Request installation/admin approval if required, then install to the fake
   workspace. Record approval friction without copying workspace/app IDs.
3. Obtain the selected channel ID from its details and the parent thread's
   exact `ts` from its copied message link (or Slack API tester). Preserve the
   decimal string; do not convert it to floating point. In the same Terminal:

   ```sh
   export S4_SYNTHETIC_ONLY=yes
   read -rs 'SLACK_TEST_TOKEN?Paste the fake-workspace user token: '
   export SLACK_TEST_TOKEN
   read -r 'SLACK_TEST_CHANNEL?Paste the selected fake channel ID: '
   export SLACK_TEST_CHANNEL
   read -r 'SLACK_TEST_THREAD_TS?Paste the parent timestamp, or leave empty: '
   export SLACK_TEST_THREAD_TS
   node spikes/s4/cli.mjs slack backfill
   node spikes/s4/cli.mjs slack resume
   ```

   Each call reads at most two pages of history and two pages of **one**
   selected thread, 15 objects per page, plus one permalink. This is not a
   full workspace/thread crawler. If the report says incomplete, repeat
   `resume`. A `no_pending_page` result means that sampled window is exhausted.
   Use `backfill` to start a new window. Old-parent replies, edits and deletions
   need a production strategy beyond this probe; do not mark those validated.
4. Inspect count-only `spikes/s4/out/slack-backfill.json` and `slack-resume.json`.
   In local `slack-state.json`, open `permalink` manually and confirm it lands
   on the intended reply/message. Do not commit state or URLs/IDs. Repeat with
   selected private/DM IDs and record any token/membership restrictions.
5. If rate limited, wait at least the printed Retry-After seconds, then repeat.
   The probe does not sleep/retry in a loop. Record current app classification
   and whether the console/docs and observed limit agree. A revoked/expired
   token should produce a safe reconnect/auth code without source content.
   Slack token rotation is **not implemented** here: test the app's rotation
   flow separately using the linked official guide, or record it not run.

## Gmail native API probe

1. Create a throwaway Google account containing only fake mail. Create a Gmail
   label named `S4 synthetic`. Manually populate it with at least 35 fake
   messages, including a multi-message conversation, and leave one unrelated
   fake message outside the label. Sending your synthetic setup messages is
   an owner action; the probe cannot send or change mail.
2. In [Google Cloud Console](https://console.cloud.google.com/), create a test
   project, enable Gmail API, configure Google Auth Platform branding/audience
   for External → Testing, add only the throwaway account as a test user, and
   request `https://www.googleapis.com/auth/gmail.readonly`.
3. For this manual alpha, create a **Web application** OAuth client with the
   exact authorized redirect `https://developers.google.com/oauthplayground`.
   Open [Google's OAuth Playground](https://developers.google.com/oauthplayground/),
   use its settings to select your own OAuth credentials, enter that test
   client ID/secret, select the readonly scope, authorize only the throwaway
   account, then exchange the authorization code for tokens. Request offline
   access for refresh testing. Do not share or commit the Playground output.
   This Google-hosted manual helper is not the product auth implementation:
   production needs a Desktop client, PKCE and system-browser loopback flow.
4. Use the Gmail API explorer for `users.labels.list` with the same fake account
   to obtain the label's ID (the API ID differs from its display name). Then:

   ```sh
   read -rs 'GMAIL_TEST_ACCESS_TOKEN?Paste the test access token: '
   export GMAIL_TEST_ACCESS_TOKEN
   read -r 'GMAIL_TEST_LABEL?Paste the fake label ID: '
   export GMAIL_TEST_LABEL
   export S4_SYNTHETIC_ONLY=yes
   node spikes/s4/cli.mjs gmail backfill
   node spikes/s4/cli.mjs gmail resume
   ```

   Repeat `resume` while the report says incomplete. A fresh `backfill`
   replaces local continuation state; do not do that halfway through a window.
   The probe reads only selected-label full messages, then samples one thread
   in minimal format. It does not expand full off-label thread bodies.
5. To exercise Google refresh, enter credentials in the same Terminal:

   ```sh
   read -rs 'GMAIL_TEST_CLIENT_ID?Paste the test OAuth client ID: '
   export GMAIL_TEST_CLIENT_ID
   read -rs 'GMAIL_TEST_CLIENT_SECRET?Paste the test OAuth client secret: '
   export GMAIL_TEST_CLIENT_SECRET
   read -rs 'GMAIL_TEST_REFRESH_TOKEN?Paste the test refresh token: '
   export GMAIL_TEST_REFRESH_TOKEN
   node spikes/s4/cli.mjs gmail incremental
   ```

   The refresh token takes precedence over the access token. Add/change a fake
   labeled message in Gmail and repeat incremental; confirm nonzero history
   records. The probe lists history, not a complete event-to-source reconciler.
   It advances historyId only after the final history page; use `resume` if
   `historyComplete` is false. Expired history produces `history_expired`;
   record that event, then run bounded `backfill`, never skip the gap.
6. Gmail reports `messagePermalink: null`: no exact web link is fabricated.
   Test an open-original/search fallback manually and record the achieved
   precision; leave exact-message linking blocked if it cannot be verified.
   Record actual quota limits, consent/admin restrictions and the seven-day
   testing refresh-token lifecycle. Revoking access should produce a safe
   auth/refresh failure, not a raw token or mailbox error dump.

Changing accounts or scopes requires starting a fresh backfill. Continuation
state is machine-local and must never move between accounts or into a workspace.

## Activepieces comparisons

These are optional isolated experiments until the deployment decision. They
do not authorize adding a runtime/database to Fulcrum. Use only the fake accounts.

For **pieces as libraries**, record the upstream commit/package versions,
license and full dependency graph. Follow the official piece development setup
in a separate scratch checkout. Invoke only the reviewed read actions with a
fake-token context; account for auth/store/files helpers and SDKs. Repeat the
same page/thread/refresh checks above. Record import/setup failures and whether
an action exposes continuation. Do not invoke the default broad auth flow on a
real account. The reviewed actions are source evidence, not a supported
standalone-library contract; no package execution is claimed by this PR.

For the **self-hosted runtime**, after S2, install Docker Desktop if desired and
follow the official [hobbyist procedure](https://www.activepieces.com/docs/install/options/docker)
using a selected release image pinned by digest. Bind the web UI to loopback:

```sh
read -r 'S4_AP_IMAGE?Paste a reviewed activepieces/activepieces release image@sha256 digest: '
export S4_AP_IMAGE
docker run --name s4-activepieces --detach --publish 127.0.0.1:8080:80 \
  --volume s4-activepieces-data:/root/.activepieces \
  --env AP_DB_TYPE=PGLITE --env AP_REDIS_TYPE=MEMORY \
  --env AP_FRONTEND_URL=http://localhost:8080 \
  --env AP_TELEMETRY_ENABLED=false "$S4_AP_IMAGE"
```

Open localhost:8080, create a local admin, confirm analytics are disabled in
settings, and use your own OAuth apps for the fake connections. If custom OAuth
is unavailable/gated in that edition, record a blocker rather than using a
shared hosted OAuth relay. Build only manually triggered read-action flows;
leave Slack APP_WEBHOOK triggers untested unless a separately authorized public
callback is available. Do not expose a tunnel by default. Compare the same
source × operation cases and inspect execution outputs locally; publish counts
and pass/fail notes only.

After idle warmup, and again during a bounded read flow, record:

```sh
docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' s4-activepieces
docker image inspect --format '{{.Size}}' "$S4_AP_IMAGE"
docker container inspect --size --format '{{.SizeRw}}' s4-activepieces
```

Also measure the named data volume and the Docker Desktop VM overhead; container
RSS/writable-layer size alone omits both. Record method, idle/load state and
bytes separately. For a production Compose comparison, include PostgreSQL and
Redis costs and any install/maintenance friction. Do not mix that deployment
with the hobbyist row without identifying it. Stop the test container afterward:

```sh
docker stop s4-activepieces
```

## Publish findings

The probe writes count-only reports and separate continuation state under
ignored `spikes/s4/out/`. It never persists credentials or source bodies. Review
even count-only reports before copying them: retain versions, durations, counts,
capability flags and byte measurements; exclude IDs, tokens, addresses, paths
and all continuation files. Results overwrite per provider/mode; copy reviewed
reports under distinct test-case names if comparing multiple scopes.

Commit reviewed reports to `docs/spikes/S4-results/`, fill all six rows in
`docs/spikes/S4.md` with results or explicit not-run reasons, and open a PR
referencing #4. Record native process peak RSS from the report separately from
package disk size and complete runtime footprint. Record network/install time
and non-technical friction, not invented benchmark numbers. Finish by ticking
the Owner box for step 6 in `backlog/PROGRESS.md`.

Unset tokens/credentials when finished and revoke the test apps if no longer
needed. Keep all credentials in environment variables during these probes;
production credentials belong in Keychain, not a synced workspace or repository.
