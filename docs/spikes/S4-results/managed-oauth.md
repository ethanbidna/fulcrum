# S4: Hosted OAuth with a local Activepieces runtime

Experiment started November 21, 2026. See [ADR-0029](../../decisions/0029-managed-connector-oauth-spike.md).
This is a separate test from the existing direct-piece Gmail implementation.

## Question

Can another app manage Gmail sign-in and retrieval without requiring a
Fulcrum-owned or user-created Google OAuth client, while connector execution
stays local and Gmail access remains read-only?

## Verified so far

- The live `https://secrets.activepieces.com/apps?edition=ce` catalog returned
  Gmail and Slack entries. The public catalog is not proof of working consent
  or distribution permission.
- Activepieces 0.93.0 source at commit
  `dec8e16d4e02ee1fe9a5cdfb1a30c7a03785401b` offers a Permissions selector
  when a piece declares multiple OAuth scopes. Its authorization endpoint
  accepts a nonempty subset of the piece's declared scopes.
- The same source sends authorization-code claims and refresh requests to
  `secrets.activepieces.com`; it does not route email-body reads through that
  service in those methods. This is source inspection, not a traffic audit.
- A separate Lima 2.3.0 VM booted on Intel macOS with two CPUs, 4 GiB RAM,
  20 GiB sparse disk and no shared host folders. Docker reports 29.10.0.
- The previously reviewed 0.93.0 image was pulled successfully at digest
  `sha256:6ed79f941fd41a8ab03ca659581191210a66512de52f7d623817f88deb715db7`.
  Its local container started with PGLite, an in-memory queue, one worker,
  hosted OAuth enabled and telemetry disabled. No model is part of this test.
- The local UI and flags endpoints returned HTTP 200. Flags reported version
  0.93.0, edition `ce`, and `CLOUD_AUTH_ENABLED: true`. The browser displayed
  local account creation rather than asking for a Google client ID/secret.
- One startup `docker stats` sample reported 1.666 GiB container memory and
  123.47% CPU. This is not an idle measurement and excludes the VM overhead.

## Evidence links

- [Hosted OAuth configuration](https://www.activepieces.com/docs/install/reference/environment-variables)
- [OAuth service source](https://github.com/activepieces/activepieces/blob/dec8e16d4e02ee1fe9a5cdfb1a30c7a03785401b/packages/server/api/src/app/app-connection/app-connection-service/oauth2/services/cloud-oauth2-service.ts)
- [Permission selector](https://github.com/activepieces/activepieces/blob/dec8e16d4e02ee1fe9a5cdfb1a30c7a03785401b/packages/web/src/app/connections/oauth2-connection-settings.tsx)

## Live checks

Pending: local account creation, Gmail read-only consent through the shared app,
credential refresh, bounded synthetic retrieval, restart, incremental
catch-up, memory, and separate retrieval/extraction timing. No successful
Gmail connection or processing-speed improvement is claimed yet.

Use only a throwaway mailbox containing synthetic messages. Keep accounts,
tokens, execution payloads and local runtime data out of the repository.
The stock piece declares send/compose/modify scopes too; deselect them before
opening consent. Stop if the actual grant requires write access.

### Resume this local test

1. Open `http://localhost:18080` on the test Mac. Create a local admin with
   `s4-reader@example.invalid` and a new password entered by the owner; leave
   newsletters unchecked. This is an account in the disposable local runtime,
   not an Activepieces Cloud signup. Never paste the password in chat.
2. Open Connections and add Gmail using the default OAuth method, not Custom
   OAuth2 App or Service Account. Expand Permissions and retain
   `https://www.googleapis.com/auth/gmail.readonly` and `email`; deselect send,
   compose and modify. Inspect the generated authorization request and the
   actual Google consent screen before granting anything.
3. The owner signs in with the synthetic-only Google test account and approves
   the displayed read-only access. Stop if Google blocks the shared app,
   requires a custom client, or requests mail mutation permissions.
4. Run only a manually triggered bounded read flow against the synthetic label.
   Verify a small page's counts, restart persistence, another bounded page,
   refresh and incremental catch-up separately. Do not enable send/draft/label
   actions, public webhooks, full mailbox backfill or model processing.
5. Record counts, permission names, durations and failures here. Do not copy
   account identifiers, credentials, message bodies, execution payloads or
   authenticated screenshots into the repository.

The loopback service is a temporary experiment, not installed into Fulcrum.
The owner must complete account creation/consent before live retrieval can be
tested. At the first handoff Chrome automation was blocked by another
extension's open UI; the service itself remained reachable.

## Recommendation

Pending live results. Keep the production Gmail PRs and existing owner
acceptance checks unchanged while testing this alternative.
