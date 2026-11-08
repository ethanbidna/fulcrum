# Core process (C6)

The core owns a portable workspace and its local profile lock, schema-validated
Domain commands, projections and subscriptions. It performs no model inference,
connector calls, ingestion scheduling or telemetry.

Build with Node 22 and `pnpm --filter @fulcrum/core build`. The output is
`apps/core/dist/core.mjs` plus `dist/schemas/v1/`. Keep the schemas beside the
bundle. This is a JavaScript core requiring Node 22; standalone packaging remains
S7 work. No unsigned executable is published.

Start it on macOS with a user-selected workspace and a stable user entity UUID:

```sh
node apps/core/dist/core.mjs --workspace "$workspaceDirectory" --user-entity "$userEntityId" --create
```

Omit `--create` for an existing workspace. Reuse the same configured user UUID on
later launches. These are trusted launcher settings, never source content or RPC
arguments. The production profile is the user's `Library/Application Support/Fulcrum`
directory. One core owns that profile at a time. A second launch fails rather
than removing a live core's socket. The wizard and native client launcher remain
later application wiring.

`KeychainSecretStore` reads or creates a generic password for service
`Fulcrum.Core`, account `local-client`. The core never prints it or writes it into
the workspace or a plaintext fallback file. Keychain denial stops startup. Actual
macOS Keychain prompt/ACL behavior and signed-client access remain unverified;
the driver tests use synthetic command responses. See ADR-0014's same-user threat
limit for the command-line credential creation path.

## RPC contract

Connect to `core.sock` in that local profile. Send one JSON object per line:

```json
{"jsonrpc":"2.0","id":1,"method":"authenticate","params":{"secret":"<from native Keychain driver>"}}
{"jsonrpc":"2.0","id":2,"method":"query","params":{"name":"portfolio.list","args":{}}}
{"jsonrpc":"2.0","id":3,"method":"subscribe","params":{}}
```

`execute` takes a command envelope without `actor`; the core supplies `user`.
`query` takes a C5 query name and arguments. `health`, `subscribe` and
`unsubscribe` complete the C6 method set. Subscribers receive JSON-RPC
notifications named `AppliedChange` after acknowledged commands or validated
external event arrival. Query again for current projections. Stored source text
cannot choose methods, actors or settings. MCP is not enabled by this channel;
P1 must authorize/scope its clients separately before exposing any reads/writes.

Requests are capped at 64 KiB, responses at 8 MiB, pending requests at 16 per
client and clients at 16. Authentication expires after five seconds. Malformed
or unauthorized input produces generic errors without echoing source content;
known domain error codes are retained as error data. Slow output consumers are
disconnected. Clients bound connection/request waits to ten seconds.

After five minutes with no clients or active ingestion, the core drains admitted
requests, checkpoints acknowledged state, closes its socket and releases its lock.
SIGINT/SIGTERM use the same path. C6 has no running ingestion jobs. Missing or
incompatible external workspace data blocks reads/writes until a valid reload.
No checkpoint-only startup drops retained undo/protection history.

## Browser development

Run `pnpm --filter @fulcrum/core build:dev` separately, then, with the core running:

```sh
node apps/core/dist-dev/core.mjs --local "$localProfileDirectory" --origin http://127.0.0.1:5173
```

The development bridge writes `dev-session.json` with an ephemeral URL/token in
the private local profile. It refuses an existing session file; remove a stale
file after confirming the previous bridge has exited. Normal shutdown removes
its own session file. Nothing is logged to the console beyond readiness. The
Keychain secret remains native; the browser receives only the development token.

`DevelopmentWebSocketChannel.connect(url, token)` implements the channel used by
`ShellCoreTransport`. It connects only to loopback. Origin/Host checks and a
separate token guard the bridge. No CORS fallback, remote bind or production
runtime flag can enable it. `dist` and `dist-dev` have separate entry graphs; the
release build rejects a development bridge or `ws` input in its metafile.

Run `pnpm check`. Tests include real Unix/WebSocket I/O, a compiled core child,
commit/reopen, startup failures, auth/framing limits, subscriptions and release
exclusion. Browser-channel tests use a Node WebSocket event adapter; no real
browser window, Tauri UI, real Keychain, cloud sync or hardware acceptance is
claimed. [ADR-0014](../../docs/decisions/0014-core-transports.md) records the bounds.
The development bridge uses the maintained [ws server API](https://github.com/websockets/ws/blob/master/README.md).

## C7 search binding

The core opens `index.sqlite` in its local profile after validated domain replay.
Search uses the same query channel: `search` with `{text, scope?}`, and
`status.index` with `{}`. It updates derived rows after acknowledged commands and
rebuilds on validated external reloads. Cache errors do not revoke writes.
The launcher emits count-only JSON `index-progress` records before `READY` so
a native launcher can display rebuild counts. See `packages/index/README.md`.
