# ADR-0014: Core composition and local transports

- **Status:** Accepted
- **Date:** 2026-11-08
- **Refines:** ADR-0007 and ADR-0009 implementation boundaries

## Decision

`apps/core` is the application composition root. It may import public domain
and store APIs to supply schema validators, device identity, clocks and durable
commit ports. Drivers still cannot import domain internals, and presentation
cannot import drivers. Layer lint covers this explicit exception.

The Node 22 implementation uses S7's newline-delimited JSON-RPC contract over
a mode-0600 Unix socket in a mode-0700 local directory. The production launcher
uses one fixed Application Support profile. Acquire the store's profile lock
before removing a crash-left socket; never replace a regular file. File-store
locking, clone handling and publication semantics remain ADR-0013's responsibility.

A Keychain driver supplies the installation secret through macOS's `security`
utility. Missing credentials may be created; denied/invalid/unavailable Keychain
access fails startup with no plaintext credential fallback. Client processes
authenticate before querying, writing or subscribing. RPC arguments cannot select
actors, drivers, workspace paths or reconciliation proof. C6 exposes the trusted
local UI command channel only, with actor `user`; MCP remains disabled and P1
must introduce independently authorized client scopes and disclosure.

Requests are limited to 64 KiB, 16 queued requests per connection and 16 clients.
Unauthenticated connections expire after five seconds. Responses and buffered
output are capped at 8 MiB; oversized views fail the connection rather than
returning partial state. Idle shutdown occurs after five minutes without clients
or active ingestion. C6 has no ingestion scheduler, so its host reports no active
ingestion. Shutdown drains admitted requests before checkpointing and unlocking.

Reload the complete retained event history to preserve undo and protection
metadata. Validate externally changed manifests before serving state. Live
commands and newly observed valid external events produce `AppliedChange`
notifications; boot registration is not replayed to new subscribers. Readers
requery canonical projections rather than patching their own authoritative state.

The UI uses `CoreTransport` over an injected channel. The native shell must keep
the Keychain secret outside the webview. U1 binds that channel to the shell;
this step does not replace the S7 health-only Tauri experiment with a product UI.

Browser development has a separate entry point and build output. Its loopback
WebSocket bridge requires an exact configured localhost Origin and Host, plus a
random session token distinct from the Keychain secret. It forwards through the
same authenticated Unix socket. It is absent from the release dependency graph;
a build assertion and test enforce this. No release TCP listener is introduced.

## Validation and limits

Tests exercise actual sockets, framing, authentication, subscriptions, durable
commands, reopen, locking and a compiled child process with synthetic credentials.
Keychain calls are driver-contract tests; no real credential was installed or
read in this task. Keychain prompts/access controls and signed-client identity
must be validated on packaged macOS clients before shipping. The command-line
credential creation path briefly passes the generated value to `security` as an
argument; this does not establish isolation from hostile same-user processes.

The JavaScript bundle includes canonical schema assets. This is a Node 22 core,
not a selected standalone SEA/Bun release. S7's architecture, signing and hardware
gates remain pending. Browser-channel tests use the standard WebSocket event API
with a Node adapter; real browser and Tauri UI operation remain U1 validation.
No persisted workspace schema, merge semantics or model choice changes.
