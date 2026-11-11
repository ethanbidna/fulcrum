# ADR-0024: Provisional universal Node SEA releases

- Status: Accepted engineering direction; signed release acceptance pending
- Date: 2026-11-10
- Extends ADR-0009; does not accept S7 hardware measurements

The owner authorized implementation before hardware testing. Build the actual
core and MCP entry points as separate Node 22 SEA executables. Each architecture
loads bundled schemas and passes a SQLite FTS5 self-test before assembly. A
universal app contains universal sibling executables, schemas and generated
notices. Development transports must be absent. MCP configuration launches the
bundled shim directly; the shim launches the fixed sibling core and native
credential helper. No Node installation or shell launcher is required.

Release CI runs only from main by explicit dispatch into the release environment.
Credentials stay in Actions secrets and an ephemeral runner keychain. Missing
Developer ID/notary/updater credentials fail closed. Sign nested executables
with hardened runtime and JIT entitlement, then let Tauri sign/notarize the app
and DMG. Verify code signatures, both architectures, stapling and Gatekeeper
before offering artifacts. The workflow uploads artifacts; publishing a release
and its update manifest is a separate owner action.

The native application menu checks for updates only after a user click. It uses
a compiled public key and fixed HTTPS GitHub endpoint; Tauri verifies the artifact
signature. The JSON manifest contains signed-artifact references, not a detached
signature over the JSON itself. Installation requires a second confirmation and
restarts after stopping the old core. Development builds without a public key
explain their status and make no update request. No startup polling or telemetry.

Generate notices from production npm dependencies, the filtered macOS Cargo
closure, and the exact Node version's upstream license. Parse SPDX expressions;
unknown/unapproved license choices fail. Preserve upstream license/notice files,
package source URLs and metadata authors. Version/hash-bound overrides supply
licenses omitted by upstream crate archives. EPL/Mozilla source remains
available at each included exact-version source URL; no dependency source is
modified. Models, Graphiti and graph servers are not bundled.

Real universal execution, notarization, key continuity, upgrade/rollback and
clean-user launch still need the P5 owner procedure. Local/CI builds alone do not
establish those outcomes or a measured runtime recommendation.

References: [Tauri signing](https://v2.tauri.app/distribute/sign/macos/),
[updater](https://v2.tauri.app/plugin/updater/),
[Node SEA](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html).
