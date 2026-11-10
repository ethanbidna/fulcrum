# ADR-0003: Meta Llama via Ollama, hardware-tiered, behind a ModelRuntime interface

- **Status:** Superseded by [ADR-0018](0018-model-choice-and-setup.md) and
  [ADR-0023](0023-guided-setup-boundaries.md); no model tier accepted
- **Date:** 2026-11-07

## Context
The user chose Meta Llama, run locally. The baseline device is a circa-2019 Intel MacBook Pro (no Metal acceleration in practice for llama.cpp on Intel; CPU inference). Apple Silicon is the better-performing target. No content may go to hosted AI by default.

## Decision
- Runtime: **Ollama** (MIT), talking HTTP on `127.0.0.1`. It handles model download, quantized formats, memory management and `keep_alive` unloading, and supports JSON-schema-constrained output.
- `ModelRuntime` interface (`status`, `extract(prompt, schema)`, optional `embed`) so llama.cpp server or MLX can replace Ollama without touching the pipeline.
- Starting tiers in [OPERATIONS.md](../OPERATIONS.md#model-tiers): Intel 16 GB → Llama 3.2 3B 4-bit (1B fallback); Apple Silicon 16 GB+ → Llama 3.1 8B 4-bit.
- Model use is limited to **extraction into a closed schema**, not open-ended generation, so small models have the best chance.
- Weights are downloaded by the user through Ollama after accepting the Llama license; never in git or the app bundle.

## Alternatives
- llama.cpp server embedded by Fulcrum — fewer moving parts for the user but we take on model management; reconsider when bundling.
- MLX — Apple Silicon only; not usable on the Intel baseline.
- Hosted models — excluded by spec (opt-in only via a user's own MCP client).

## Consequences
- Users install Ollama (guided) until we decide to bundle it.
- Extraction quality is the dominant product risk (R1, R2); everything AI writes is evidence-linked and undoable.

## Validation (S2)
The [benchmark harness and procedure](../spikes/S2.md) record initial and
after-repair extraction scores, model digests, timing and sampled resources.
Target hardware runs and manual pause/responsiveness checks are pending. This
historical ADR is superseded; no model tier is accepted from mock tests.

On the real Intel Mac and one Apple Silicon Mac: tokens/s, RSS, swap, thermal state, battery draw, JSON validity rate and candidate precision/recall on a synthetic eval set built from `fixtures/`.


## Engineering checkpoint (2026-11-10)

ADRs 0018/0023 replace the historical fixed Llama tiers, manual installation
and hosted exclusion below. AI starts off; guided setup requires explicit
terms and optional hosted scope/budget. No extraction tier or automatic model
fallback is accepted from a compatibility test. S2 hardware/quality remains open.
See [ADR-0026](0026-engineering-checkpoint.md) and [the evidence matrix](../CHECKPOINT.md).
