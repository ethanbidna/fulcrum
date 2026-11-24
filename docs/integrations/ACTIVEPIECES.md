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
| Browser callback and six-source Settings/onboarding | Implemented; synthetic callback and browser interaction checks |
| Runtime driver / updated launched app | In-app controls built and launched locally; live readiness awaits native Keychain approval |
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

- [Pinned connection metadata request contract](https://github.com/activepieces/activepieces/blob/0.93.0/packages/core/shared/src/lib/automation/app-connection/dto/read-app-connection-request.ts)
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

Review: [PR #108](https://github.com/ethanbidna/fulcrum/pull/108), stacked on
#107 and the existing native foundations from #105.

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

Core-unit validation: supported Node 22 ran 694 passing workspace tests with
one existing skip (`--maxWorkers=1 --testTimeout=15000`), plus 116 passing
reference tests, one reference skip and one TODO. The longer local timeout is
explicit; this is not a claim about an unchanged default-timeout run. Schema
generation checks, strict typecheck, lint and local documentation links pass.
The local macOS production SEA core and MCP sidecars both package and pass
schema, FTS5 and encryption self-tests. These sidecars are not an updated
launched desktop bundle, an installer test or live managed-connector acceptance.

Final review added failing-then-passing OAuth and Granola regressions for
cancellation during receipt persistence. The final full suite and both
production sidecar self-tests passed after that fix.


## Browser and Settings continuation — November 24

Review: [PR #109](https://github.com/ethanbidna/fulcrum/pull/109), stacked on
#108. The local Storybook review contains 42 stories in four collections.
Changed-story discovery supplied the IDs; the beta component graph did not
resolve these source paths, so the full 102-story run is the coverage evidence.

The desktop Sources & Integrations section, focused Connect a source page and
first-run source step now share the six-source controls. New sign-in requests
use `sources.connect`; direct `sources.begin`/`sources.complete` remain core
protocol operations. A core-owned browser coordinator opens a temporary local
helper page, receives the hosted popup reply, and completes through the existing
settings service. The native webview never receives the code or runtime token.

The helper asks for a user gesture before opening the provider popup. It
validates the exact hosted reply origin and exact popup reference, decodes once,
and sends a bounded JSON reply to the private local path. The local listener
checks Host, Origin, path, method, content type and field allowlist. Completion
is single-use; timeouts, cancellation, browser-launch failure and core shutdown
close the listener. The page uses no-store, no-referrer, a script nonce and
frame denial. It has no runtime credential, arbitrary proxy or action runner.
A browser popup blocker is explained locally and can be retried without opening
an Activepieces dashboard.

Connection work returns immediately through administration, preserving normal
workspace editing while consent is open. Settings cancellation aborts the helper
and invalidates the settings attempt; a late code cannot become a new grant.
Unexpected browser failure produces a retryable source status without exposing
upstream error details. Runtime endpoints and credentials remain core-owned.

Each source form explains requested permissions and credential custody, then
requires acknowledgement. The Granola field is masked, length-bounded, and
removed on submit/cancel; no key is saved to browser storage or canonical data.
Cancelling setup restores keyboard focus to the source button. Moving a
previously designated device requires confirmation and never opens consent as
a side effect. Checked/saved connections are distinct from importing, which is
explicitly off. Label/channel/folder/calendar selection is not offered yet.

The existing direct Gmail connection remains visible when already connected,
waiting for consent or awaiting label choice. New connection entry points no
longer require a Google Desktop client. This does not migrate credentials,
erase source scopes or disable an already-active legacy ingestion path.

Synthetic tests exercised the local callback using HTTP without contacting a
provider, and exercised popup-message validation with a simulated browser.
The core coordinator was tested with injected browser callbacks. Browser
stories exercise actual React components with synthetic administration callbacks;
no story signs in to a provider or uses a real key. The helper HTML is tested as
a protocol page, rather than importing presentation modules into a driver.

Validation: 701 workspace tests pass on Node 22 with the documented local
`--maxWorkers=1 --testTimeout=15000` allowance; the reference suite passes 116
with one existing skip and one TODO. The complete Storybook CLI suite passes
102 stories with no accessibility violations; strict UI typecheck and static
build pass. Initial heading-order findings were fixed; a setup story was corrected
to wait for the AI step to finish loading before continuing. Typecheck and lint
pass. A synthetic Settings screenshot is stored in
[S4 results](../spikes/S4-results/managed-settings.jpg).

Live provider consent was not repeated in this unit. There is still no installed
owned connector runtime or updated launched app. Runtime installation/resource
handling, actual Keychain prompts, granted-scope inspection, source-scope controls
and automatic ingestion remain open. Full source-body retention is still a
blocker; the connection UI does not change that contract.

The production desktop assets and local macOS SEA core/MCP sidecars also
build successfully. Both sidecars pass schema, FTS5 and encryption self-tests.
This does not install or launch a replacement native desktop bundle.

## Owned-runtime driver continuation — November 24, 2026

[PR #110](https://github.com/ethanbidna/fulcrum/pull/110), stacked on #109,
adds an optional `ConnectorRuntime` implementation backed by
pinned Lima, Ubuntu LTS, rootless containerd and the existing immutable
Activepieces image. It installs without Docker Desktop or host-folder mounts,
keeps its state outside synced workspaces, binds its service to loopback and
preserves its volume and Keychain keys on stop/cancel/retry. Unknown ownership,
missing keys and modified binaries fail closed. Runtime encryption/JWT keys
have a separate device-only native Keychain account from the generated login.

Intel install/readiness/stop/restart passed. A fresh final profile and the
checked-in native-adapter harness also passed after adding the
volume-owner/key-fingerprint check. Both profiles were stopped, and the earlier
trial was preserved rather than deleted. See [the complete runtime evidence,
pins, caveats and reproduction harness](../spikes/S4-results/managed-runtime.md)
and [ADR-0032](../decisions/0032-owned-connector-runtime.md).

This is the runtime driver, not adoption by the desktop composition. No new
provider grant or source action ran. In-app runtime controls, first-owner
bootstrap, an updated launched native bundle and ARM execution remain open.
Full-body log retention still blocks managed ingestion. Step 25 and all Owner
boxes remain unchanged.

Validation: the full unit run passed 725 tests on Node 22 with one existing skip using
`--maxWorkers=1 --testTimeout=15000`. The reference suite passes 116 tests with
one existing skip and one TODO; typecheck, lint, schema checks and the standalone
probe build pass. The native protocol tests compile the Objective-C helper with
substituted Security calls; the separate Intel lifecycle proof uses the real
Keychain adapter. No UI components changed in this runtime-driver unit.

The final checked-in lifecycle harness also passed on Node 22. Both profiles
were confirmed stopped after the proof. Disk-admission tests inject available
capacity so they are independent of the CI runner's filesystem size.

Final review extended binary-integrity checking to explicit stop as well as
startup. Its test first reproduced execution of a changed binary; all 18
runtime tests pass after the fix, with typecheck, lint and schema checks
passing again. The full-suite count above precedes that last regression.


## In-app runtime controls — November 24, 2026

The production native core now composes the owned v1 runtime behind explicit
install/start/stop administration. Settings, focused source setup and onboarding
share resource acknowledgement, progress, cancellation and six-source controls.
Owner sign-in must initialize through Keychain before sources become available.
Stop suspends clients, cancels browser waiting and settles late grants before
stopping the service; receipts survive for explicit verification after restart.
No source actions, flow creation, scope selection or managed importing is enabled.
See [ADR-0033](../decisions/0033-in-app-connection-runtime.md) and the
[complete native results](../spikes/S4-results/runtime-controls.md).

Validation: 742 unit tests and 116 reference tests pass on Node 22, with the
existing skips/TODO preserved. All 119 Storybook CLI checks pass with no
accessibility violations; UI types/static build, source types/lint/schema,
seven native Rust tests, production assets and both SEA self-tests pass.
A live repeated-stop defect found during native testing has a reproducing
regression and a verified fix against the real VM.

The local Intel preview was built, ad-hoc signed, verified and launched with
bundled production assets/core. The normal native build still needs the
existing updater configuration in PR #100; an untracked local overlay was used
for the preview after owner-only merge rules blocked merging that prerequisite.
No repository updater fix or merge was duplicated. The native source screen is
present, but service readiness/owner bootstrap awaits the owner's Keychain
approval. The desktop tool cannot operate SecurityAgent. Credentials and old
volumes were not reset, copied around that prompt or deleted. Signed release,
clean-user install, ARM VM execution and new provider grants remain open.
