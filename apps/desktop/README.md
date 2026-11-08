# Desktop shell (U1)

React + Vite views use `CoreTransport` through a `Platform` adapter. Navigation
contains Initiatives, Priorities, Questions and Settings. The question count is
read from the core and refreshed after AppliedChange and every 30 seconds.
Failed reads hide stale counts and expose retry. Route changes focus the heading;
links support browser history and keyboard activation.

This step supplies the shell. Portfolio cards, objective ranking, question review
and settings controls belong to later steps. Their routes say they are unavailable
instead of presenting fake actions. No canonical mutation is performed by U1.

## Review in a browser

Install Node 22 LTS and pnpm 10.11.0. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Open `http://127.0.0.1:5173`. This launches a real file-backed core and the separate
C6 development bridge against a new disposable synthetic workspace in the OS
temporary directory. It never reads/writes Keychain, starts inference, calls
connectors or opens an existing workspace. Ctrl-C shuts down the session and
removes its temporary workspace. Port 5173 must be free; it never selects another
port silently. Do not use this disposable launcher for real work.

Check all four destinations, back/forward, Tab/Shift-Tab/Enter, selected location,
heading focus, and narrow-window reflow. Zero questions intentionally has no badge.
Compare `src/ui/tokens.css` with `../../docs/DESIGN_RULES.md`.

For an explicitly configured existing development bridge, set
`FULCRUM_DEV_SESSION` to its private `dev-session.json` and run
`pnpm --filter @fulcrum/desktop dev`. The bootstrap endpoint requires the exact
loopback Host and same-origin Fetch Metadata; session files must be owned regular
0600 files, never symlinks. Tokens are not put in URLs, localStorage, compiled
assets or console output. Vite's trusted development process can serve workspace
source; this is not a hardened remote service.

## Native shell

Install stable Rust/Cargo and Xcode Command Line Tools. Build/start the C6 core
following `../core/README.md` with a user-selected synthetic workspace and the
stable synthetic user ID below. Keep that process running. The production profile
is fixed by the core; do not run a second production core.

```sh
pnpm --filter @fulcrum/core build
workspaceDirectory="$(mktemp -d)/review.fulcrum"
node apps/core/dist/core.mjs --workspace "$workspaceDirectory" --user-entity 07000000-0000-7000-8000-000000000001 --create
```

In a second terminal at the repository root:

```sh
pnpm --filter @fulcrum/desktop tauri dev
```

The Tauri UI uses native IPC even in development. Rust reads the existing
`Fulcrum.Core` / `local-client` Keychain item; it never creates or exports a
credential to JavaScript. Requests use the fixed private core socket, authenticate
natively, and are limited to health/query/execute plus native subscriptions.
Keychain and socket I/O have deadlines. Subscriptions are closed on retry/exit.
No filesystem, shell-spawn or network plugin permissions are granted to the UI.
The [Tauri command](https://v2.tauri.app/develop/calling-rust/) and
[event](https://v2.tauri.app/develop/calling-frontend/) APIs are isolated in the
platform adapter. The [Vite server](https://vite.dev/config/server-options) uses
loopback and a strict port.

`pnpm --filter @fulcrum/desktop build` builds the release frontend, excluding the
browser session bootstrap and WebSocket channel. `cargo test --manifest-path
apps/desktop/src-tauri/Cargo.toml` tests the native socket protocol with synthetic
servers. `pnpm --filter @fulcrum/desktop tauri build --no-bundle` compiles the shell.
CI compiles/tests Intel and ARM separately; it does not prove visible-window or
Keychain acceptance.

The app currently attaches to an already running C6 core. Automatic launch,
standalone runtime selection/bundling, first-run configuration and signing remain
S7/P2/P5 work; this does not choose a provisional packaging runtime. Do not ship
or publish an unsigned app as a release. Actual Keychain prompts/ACLs, native
visible-window behavior and owner usability review must be recorded separately.

## Owner acceptance

Record browser/native observations and blockers in `docs/reviews/U1.md` (synthetic
content only), then tick the Owner box for step 16 in `backlog/PROGRESS.md` once
the app feels right. Leave blocked native checks explicit. Never tick other
hardware, model, connector or packaging checks based on this review.
