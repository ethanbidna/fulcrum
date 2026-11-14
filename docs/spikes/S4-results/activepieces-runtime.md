# Activepieces runtime on Intel macOS

On November 13, 2026, Activepieces Community Edition 0.93.0 ran in a
temporary Lima 2.3.0 VM on Intel macOS 15.7.9. The VM used Apple
Virtualization, two vCPUs, 4 GiB RAM, a 20 GiB sparse disk, and rootless
Docker Engine 29.9.3. It had no host folders mounted. The app and worker
shared a single container with PGLite and an in-memory queue. The UI
listened on loopback. Telemetry, hosted OAuth and piece metadata syncing
were disabled. The combined image needed local encryption and JWT keys
to start. The UI and flags endpoint returned HTTP 200, and the worker
connected and polled for jobs.

The [official amd64 image](https://github.com/activepieces/activepieces/pkgs/container/activepieces)
was pinned to digest
`sha256:6ed79f941fd41a8ab03ca659581191210a66512de52f7d623817f88deb715db7`.

| Measurement | Result |
| --- | ---: |
| Idle container memory, 10 `docker stats` samples | 1.041–1.042 GiB |
| Highest sampled container memory during a synthetic code step | 1.251 GiB |
| macOS Virtualization process physical footprint, `vmmap -summary` | 4.0 GiB |
| Lima host agent and SSH, summed idle RSS | 181,936 KiB |
| Image size reported by Docker | 2,364,660,176 bytes (2.20 GiB) |
| Container writable layer, idle / after test | 40,960 / 8,761,344 bytes |
| Allocated data volume, idle / after test | 34,280 / 34,776 KiB |
| Allocated VM instance directory after test | 5,403,900 KiB (5.15 GiB) |

Container memory is measured inside the VM. The macOS physical footprint
already accounts for guest memory. The VM directory includes the guest
system and Docker data. It excludes Lima's download cache and binaries.
These figures describe this VM configuration.

A synthetic code step used a local test account and returned a
`SUCCEEDED` run status. The sample-data endpoint did not return the
expected count, so output verification remains open. This run sampled
worker activity without Gmail credentials.

The [Gmail OAuth definition at 0.93.0](https://github.com/activepieces/activepieces/blob/0.93.0/packages/pieces/community/gmail/src/lib/auth.ts)
requests send, compose and modify alongside read-only access. The
[platform OAuth app override](https://www.activepieces.com/docs/admin-guide/guides/manage-oauth2)
and [private piece upload](https://www.activepieces.com/docs/admin-guide/guides/manage-pieces)
are documented paid features. Live Gmail OAuth, refresh, backfill and
incremental sync were left untested in this runtime. A Community Edition
deployment of a custom read-only piece was not verified. Slack did not
run in this comparison.

The separate [Fulcrum desktop probe](gmail-desktop.md) already completed
read-only Gmail OAuth, backfill and incremental sync. Its development
server reached 174.3 MiB sampled RSS during the one-message backfill.
That process RSS and the container memory above use different methods.
The results favor continuing with direct piece execution for the first
Gmail connector. [ADR-0027](../../decisions/0027-gmail-piece-execution.md) records that choice.
