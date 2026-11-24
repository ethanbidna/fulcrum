export type RuntimeArchitecture = 'x64' | 'arm64';
export const LIMA_VERSION = '2.3.0';
export const ACTIVEPIECES_VERSION = '0.93.0';
export const VM_NAME = 'v';
export const CONTAINER_NAME = 'fulcrum-connections';
export const CONTAINER_NAMESPACE = 'fulcrum';
export const DATA_VOLUME = 'fulcrum-data';
export const CONTAINER_MEMORY = '3g';
export const VM_MEMORY_BYTES = 4 * 1024 ** 3;
export const VM_DISK_BYTES = 20 * 1024 ** 3;
export const REQUIRED_FREE_DISK_BYTES = 24 * 1024 ** 3;
export const VM_CPUS = 2;
export const GUEST_PORT = 8080;
export const RUNTIME_RELEASES = {
  x64: {
    lima: { url: 'https://github.com/lima-vm/lima/releases/download/v2.3.0/lima-2.3.0-Darwin-x86_64.tar.gz', bytes: 37793345, digest: 'd58bc7d6b8158d638720d8c8fdb17eb58527dfead6a29a5b60f48a35ee4a65a6' },
    guest: { location: 'https://cloud-images.ubuntu.com/releases/resolute/release-20261016/ubuntu-26.04-server-cloudimg-amd64.img', arch: 'x86_64', digest: 'sha256:5645d0318ad21f643ebb1ac4567514620e9893380b07b0201fda163baa5b7eb5' },
    containerd: { location: 'https://github.com/containerd/nerdctl/releases/download/v2.4.2/nerdctl-full-2.4.2-linux-amd64.tar.gz', arch: 'x86_64', digest: 'sha256:1f12c1a5840744fdf7029483c55a69813d44aa2ec1ef879d52d81ff6a3049ecd' },
    image: 'ghcr.io/activepieces/activepieces@sha256:6ed79f941fd41a8ab03ca659581191210a66512de52f7d623817f88deb715db7',
  },
  arm64: {
    lima: { url: 'https://github.com/lima-vm/lima/releases/download/v2.3.0/lima-2.3.0-Darwin-arm64.tar.gz', bytes: 50317981, digest: 'b7af444bd8f91d3c307477e562f2cf3bd7595d62b9429185e4fa841563578cfc' },
    guest: { location: 'https://cloud-images.ubuntu.com/releases/resolute/release-20261016/ubuntu-26.04-server-cloudimg-arm64.img', arch: 'aarch64', digest: 'sha256:8eb876c2ccc4b6ff89e4a65d511815923b285e04503ba465809bf587f763da24' },
    containerd: { location: 'https://github.com/containerd/nerdctl/releases/download/v2.4.2/nerdctl-full-2.4.2-linux-arm64.tar.gz', arch: 'aarch64', digest: 'sha256:fe0ef0e9840ee8932640e6058f84b7fa98050f9726e44af44883a5b804ae830e' },
    image: 'ghcr.io/activepieces/activepieces@sha256:6d7ffae22f1360b3906cf4394a0a09aba6b06a91271c3960338606be79b26fc0',
  },
} as const;

export function vmConfiguration(architecture: RuntimeArchitecture, port: number): string {
  const release = RUNTIME_RELEASES[architecture];
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_runtime_port');
  return JSON.stringify({ vmType: 'vz', arch: release.guest.arch, images: [release.guest],
    cpus: VM_CPUS, memory: '4GiB', disk: '20GiB', mounts: [],
    containerd: { system: false, user: true, archives: [release.containerd] },
    ssh: { loadDotSSHPubKeys: false, forwardAgent: false },
    networkOpts: { hostLoopback: false }, propagateProxyEnv: false,
    portForwards: [ { guestIP: '127.0.0.1', guestPort: GUEST_PORT, hostIP: '127.0.0.1', hostPort: port },
      { guestIP: '0.0.0.0', guestPortRange: [1, 65535], proto: 'any', ignore: true } ],
  });
}
