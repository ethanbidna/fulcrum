# ADR-0020: native background admission

- **Status:** Accepted for implementation; hardware acceptance pending
- **Date:** 2026-11-10
- **Refines:** ADR-0009, ADR-0014 and ADR-0018

## Decision

The Rust shell owns an AppKit/IOKit driver for awake state, wake generation,
power, internal battery capacity, thermal state and free+inactive memory. It
forwards observations on a separate bounded worker through the authenticated
local socket. The webview and development bridge cannot send `system.observe`.
A latest-value mailbox bounds work; a wake generation preserves wake detection
when intermediate sleep observations are coalesced. Closing the Mac window hides
it while the shell continues observations; Dock reopen restores it. Explicit
Quit stops observations. No identifiers or content
are collected. AppKit stays on its main run loop; socket/Keychain calls do not.

The core owns a pure admission policy. Missing, malformed, backward-clock or
stale observations never grant permission. The shell publishes every five
seconds; a fifteen-second silence pauses work. Wake waits sixty seconds.
Source work pauses for sleep, thermal, power, presentation and user controls;
model admission additionally requires a supplied model-size profile, memory
headroom and the Intel batch interval. Defaults remain OPERATIONS' provisional
values. No headless native observer or new daemon is introduced: closing the
shell leaves ingestion paused after its observation lease expires.

`background.configure` and `status.background` are authenticated device-control
operations. These session settings configure a scheduler; they do not mutate
canonical workspace records. They are not MCP tools or model-selectable actions.
Startup configuration and direct trusted controls are supported; persistent
settings and their UI belong to P4. Canonical designation and AI writes still
require Domain.execute. No persisted schema changes.

Pause aborts the current request and leaves its durable queue item pending.
A callback must honor cancellation before an atomic domain write; aborting a
JavaScript promise cannot revoke an already committed event or forcibly stop
arbitrary callback code. No unattended reconciliation consumer is enabled here;
the handover defect tracked by #63 remains a separate gate. Freshness stays
paused/catching-up/awaiting-extraction while pending work exists.

The core reduces its own priority before opening an ingestion host. Failure
pauses ingestion while keeping editing available. Model requests serialize
within the core by endpoint, use four inference threads and explicitly request
five-minute idle retention. An explicit managed-runtime driver launches a new
Ollama at background QoS with one server slot and one loaded model. It never
changes an existing server's priority or environment. P2 will own installation
and normal managed launch; current production ingestion remains opt-in/off.
Requests to externally managed servers cannot configure their server-wide
parallelism or priority. Cancellation-to-CPU-idle is a hardware measurement,
not a property established by abort-contract tests.

For the disposable native review only, debug builds accept an absolute
`FULCRUM_DEV_PROFILE`; release builds retain ADR-0014's fixed profile. The same
owner/mode/socket/Keychain validation applies. The review harness uses synthetic
content, no real connector and no reconciliation writes. It refuses an occupied
review model port and never downloads weights.

## Evidence and limits

Automated policy/queue/runtime/core tests cover admission, cancellation, stale
signals, independent queries, authenticated controls and honest freshness.
Native payload tests and Intel/ARM CI cover compilation, not hardware behavior.
The Intel scenario 12 checklist in [P3 review](../reviews/P3.md) must record
CPU/RSS/swap/thermal, actual sleep/wake and pause responsiveness. Thresholds,
model quality, signing, production runtime management and other pending spikes
are not accepted by this decision.

Implementation follows Apple's [workspace notifications](https://developer.apple.com/documentation/appkit/nsworkspace),
[thermal notifications](https://developer.apple.com/documentation/foundation/processinfo/thermalstatedidchangenotification)
and [IOKit power notifications](https://developer.apple.com/documentation/iokit/1523868-iopsnotificationcreaterunloopsou).
Ollama documents [server concurrency](https://docs.ollama.com/faq) separately
from the chat API's [keep_alive](https://docs.ollama.com/api/chat) parameter.
