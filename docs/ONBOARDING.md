# Install and first run (non-technical Mac users)

Target user: comfortable with Mac apps, never opens Terminal. Every step must be completable with clicks, show honest progress, and be retryable.

## Distribution plan

| Stage | How users get it | Requirements |
|---|---|---|
| Developer preview (now → M1) | Build from source (`README` instructions) | Xcode CLT, Node, Rust. Developers only. |
| Private alpha | Signed, notarized `.dmg` from GitHub Releases | Apple Developer ID; notarization in CI; universal binary (x86_64 + arm64). |
| Public | Same, plus in-app updates | Tauri updater with signed update manifests; no downloads from a personal website until signing and update verification are in place (spec requirement). |

Not before signing exists: no unsigned binaries, no "right-click → Open" instructions for ordinary users.

## What the app bundle contains

Fulcrum.app = Tauri shell + UI + `fulcrum-core` sidecar (TypeScript compiled to a standalone executable, S7) + `fulcrum-mcp` shim. **Not** included: model weights, Ollama, Docker, Python. Optional components are installed on demand by the wizard.

## First-run wizard

Each step has: one-sentence purpose, the default action as the primary button, "Skip for now" where it is safe, and a plain-English failure message with Retry.

1. **Choose a workspace folder.**
   - Options: "In Documents" (default), "In Dropbox", "In Google Drive", "Choose…", or "Open an existing Fulcrum workspace".
   - Detect Dropbox/Drive folders; for Google Drive, check the folder is available offline and explain how to set it if not.
   - If the user later connects work sources, show the employer-data notice ([SECURITY_MODEL.md](SECURITY_MODEL.md) T4).
2. **Name this Mac** (e.g. "Desk Mac"). Ask: "Should this Mac read your sources in the background?" — yes makes it the ingestion device; an existing workspace already having one shows which Mac it is and offers "Keep" / "Move to this Mac".
3. **Choose AI** (optional on each Mac). Detect hardware and suggest a provisional local profile. Let the user choose a local model, explicitly enable a hosted provider with their own API key, or continue without AI. Complete setup using the flow below; background ingestion still belongs only to the designated ingestion Mac.
4. **Connect sources** (optional). Show supported sources with honest status labels ("Beta", "Not yet available"). Per source: sign in via the system browser (OAuth), then pick exactly which channels/labels/folders to include. Default backfill 14 days.
5. **First initiative.** Either "Create one now" (title + optional category + MoSCoW) or, if a backfill ran, "Review proposed initiatives" (approve/reject list). Nothing becomes active without approval.
6. **Done.** Land on the portfolio. Freshness label explains what is happening ("Reading the last 14 days — you can keep working").

## AI selection and setup (P2 contract)

See [ADR-0018](decisions/0018-model-choice-and-setup.md). This is planned behavior,
not a claim that downloads, API setup or hardware detection are implemented.

1. **Recommendation.** Detect chip/runtime support, available RAM and disk. Show
   the suggested profile, resource needs, download size and validation status.
   Use hardware plus a bounded local test; RAM alone is not a compatibility claim.
2. **Choice.** Offer local open-weight models and optional hosted providers in a
   searchable list. Show the actual license, developer country/region and source
   of that metadata, including base-model origin for derivatives. Optional domestic-only or region-exclusion preferences use
   a country the user selects; unknown origins remain visibly unknown. Do not
   infer a preference or silently substitute an excluded developer.
3. **Local path.** Show license terms before acceptance. One Download and set up
   action manages an approved runtime if needed, model download, progress and a
   synthetic compatibility test. Support cancel, retry and resume where supported;
   verify the installed artifact/digest. Keep OS approvals in the guided flow,
   without Terminal commands. Show low disk, unsupported runtime and slow-device
   results with a next action. Offer another model or Continue without AI.
4. **Hosted path.** Show provider/model, declared processing location, data policy,
   price when known, and what content would be sent. Country of developer is not
   data residency. User enters an existing API key, explicitly selects sharing
   scope and usage budget, then chooses Connect and test. Use synthetic test data;
   store keys only in Keychain. Link to provider account/key setup when needed;
   Fulcrum does not create accounts or handle provider billing.
5. **Finish or revisit.** Show installed/connected model and compatibility result.
   Settings offers the same model chooser and setup flow. Never silently enable
   hosted fallback or downloads. Model changes retain all evidence and undo rules.

Model weights, keys and machine-local selections never enter the synced workspace.
A successful self-test proves compatibility, not production extraction accuracy.

## Second Mac

Install app → "Open an existing workspace" → pick the synced folder → name this Mac → viewer/editor mode. Indexes rebuild locally (progress shown). No credentials are copied; sources stay on the ingestion Mac. AI for interactive
commands may be configured separately on this Mac. Golden scenario 9.

For future encrypted workspaces, [P6's design](ENCRYPTION.md) adds a native
Import recovery key step before state or indexes open. Keys do not sync with
the workspace; the owner transfers the saved recovery card out of band. Setup
must verify a saved card before enabling encryption. A missing key offers
import/cancel, never replacement or a blank portfolio. This flow is planned,
not implemented; current readers refuse encrypted workspaces.

## Prerequisite reality check

| Component | Path for a non-technical user | Risk |
|---|---|---|
| Ollama | Wizard-managed official installation, with required OS approvals | User must approve an extra app; later we may bundle (MIT). |
| Activepieces (if S4 chooses it) | Must not require Docker for ordinary users | **High** — if self-hosting needs Docker/Postgres, native adapters are used instead ([ADR-0002](decisions/0002-integration-boundary.md)). |
| Graphiti sidecar (if S3 passes) | Python runtime bundled or managed by the app (e.g. `uv`-built, signed) | Medium; only offered in full tier. |

## Uninstall

Settings → Privacy & Data → "Remove Fulcrum data from this Mac" deletes machine-local data and Keychain items. The workspace folder is left untouched (it is the user's file) unless they explicitly choose to delete it. Under the planned P6 flow, deleting
workspace-key items requires a warning and recovery confirmation; losing every
key/card makes encrypted copies unrecoverable. No such key-management behavior
is implemented by the design step.
