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
3. **Local AI** (ingestion device only). Detect Intel vs Apple Silicon and RAM; recommend a tier ([OPERATIONS.md](OPERATIONS.md#model-tiers)); install Ollama if missing (guided); show the Llama license; download; self-test. "Continue without local AI" is always available.
4. **Connect sources** (optional). Show supported sources with honest status labels ("Beta", "Not yet available"). Per source: sign in via the system browser (OAuth), then pick exactly which channels/labels/folders to include. Default backfill 14 days.
5. **First initiative.** Either "Create one now" (title + optional category + MoSCoW) or, if a backfill ran, "Review proposed initiatives" (approve/reject list). Nothing becomes active without approval.
6. **Done.** Land on the portfolio. Freshness label explains what is happening ("Reading the last 14 days — you can keep working").

## Second Mac

Install app → "Open an existing workspace" → pick the synced folder → name this Mac → viewer/editor mode. Indexes rebuild locally (progress shown). No credentials are copied; sources stay on the ingestion Mac. Golden scenario 9.

## Prerequisite reality check

| Component | Path for a non-technical user | Risk |
|---|---|---|
| Ollama | Official signed macOS app download, guided | User must approve an extra app; later we may bundle (MIT). |
| Activepieces (if S4 chooses it) | Must not require Docker for ordinary users | **High** — if self-hosting needs Docker/Postgres, native adapters are used instead ([ADR-0002](decisions/0002-integration-boundary.md)). |
| Graphiti sidecar (if S3 passes) | Python runtime bundled or managed by the app (e.g. `uv`-built, signed) | Medium; only offered in full tier. |

## Uninstall

Settings → Privacy & Data → "Remove Fulcrum data from this Mac" deletes machine-local data and Keychain items. The workspace folder is left untouched (it is the user's file) unless they explicitly choose to delete it.
