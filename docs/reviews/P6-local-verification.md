# Local encryption verification — 2026-11-10

The merged P6 implementation passed its local synthetic encryption and release checks on Intel macOS with Node 22.23.4. The tested source tree matches commit 3d2e9dd, merged into main by bc078f7.

The focused Vitest run passed 14 tests across encryption, release launch paths, desktop release configuration and third-party notice generation. Encryption checks exercise authenticated purpose/device/manifest bindings, fresh nonces, wrong keys and recovery cards, preservation of source/history during copy, encrypted append/checkpoint, corrupt/conflicted records, fresh-key rotation/restore, interrupted copies, downgrade detection and the durable lock path. The keys use the in-memory test port.

The native Rust test suite passed all seven tests, including socket authentication and response validation. The first sandboxed run denied the Unix socket operations. Re-running with local socket permission passed. The Intel production core and MCP single executables were rebuilt and both self-tests returned `{"schemas":true,"fts5":true,"encryption":true}`.

Run the focused checks from the repository root with the documented Node/pnpm versions.

```sh
pnpm exec vitest run --project unit tools/workspace/encryption.test.mjs tools/workspace/release-paths.test.mjs tools/workspace/desktop-release.test.mjs tools/workspace/release-notices.test.mjs
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node tools/release/sea.mjs /tmp/fulcrum-p6-verification
```

Signed Keychain ACLs, provisioning, native recovery dialogs, reboot, Apple Silicon and the two-Mac sync matrix still require [P6 owner acceptance](P6.md#owner-acceptance). The Owner box remains pending.
