# ADR-0033: Control the connection service from Fulcrum

- **Status:** Accepted for optional desktop setup; ingestion remains gated
- **Date:** 2026-11-24
- **Refines:** [ADR-0032](0032-owned-connector-runtime.md), [ADR-0031](0031-managed-browser-handoff.md)

## Decision

Compose the owned runtime in the production native core. Present one shared
local-service section in Sources & Integrations, the focused connection page
and first-run setup, above the six source connections. Do not open an
Activepieces dashboard or expose runtime credentials to the webview.

Installation is optional and off by default. Require explicit acknowledgement
of downloads, reserved VM memory/CPU, disk requirements and isolation before
starting installation. A stored installation can be started without another
download acknowledgement. Source consent remains separate: OAuth connection
forms identify Activepieces' hosted exchange/renewal service and its access to
credentials. Granola uses the acknowledged local API-key form.

Use typed, field-checked `sources.runtime.status/start/stop` administration
requests. Start and stop return immediately; status polling reports phase and
byte counts, without a percentage. Network waits, VM commands and Keychain
operations do not hold the canonical write queue. Source content selects none
of these operations, their configuration or recipients.

## Runtime and connection lifecycle

Persist only `{ enabled: boolean }` in machine-private `connection-runtime.json`.
Keep the runtime's installation record, volume and encryption keys under
ADR-0032; use a stable machine-local v1 profile. Production does not accept an
arbitrary origin from the old origin-only configuration seam.

After runtime readiness, restore or provision its generated local owner through
the native Keychain-backed connection driver. A bounded Gmail *connection
metadata* lookup initializes sign-in; it reads no mail and requests no provider
grant. Enable source controls only after this succeeds. An already-provisioned
identity never falls back to signup and is not reset on failure.

An enabled, installed service may start when the native core opens on the
designated ingestion Mac. Interrupted installation never silently restarts a
download. Another Mac or a missing native helper leaves setup unavailable.
The app remains usable. Explicit stop/cancel persists opt-out; core shutdown
preserves the prior opt-in for the next launch and stops the VM. Closing a
window retains the app's existing background/core lifecycle.

Before stopping, reject new source operations, abort temporary browser
listeners, settle pending exchanges and clean up late grants while the old
client still exists. Then drop the client and stop the runtime. Retain saved
receipts. On restart, replace the client and show receipts as saved until
explicit metadata verification; do not imply importing or refreshed tokens.
Reset open connection forms, including unsaved Granola keys, when runtime phase
changes. A bounded periodic health check suspends clients and stops the service
if it fails or the device loses its designation.

Failed setup preserves keys and data. Unknown ownership, denied Keychain
access and modified binaries remain errors. There is no reset/delete action.
If saving stop preference or stopping fails, show the failure and a retry;
do not report a completed stop. The canonical workspace schema is unchanged.

## Evidence and limits

See [native integration results](../spikes/S4-results/runtime-controls.md),
[the integration record](../integrations/ACTIVEPIECES.md) and the PR's acceptance
checklist. Synthetic browser/component tests are distinct from native execution.
The local preview needs the existing updater startup configuration from PR #100;
that prerequisite is not silently reimplemented or merged here.

Full-body run/activity retention still blocks managed ingestion. These controls
create no flows or source-action jobs, select no source scopes, and do not
migrate or disable an existing direct Gmail connection. Live grants for all six
providers, token-expiry renewal, clean-user installation, ARM VM execution and
signed/notarized distribution remain separate acceptance checks.
