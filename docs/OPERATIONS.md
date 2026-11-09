# Local operation: modes, sleep/wake, resources, model install

> All thresholds and model choices on this page are **provisional starting values** for spike S2 to replace with measurements from a real 2019 Intel MacBook Pro and an Apple Silicon Mac.

## Operating modes

| Mode | What runs | Typical device |
|---|---|---|
| **Viewer/editor** | Core, UI, optional MCP. No connectors, no model. | Second Mac; any Mac before setup finishes. |
| **Ingestion — constrained** | + connectors + small model, extraction only; native ContextIndex; strict throttling. | 2019 Intel MacBook Pro. |
| **Ingestion — full** | + larger model, embeddings, optional Graphiti sidecar. | Apple Silicon with ≥16 GB. |
| **Paused** | Ingestion queue frozen; UI fully usable. | User toggle, battery, thermal, or fullscreen/presentation. |

All modes default to local inference, with no telemetry or app backend. Optional
hosted inference requires explicit provider/content-scope opt-in and a user API
key (ADR-0018); local failures never enable it automatically. Other traffic is
limited to opted-in source APIs, user-started model/runtime downloads and updates,
and an explicitly enabled MCP client.

## Sleep and wake

- A sleeping MacBook does no work. Fulcrum never claims otherwise.
- The Rust shell subscribes to `NSWorkspace` will-sleep/did-wake notifications and forwards them to the core.
- **Will sleep:** finish or abandon the current model call (no partial writes — an extraction result is only committed as a domain event), flush the queue to disk.
- **Did wake:** wait a short grace period (default 60 s) for network, then catch-up ([INGESTION.md](INGESTION.md#8-catch-up-after-sleep-or-days-offline)).
- Docked clamshell mode counts as awake. A dedicated always-on Mac can be designated the ingestion device later.
- Freshness label states: `Up to date as of 10:42` · `Catching up — 37 items` · `Local AI paused (on battery)` · `Slack needs reconnect` · `Last updated 3 days ago (this Mac was asleep)`.

## Resource policy

| Signal | Default action *(provisional)* |
|---|---|
| UI responsiveness | Model and index work run in the core / Ollama processes, never the UI thread. UI never awaits inference. |
| Concurrency | One extraction request at a time; Ollama `num_parallel=1`. |
| Process priority | Core worker and Ollama launched at reduced priority (`nice`/`taskpolicy -b` background QoS). |
| Battery | Pause extraction on battery below 50 % (Intel) / 30 % (Apple Silicon); user may override. "Only when plugged in" option. |
| Thermal | Pause when `ProcessInfo.thermalState` ≥ `.serious`; resume at `.fair`. |
| Memory | Before loading a model, require free+inactive memory ≥ model size × 1.5; otherwise stay paused with a reason. Unload model after 5 min idle (`keep_alive`). |
| Throughput cap | Intel constrained tier: ≤ 1 batch per 2 minutes. |
| User activity | Optional "Pause while I'm in a meeting / presenting". |

S2 must record CPU %, RSS, swap, fan/thermal state, tokens/s and JSON-validity rate per model tier and update this table.

The [S2 benchmark procedure](spikes/S2.md) supplies the synthetic extraction
runner and manual hardware checks. Recommendations remain pending until real
results are committed; the values here are not measured thresholds.

## Model tiers

Candidates only; profiles must identify purpose, runtime, quantization, model
digest, hardware measurements and accuracy-evaluation status. An installed or
fast model is not automatically accepted for extraction. [ADR-0018](decisions/0018-model-choice-and-setup.md)
supersedes the original automatic Llama 3B/1B fallback assumptions.

| Hardware | Provisional starting point | Acceptance still required |
|---|---|---|
| Intel / limited memory | User-selected compatible local candidate, background use, or optional hosted setup | No default extractor accepted; check latency/resources and accuracy |
| Apple Silicon, about 16 GB | Qwen3.5 4B as a smaller candidate | Comparable full extraction holdout and actual device test |
| Apple Silicon, about 24–32 GB+ | Llama 3.1 8B quantized candidate | Device test and semantic/accuracy review |

These are proposed profiles, not minimum RAM guarantees. A bounded synthetic
self-test checks local compatibility and responsiveness. The existing resource
policy remains in force. ContextIndex/Graphiti selection is independent.

## Model install (first run or Settings → AI)

The [onboarding flow](ONBOARDING.md#ai-selection-and-setup-p2-contract) owns model
choice, origin filters, license consent, managed runtime/download progress,
verification, cancellation/recovery and self-test. Local is the default; hosted
setup is a separate explicit path with Keychain credentials, sharing scope and
usage limits. No Terminal or manual model-pull command is required of end users.
No model weights or API keys are bundled or synced. Install records and provider
settings remain machine-local; runtime adapters stay behind public interfaces.

## Diagnostics

Settings → About → Diagnostics shows versions, mode, queue length, last pulls, model status, workspace sync health (torn tails, conflicted copies seen, online-only files), and offers "Copy diagnostics" — text with **no source content, names or paths** (paths replaced by `<workspace>`).
