# Local operation: modes, sleep/wake, resources, model install

> All thresholds and model choices on this page are **provisional starting values** for spike S2 to replace with measurements from a real 2019 Intel MacBook Pro and an Apple Silicon Mac.

## Operating modes

| Mode | What runs | Typical device |
|---|---|---|
| **Viewer/editor** | Core, UI, optional MCP. No connectors, no model. | Second Mac; any Mac before setup finishes. |
| **Ingestion — constrained** | + connectors + small model, extraction only; native ContextIndex; strict throttling. | 2019 Intel MacBook Pro. |
| **Ingestion — full** | + larger model, embeddings, optional Graphiti sidecar. | Apple Silicon with ≥16 GB. |
| **Paused** | Ingestion queue frozen; UI fully usable. | User toggle, battery, thermal, or fullscreen/presentation. |

All modes are local-only: no hosted inference, no telemetry, no app backend. The only network traffic is to the user's opted-in source APIs, model downloads the user starts, and (if enabled) an MCP client the user runs.

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

Candidates only — the Llama models are under the Meta Llama Community License, downloaded through Ollama on the user's request, never bundled ([LICENSING.md](LICENSING.md)).

| Hardware (detected) | Starting candidate | ContextIndex | Notes |
|---|---|---|---|
| Intel, 8 GB | none by default; offer viewer mode or 1B | native | Likely too constrained; S2 decides. |
| Intel, 16 GB+ (target) | Llama 3.2 3B instruct, 4-bit | native | 1B fallback if 3B swaps or is too slow. |
| Apple Silicon, 8 GB | Llama 3.2 3B instruct, 4-bit | native | |
| Apple Silicon, 16 GB+ | Llama 3.1 8B instruct, 4-bit | native or Graphiti | Graphiti only if S3 passes. |

The app stores the selected model **by tested capability tag**, not just name, so a future model can be swapped in after passing the same extraction eval set.

## Model install (first run or Settings → Local AI)

1. Detect architecture, RAM, macOS version, free disk.
2. Detect Ollama (`127.0.0.1:11434/api/version`). If missing, explain in one sentence and offer to download the official Ollama app (opens the vendor page; Fulcrum does not silently install software). Bundling the Ollama binary is a later productization option.
3. Show the model's license summary and link; require the user to accept before download.
4. Pull the tier's model with progress, pause/resume and disk-space check.
5. Run a 30-second self-test on synthetic text: JSON validity and latency. Show the result honestly ("Works, but slow on this Mac — Fulcrum will process in the background while plugged in").
6. If anything fails: plain-language reason + Retry + "Continue without local AI" (viewer mode).

## Diagnostics

Settings → About → Diagnostics shows versions, mode, queue length, last pulls, model status, workspace sync health (torn tails, conflicted copies seen, online-only files), and offers "Copy diagnostics" — text with **no source content, names or paths** (paths replaced by `<workspace>`).
