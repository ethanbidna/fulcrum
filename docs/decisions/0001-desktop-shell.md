# ADR-0001: Tauri desktop shell; UI developed browser-first

- **Status:** Accepted for development · Packaging on Intel **provisional** (S7)
- **Date:** 2026-11-07

## Context
Fulcrum is a single-user macOS app that must run on a 2019 Intel MacBook Pro with limited RAM, be installable by non-technical users, and later ship signed updates. The spec prefers Tauri + React + TypeScript and asks whether a local web app should come first.

## Options
1. **Tauri 2** — system WKWebView, small bundle, Rust shell for OS integration (Keychain, power/thermal/wake), sidecar support, signed updater.
2. **Electron** — mature, but bundles Chromium + Node: ~150–250 MB RAM baseline per app, heavier on the Intel target.
3. **Local web app** (core serves UI on localhost, user opens a browser) — fastest to start, but no Keychain/power APIs, awkward for non-technical users, a localhost HTTP port is an additional attack surface.
4. **Native SwiftUI** — best macOS fit, but React Flow/ELK equivalents do not exist; slower for Codex to build.

## Decision
Tauri 2 for distribution. The React UI talks to the core through a `CoreTransport` interface, so during development it runs in a normal browser against a dev core over a local WebSocket (dev builds only). No UI code calls Tauri APIs directly; OS features go through a `Platform` adapter with a browser stub.

## Consequences
- Codex can build and test the whole UI in a browser from M1; Tauri wiring is a thin task.
- WKWebView quirks (Safari engine) must be tested — React Flow supports Safari.
- The dev WebSocket bridge never ships in release builds.

## Validation (S7)
The [S7 harness and report](../spikes/S7.md) include a Tauri 2 launcher, separate
Node SEA/Bun builds and measurement commands. The Intel Node SEA sidecar runs;
both native runtimes and Tauri apps pass Intel/Apple Silicon CI builds, Rust
tests and launch/FTS5 checks. Controlled hardware, visible GUI, universal and
notarization validation remain pending. Packaging stays provisional.

Bundle size, cold start, idle RAM on Intel and Apple Silicon; universal binary; notarization dry run.
