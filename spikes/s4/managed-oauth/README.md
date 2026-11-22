# Dashboard-free Gmail proof

This isolated proof uses Activepieces Community Edition 0.93.0 APIs, not the
Enterprise embedding SDK. It does not change Fulcrum's production connector.
Use only a disposable local runtime and a synthetic-only Gmail mailbox.

## Run

Use supported Node 22.13+ or 24 and the repository's locked dependencies:

```sh
pnpm install --frozen-lockfile
node --test spikes/s4/managed-oauth/*.test.mjs
pnpm exec tsc --project spikes/s4/managed-oauth/tsconfig.json
```

Start a **fresh** disposable Community Edition instance on loopback port
18082, using the image digest in [the experiment report](../../../docs/spikes/S4-results/managed-oauth.md).
Enable `AP_CLOUD_AUTH_ENABLED=true`, disable `AP_TELEMETRY_ENABLED`, use PGLite
and the in-memory queue, and generate local encryption/JWT keys as required
by the official hobbyist procedure. Keep runtime state and credentials outside
the repository. An existing installation with an owner rejects another signup
with `INVITATION_ONLY_SIGN_UP`; this proof does not bypass that restriction.

```sh
node spikes/s4/managed-oauth/server.mjs
```

Open `http://localhost:18081`, click Connect Gmail, choose the synthetic-only
mailbox in Google, then return to the Fulcrum screen. It requests only
`gmail.readonly` and `email` through Activepieces' shared app. Select
`S4 synthetic` and Read test messages. Success requires up to three retrieved
messages with text/HTML, not just message IDs or per-message error records.

No Activepieces dashboard is opened or required. The server provisions a
synthetic local identity/project on first connection, saves the cloud OAuth
connection through the local API, loads labels, creates an unpublished fixed
Find Email flow, tests that step and reads its run output. The browser receives
label names and counts, never API session tokens, refresh tokens or mail bodies.
The Google code passes transiently through the browser callback and local
server. The OAuth service still participates in token exchange/refresh.

## Boundaries

- The server is loopback-only and accepts JSON mutations from its exact origin.
  It exposes three fixed operations, not an arbitrary Activepieces proxy.
- OAuth replies must come from the opened popup and hosted redirect origin.
  Local attempts expire and are single-use. Cancellation/timeout closes the
  popup and removes its listener. A separate pending-operation guard prevents
  overlapping server requests.
- Only `S4 synthetic` is offered, with a fixed three-message limit. No flow is
  published, no trigger is scheduled, and no mail mutation/inference is run.
- Local session credentials are process-memory only. Restarting this proof
  process requires another fresh test instance; persistent first-run ownership,
  reconnect, installation and Keychain custody are production work.
- Activepieces retains test run data locally. Large offloaded results fail
  closed in this proof; pagination, retention and incremental sync are not
  implemented here.
- No license/plan gates are changed. Shared OAuth availability and vendor
  approval for distributing this arrangement are separate adoption questions.

Stop the proof with Ctrl-C. Stop its disposable container separately; retain
its volume if results need inspection. Never commit credentials, mailbox
identifiers, message content, authenticated screenshots or runtime databases.
