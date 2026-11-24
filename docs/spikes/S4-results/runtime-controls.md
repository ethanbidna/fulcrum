# In-app connection service — November 24, 2026

## Implemented

The native core now owns acknowledged, asynchronous connection-service setup.
Settings, first-run setup and the focused source page share controls for
install/start/stop/cancel and six source connections. Setup does not open an
Activepieces dashboard. Source OAuth forms explicitly disclose hosted credential
exchange/renewal; Granola retains masked key entry.

Default startup reads only local installation/preferences. It does not install,
start a VM or create a runtime owner without opt-in. After a user starts the
service, the core checks readiness, initializes the local owner through Keychain
and connection metadata, then admits source setup. Native runtime secrets,
local session tokens and callback codes never enter the desktop response.

Stopping suspends source admission, aborts browser waiting, settles exchanges,
cleans up late grants and preserves receipts. Restart attaches a new client;
receipts require an explicit metadata check. Unsaved form keys are discarded
when runtime phase changes. Health failure/designation loss suspends the client.
Source-action execution and importing remain blocked under ADR-0030.

## Automated verification

- Node 22: 742 unit tests pass, one existing skip; reference tests pass 116,
  with one existing skip and one TODO. Local unit allowance:
  `--maxWorkers=1 --testTimeout=15000`.
- Typecheck, lint and schema checks pass. Generated Rust `target/` output is
  excluded from source lint; the first native build exposed that missing ignore.
- Storybook CLI: all 119 component tests pass, with no accessibility violations;
  strict UI types and static workshop build pass. Consent, progress, cancellation,
  disabled/failed/unavailable states, keyboard focus, shared-screen setup,
  saved receipts and clearing unsaved keys have browser coverage.
- Seven native Rust tests pass. Production desktop assets build. Both macOS
  SEA sidecars build and pass schema, FTS5 and encryption self-tests.
- Synthetic lifecycle tests cover no default network/install, acknowledged
  asynchronous admission, canonical reads during setup, owner-bootstrap
  cancellation, late Granola cleanup, paused browser restart, opt-in restore,
  unhealthy service, malformed preferences and missing native support.

The first reference invocation used unsupported Node 23 and failed the older
S7 executable tests; the supported Node 22 run above passes. No runtime claim
is based on that failed invocation. The hosted-auth disclosure test first
failed on the old wording, then passed after the disclosure was corrected.

## Native preview and prerequisites

A local Intel macOS debug app bundles the production desktop assets and updated
production core/MCP executables. It is signed locally with an ad-hoc identity;
this is not a Developer ID/notarized distribution or an ARM execution result.

The first actual launch exited before showing a window: the updater plugin
cannot deserialize an absent `plugins.updater` configuration. That existing
problem is fixed separately in [PR #100](https://github.com/ethanbidna/fulcrum/pull/100).
Automatic approval review rejected merging it because the project reserves PR
merges for the owner. No merge or duplicate repository fix was made. The local
preview uses PR #100's exact plugin configuration as an untracked build overlay,
plus the bundled resource mapping. The owner must merge that prerequisite for
normal native builds. A Rust compile/test pass alone did not detect this startup
failure; executing the app did.

Desktop inspection initially timed out because the app had exited. With the
local overlay, the native app opens and connects to its bundled local core.
Its Sources & Integrations screen shows all six managed sources and the local
service controls. The existing direct Gmail connection remains separate.
No screenshot of the user's actual workspace/account is committed.

The native Start control was exercised. It reached the Keychain approval gate
rather than ready: the new ad-hoc app needs the owner to approve access to the
existing runtime keys, originally created by the standalone probe helper.
A direct helper diagnostic timed out without displaying or copying keys. The
desktop tool refuses to operate macOS SecurityAgent, so approval was handed to
the owner. The final preview provides a 60-second approval window and a specific
retry message. Full native start/owner-bootstrap/stop/restart remains unverified
until that handoff completes; no approval was inferred from elapsed time.

This live run also exposed an idempotency bug: Lima rejects `stop` when a VM is
already stopped. A failing regression reproduced it. The driver now checks the
owned instance's exact name/state after binary verification, treats Stopped as
success, and only sends stop for Running. Two consecutive stops against the
real stopped v1 VM passed without any Keychain access. No force-stop/reset was
introduced.

The updated bundled core was restarted using its authenticated shutdown API,
with the existing workspace configuration retained. The native Settings page
was refreshed against it. A synthetic-only [settings image](runtime-controls.jpg)
is recorded; it does not claim a live service connection.

 The installed profile and master keys are the owned v1 profile from
ADR-0032; no old trial volume was deleted or migrated. No new provider grant,
mail/file/event read, scope selection or source action is part of this check.

## Remaining acceptance

Merge the runtime/control stack and updater prerequisite through owner review.
Verify signed distribution and clean-user download/OS approval on supported Macs,
run the VM on Apple Silicon, and inspect actual consent/granted scopes for new
providers. Managed ingestion still needs a no-full-body-retention execution path.
Do not tick step 25's Owner box from a runtime setup or metadata check.
