# Managed source connections

This is the handoff record for the owner's request to replace custom OAuth
registration with managed connections, keep the Activepieces dashboard out of
ordinary use, ship the experience in Fulcrum, and cover all six sources.

## Evidence and implementation status

| Part | Status |
|---|---|
| Shared Gmail OAuth, local read and container restart | Observed with synthetic test mail on November 21 |
| Fulcrum-owned browser screen, no Activepieces dashboard | Observed; three synthetic messages read |
| Reusable six-source connection driver | Implemented; synthetic API tests |
| Shared catalog presence for five OAuth sources | Observed November 24; not live sign-in |
| Granola API-key connection request | Synthetic API test only |
| Native Keychain and core administration | Implemented; synthetic runtime and substituted Security calls |
| Browser callback, source settings and runtime installation | Pending |
| Updated launched macOS app | Pending |
| Managed automatic ingestion | Blocked by full-body run-log retention |

Driver review: [PR #107](https://github.com/ethanbidna/fulcrum/pull/107), stacked
on the dashboard-free proof in #106.

The [S4 report](../spikes/S4-results/managed-oauth.md) retains the original
versions, image digest, runtime setup, browser proof, failures, timings and
limits. [ADR-0029](../decisions/0029-managed-connector-oauth-spike.md) authorizes
the experiment; [ADR-0030](../decisions/0030-managed-connection-driver.md)
defines the connection driver and adoption gates. Neither adopts automatic
managed ingestion.

The earlier temporary VM, integration checkout and preview-build artifacts
were absent when work resumed on November 24. Committed proof code and evidence
were recovered from Git. An old successful run is not a currently running
service. No account credentials, VM volume or local-only runtime identity were
recovered from the public repository.

## Owner's required experience

- Sources are Gmail, Slack, Granola, Google Drive, Dropbox and Google Calendar.
- Start and finish in Fulcrum. Open only the vendor's sign-in/consent and a
  short-lived Fulcrum browser helper when needed for the hosted callback.
- Activepieces identification on consent is acceptable. Its dashboard, signup
  form, flow builder and credentials controls must not appear to ordinary users.
- No Google developer registration as an ordinary setup step.
- Show connection, scope selection, verification and ingestion as distinct
  states. Do not label a saved connection as syncing.
- Explain hosted token exchange/refresh and provider-wide permission separately
  from the labels, channels, folders or calendars Fulcrum will ingest.

## Source policy

| Source | Piece version | Authentication | Requested permissions / selection |
|---|---|---|---|
| Gmail | 0.19.0 | Shared OAuth | `gmail.readonly`, `email`; select labels afterward |
| Slack | 0.23.1 | Shared OAuth | `channels:read`, `channels:history`, `users:read`, `users:read.email`; public bot-accessible channels only |
| Granola | 0.1.3 | API key | Provider-defined key permissions; select supported note scopes afterward |
| Google Drive | 0.13.3 | Shared OAuth | `drive.readonly`, `email`; select folders afterward |
| Dropbox | 0.10.2 | Shared OAuth | `files.metadata.read`, `files.content.read`; select folders afterward |
| Google Calendar | 0.13.4 | Shared OAuth | `calendar.readonly`, `email`; select calendars afterward |

Google scope names above abbreviate `https://www.googleapis.com/auth/…`.
The versions are deliberate pins, not a promise that the runtime has installed
them. Gmail 0.19.0 is the previously tested runtime piece. The remaining pins
come from the official Activepieces 0.93.0 source tree. Verify installed metadata
and the actual granted permissions before enabling reads.

On November 24 the CE shared-app catalog returned entries for Gmail, Slack,
Google Drive, Dropbox and Google Calendar, and none for Granola. A first request
with Python's default user agent returned HTTP 403; a named application user
agent returned HTTP 200. Treat availability failures as errors, never as a
reason to substitute a Fulcrum Google client silently.

Granola's supported API requires eligible account/admin access. No private local
cache scraping. CSV remains the separately documented fallback through the
Activepieces integration boundary when API access is unavailable. The stock
notes action has a pagination gap: its output cursor has no matching cursor
input. Resolve this before promising resumable historical ingestion.

The Slack stock auth definition embeds broad user grants in its URL in addition
to its bot scopes. Replacing only `scope` leaves those grants. The new driver
removes every `user_scope` parameter. Private channels and DMs need a separately
reviewed policy, not an automatic broadening. Stock channel-history actions can
fetch all pages; they are not a bounded ingestion implementation.

## Driver boundary

`packages/sources/src/managed/` provides the connection driver through the
sources package's public API. Composition supplies an owned loopback origin,
a stable machine-local connection namespace, and a native secure-store
implementation. The driver does not inspect or mutate canonical workspace
records.

The driver's local identity is saved before provisioning, restored on restart,
and bound to the runtime origin. Tokens stay in memory. Disconnect checks connection ID, source, project,
namespace and project scope before deletion; it also cancels pending sign-in. Authorization attempts
are expiring, single-use and cancellable. Request bodies and upstream errors
must not be logged by callers. Provider secrets are discarded from returned
connection data. Runtime and catalog responses are size bounded; redirects are
rejected. There is no general action runner or arbitrary destination parameter.

A receipt has `ingestion: blocked`. It proves only that the pinned API returned
an active connection for the expected piece/external ID. It does not attest
that Google removed previously granted permissions or that any source items
were read. The driver must not be exposed directly to untrusted source content.

## Desktop work still required

1. Own and package the local runtime; preserve its database/encryption keys
   outside the synced workspace. Disable telemetry. Validate startup, shutdown,
   idle memory and upgrade/recovery without requiring Terminal from users.
2. The secure-store interface is implemented with the native Keychain helper.
   Verify actual Keychain approval/denial with the packaged app. Keep connector
   secrets out of preferences, diagnostics and workspace logs. Existing direct
   Gmail credentials remain separate until explicit replacement/disconnect.
3. Administration methods are bound to the driver. Add a temporary loopback browser
   helper for hosted popup replies, checking exact origin, popup, nonce, timeout
   and request origin. Close the listener and popup on every terminal path.
4. Add all six settings/onboarding rows, accurate blocked/unavailable states,
   scope controls, cancellation, retry and disconnect. Add component stories
   and keyboard checks. Never open an Activepieces dashboard URL.
5. Verify actual consent/granted scopes with synthetic accounts, including
   rejected/wider grants. Inspect Granola API access separately from OAuth.
6. Resolve payload retention, then connect bounded read operations to the
   existing ingestion scheduler and reconciliation pipeline.
7. Build and launch the macOS preview, exercise restart and secure-store denial,
   and record the actual artifact/version. Do not report an updated app before
   this runs.

## Retention gate

Fulcrum keeps full source text transient, with pointers or capped excerpts as
chosen by cache policy. Stock Activepieces flow-run output persists full source
payloads. MCP `ap_run_action` also records its inputs/outputs in activity files.
Neither is an acceptable production body-reading path under the current
contract. Local execution, a short retention period, or deleting files afterward
does not establish that full bodies were never persisted.

Keep automatic managed ingestion disabled until a tested execution boundary
satisfies the contract. Scope discovery itself must be inspected for sensitive
payload logging; connection validation is not blanket approval for every piece
option or test action. Any contract change requires a product change and ADR.

## Verification

November 24: 48 focused tests cover the six policy definitions, five OAuth
connection exchanges, Slack user-scope removal, Granola key handling, local
identity save/restart/recovery, concurrent initialization, expired-session retry,
cancelled/superseded/expired attempts, failed saves, ownership-checked disconnect, absent shared apps, inactive
connections, origin restrictions and response limits. A PKCE contract test first
failed for all five OAuth sources; the request was corrected to the pinned API's
`code_challenge` field carrying its returned verifier.

These are synthetic API tests. The November 21 Gmail browser proof remains the
only live dashboard-free sign-in/read evidence. No other provider consent,
Keychain integration, production read, native installation or packaged managed
connector behavior is claimed from these tests.

## Primary references

- [Pinned connection request contract](https://github.com/activepieces/activepieces/blob/0.93.0/packages/core/shared/src/lib/automation/app-connection/dto/upsert-app-connection-request.ts)
- [Pinned Slack authentication](https://github.com/activepieces/activepieces/blob/0.93.0/packages/pieces/community/slack/src/lib/auth.ts)
- [Pinned Drive authentication](https://github.com/activepieces/activepieces/blob/0.93.0/packages/pieces/community/google-drive/src/lib/auth.ts)
- [Pinned Dropbox authentication](https://github.com/activepieces/activepieces/blob/0.93.0/packages/pieces/community/dropbox/src/lib/auth.ts)
- [Pinned Calendar authentication](https://github.com/activepieces/activepieces/blob/0.93.0/packages/pieces/community/google-calendar/src/lib/auth.ts)
- [Granola supported API](https://docs.granola.ai/help-center/sharing/integrations/granola-api)

The isolated review branch passes typecheck, lint and all 48 focused tests.
The supported Node 22 reference run passes 116 tests, with one existing skip
and one TODO. The broader combined-integration run passes 647 tests, skips
one, and times out in the existing encrypted-core composition test at its
five-second limit. The full workspace suite is not reported as green.

The encryption suite passes independently on the review branch (10 tests)
with a 15-second per-test timeout. This diagnoses the local timing limit; it
does not turn the default-timeout full-suite run into a pass.


## Native core continuation — November 24

The core now composes the connection driver when an owned runtime configuration
and the native credential helper are supplied. Missing or unsafe configuration
leaves all six sources unavailable and the workspace usable. This unit does not
install a runtime, expose setup in Settings or rebuild the launched app.

The runtime owner will write private `managed-runtime.json` containing only an
IPv4 loopback origin. There is no administration method for choosing an arbitrary
server. The file is a composition seam for the installer, not an ordinary-user
setup instruction. Runtime ownership and encryption-key/volume recovery still
need the installation unit.

One Keychain item, service `Fulcrum.Connector.Activepieces`, account
`local-runtime`, holds the generated local login for this Mac. Connections use
workspace-specific external IDs. Per-workspace identities would try to register
a second owner on an already-provisioned instance. Missing credentials are
reported separately from denied access; denial never becomes permission to
replace an existing identity. The item uses device-only accessibility.

Workspace-local `managed-sources.json` contains connection receipts and pending
source IDs only. A pending marker is written before a grant can be saved.
Bounded metadata lookup recovers a remote connection after an interrupted final
receipt write. Lookup checks project, namespace, piece and project scope; its
page limit fails closed. Authorization codes, API keys and runtime passwords
are never written to that file.

The authenticated administration API adds `sources.status`, `sources.begin`,
`sources.complete`, `sources.granola`, `sources.verify`, `sources.cancel` and
`sources.disconnect`. Begin requires explicit acknowledgement on the designated
device. Status and restore do no network work. Restored receipts are `saved`,
not `connected`, until checked against runtime metadata. That check is not
proof of source read access, narrowed granted permissions or ingestion.

These operations work on local connection settings outside the canonical write
queue. A blocked connector request therefore does not block workspace reads or
edits. No source-adapter actions, source-body reads or canonical domain writes
are introduced. Every status retains `ingestion: blocked`.

Cancellation invalidates late authorization URLs. If a grant arrives after
cancellation, shutdown or ingestion-device handover, the core removes that
connection before marking it disconnected. Failed/uncertain exchanges retain
a pending marker for recovery. Graceful shutdown removes unclaimed attempts
and waits for in-flight cleanup; storage failure cannot manufacture a successful
disconnect. Existing direct Gmail ingestion is not migrated or erased.

The native protocol test compiles the real Objective-C helper against substituted
Security calls. It checks missing/denied responses, the shared runtime account,
Gmail namespace isolation and device-only storage attributes without touching
the user's Keychain. Both macOS architecture jobs run this test. Actual Keychain
approval, hosted browser callbacks, live provider grants and an updated native
bundle remain unverified in this unit.

Core-unit validation: supported Node 22 ran 692 passing workspace tests with
one existing skip (`--maxWorkers=1 --testTimeout=15000`), plus 116 passing
reference tests, one reference skip and one TODO. The longer local timeout is
explicit; this is not a claim about an unchanged default-timeout run. Schema
generation checks, strict typecheck, lint and local documentation links pass.
The local macOS production SEA core and MCP sidecars both package and pass
schema, FTS5 and encryption self-tests. These sidecars are not an updated
launched desktop bundle, an installer test or live managed-connector acceptance.
