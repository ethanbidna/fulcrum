# ADR-0032: Own the optional connector VM

- **Status:** Accepted for the runtime driver; desktop adoption pending
- **Date:** 2026-11-24
- **Refines:** [ADR-0030](0030-managed-connection-driver.md)

## Decision

Put installation, start, readiness and stop behind `ConnectorRuntime` in the
sources driver. Use Lima's maintained Apple Virtualization and rootless
containerd integration. Do not require Docker Desktop, a host Docker daemon,
privileged networking or changes to the user's container configuration.

This is an optional service under the architecture's connector boundary. The
application must remain usable without it. This driver is not started or
installed by production composition yet. The next adoption unit must add
explicit resource/download acknowledgement and asynchronous in-app controls,
provision the local owner before enabling connections, preserve opt-in across
restart, and stop the service on cancellation, shutdown or explicit stop.
No provider credentials or account grants are requested by the runtime probe.

Pin Lima, the Ubuntu LTS guest, nerdctl/containerd and the architecture-specific
Activepieces image. Verify Lima's archive size and SHA-256 before extraction;
Lima verifies its guest and containerd digests, and containerd pulls the immutable
image digest. There is no mutable image fallback. The catalog is maintained in
[the driver](../../packages/sources/src/managed/runtime/catalog.ts).

Keep private installation metadata and VM state in machine-local Application
Support, outside synced workspaces. The VM has two CPUs, 4 GiB RAM and a 20 GiB
sparse disk; require 24 GiB available storage before installation. This is a
configuration and admission threshold, not a measured hardware recommendation.
Use a separate Lima home, no host-folder mounts, no host SSH public-key import
or agent forwarding, no host-loopback access, one loopback connection-service
port and an explicit rule disabling other automatic port forwarding. Lima's
private loopback SSH transport remains necessary to administer the VM.

## Keys and ownership

Save generated encryption and JWT keys through the native secure-store
interface before creating a VM or container. Use Keychain service
`Fulcrum.Connector.Activepieces`, account `runtime-keys`, separate from
`local-runtime`, with device-only accessibility. Denied access is an error;
it must not be interpreted as missing keys. Existing installations with missing
or changed keys fail closed. Never generate replacement keys for their data.

Installation metadata contains an owner identifier, architecture, port, key
fingerprint and installed binary fingerprint, but no secret. Container and
volume labels must match the installation owner; the volume must also match
the key fingerprint. Refuse unknown instances, volumes, containers or modified
binaries. Installation, cancellation and retry preserve existing state; there
is no automatic reset, deletion or adoption of an old disposable spike VM.

Pass keys to the guest through stdin, create a restrictive temporary environment
file, and remove it after container creation. Keys are absent from process
arguments, preferences and portable workspace files. The container engine
retains environment values in its metadata inside the private VM; Keychain
storage does not mean the runtime never holds a disk copy. The VM's ordinary
machine-disk protections apply. Never expose container inspection output through
the desktop API or logs.

Readiness requires the exact Activepieces version, Community Edition and hosted
OAuth enabled, using a bounded response from the owned loopback origin. It is
not proof of a source connection, token refresh or ingestion.

## Privacy and validation limits

Hosted OAuth remains a disclosed, explicit source-connection choice under
ADR-0030. Telemetry is disabled. The runtime performs no source actions or
flow creation during installation. Full-body run/activity retention still
blocks managed ingestion; this decision does not change the product contract.

Synthetic lifecycle/security tests and the Intel installation evidence are
recorded in [S4 runtime results](../spikes/S4-results/managed-runtime.md).
ARM execution, native app composition, launch/signing and all new provider
grants remain separate checks. No persisted workspace schema changes.
