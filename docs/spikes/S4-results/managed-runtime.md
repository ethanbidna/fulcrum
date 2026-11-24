# Owned connector runtime — November 24, 2026

## Scope

This continuation tests the production `ConnectorRuntime` driver and native
runtime-key protocol. It does not update the launched desktop app, grant a
provider connection, import mail/files/events, or complete I2 acceptance.
[ADR-0032](../../decisions/0032-owned-connector-runtime.md) records the decision.

## Pinned configuration

| Component | Configuration |
| --- | --- |
| Host tested | Intel macOS 15.7.9 |
| Lima | 2.3.0, official Darwin archive, exact size and SHA-256 checked |
| Linux guest | Ubuntu 26.04 LTS, release-20261016, architecture-specific SHA-256 |
| Container engine | Lima rootless containerd, nerdctl-full 2.4.2, pinned SHA-256 |
| Activepieces | Community Edition 0.93.0, architecture-specific image digest |
| VM resources | 2 CPUs, 4 GiB RAM, 20 GiB sparse disk; 24 GiB free-space admission |
| Container resources | 2 CPUs, 3 GiB memory limit, one worker, no engine restart policy |
| Persistence | PGLite and memory queue; named volume inside the private VM |
| Host access | No mounted host folders, imported SSH public keys or forwarded agent |
| Networking | Explicit loopback service port; other automatic port forwarding disabled |
| Optional network services | Hosted OAuth enabled; official piece metadata enabled; telemetry disabled |

Exact URLs, archive sizes and digests are checked into
[the release catalog](../../../packages/sources/src/managed/runtime/catalog.ts).
The amd64 Activepieces digest is unchanged from the November 13/21 proofs.
The ARM manifest exists, but ARM installation has not been run here.
This rootless containerd configuration replaces the spike's requirement for a
host Docker CLI and guest Docker Engine; it does not modify Docker Desktop.

## Installation and lifecycle evidence

The first trial downloaded and verified Lima, reused its digest-checked Ubuntu
cache, downloaded the pinned container engine and pulled the immutable
Activepieces image. Apple Virtualization reported the VM running before the
guest's SSH/bootstrap was ready; that intermediate state was not treated as
service readiness. The private Application Support path includes spaces and
worked with the installed Lima CLI. No administrator password was requested.

The readiness check requires exact version `0.93.0`, edition `ce` and
`CLOUD_AUTH_ENABLED=true`, with a bounded flags response from the owned origin.
The initial trial passed readiness, stopped, restarted from the saved profile
and keys, passed readiness again, then stopped. No dashboard opened.

After adding volume-owner/key-fingerprint validation, the final driver was run
in a separate fresh profile. The earlier trial remains intact and stopped;
there is no automatic migration of its unlabeled development volume. An
attempt to remove that empty trial was rejected by automatic approval review
because deleting a volume could destroy persisted connection data. No deletion
ran. A fresh profile provided the final test without changing earlier data.

The fresh final profile passed readiness, stop, restart readiness and final
stop. The checked-in acceptance harness then repeated that cycle with the
real Keychain adapter and returned `installed`, `initialHealthy` and
`restartHealthy` as true. No account signup, provider grant, action or flow was
performed in either trial. The November 21 live Gmail evidence is unchanged.

Keys were generated and saved through an ad-hoc compiled native Keychain helper
from this revision before VM creation. They survived stop/restart and were not printed or passed in
process arguments. They use account `runtime-keys`, separate from the runtime
login account. This run did not exercise an interactive denial/reapproval;
missing and denied Keychain responses are tested with substituted Security
calls, so automated tests do not access the user's Keychain.

The runtime's environment values remain in private guest container metadata.
Only the master copy is in Keychain; there is no claim that the guest never
persists those values. Installation records contain fingerprints, not keys.

Typecheck, lint and schema generation checks pass. The reference suite passes
116 tests with one existing skip and one TODO. The unit suite passes 724
tests with one existing skip on Node 22, using the documented local
`--maxWorkers=1 --testTimeout=15000` allowance. A regression test first reproduced a late
readiness response being accepted after cancellation; startup now checks the
signal again before reporting ready and stops the owned VM on that path.

## Reproduction and safety boundaries

The developer harness is
[connector-runtime-probe.ts](../../../apps/core/src/connector-runtime-probe.ts).
Build it from the repository root on macOS:

```sh
pnpm exec esbuild apps/core/src/connector-runtime-probe.ts --bundle \
  --platform=node --format=esm --outfile=/private/tmp/fulcrum-runtime-probe.mjs
node /private/tmp/fulcrum-runtime-probe.mjs /absolute/path/to/native-helper probe
```

Use an absolute path to a native helper built from the same revision. The final
argument selects a separate short profile name; it is not a workspace path.
A packaged helper from an older revision cannot store the new runtime-key
account. This is developer acceptance tooling, not an end-user
Terminal setup flow.

The harness installs into a private machine-local profile, tests readiness,
stop and restart, and stops in `finally`. It preserves the VM and keys. It
creates no provider grants or source content. Interrupt it to exercise
cancellation. Do not pass a production profile or replace keys to recover a
failed installation; unknown state fails closed and requires inspection.

Synthetic tests cover architecture pins, no host mounts, loopback-only
forwarding, generated-key shape, missing/mismatched keys, binary modification,
unknown instance/container/volume rejection, cancellation cleanup, private
atomic files, symlink rejection, bounded downloads/commands/readiness,
untrusted redirects and separate native Keychain accounts. The public runtime
entry point is allowed only to core composition; desktop/domain/private-driver
imports remain rejected by architecture tests.

## Remaining acceptance

- Add acknowledged asynchronous install/start/stop/cancel controls to Fulcrum.
- Provision the local owner before enabling connections; preserve saved receipts
  through runtime stop/restart and clean up interrupted browser attempts.
- Rebuild and launch the updated native app; verify packaging/signing separately.
- Run the installed runtime on Apple Silicon and a clean macOS user account.
- Repeat actual source consent and inspect granted scopes where needed.
- Keep managed ingestion blocked until a no-full-body-retention execution path
  meets the source privacy contract. Connection readiness proves no importing,
  cursor recovery, token refresh, backfill or source-scope selection.
