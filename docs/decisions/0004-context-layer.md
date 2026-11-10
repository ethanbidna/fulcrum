# ADR-0004: Canonical structured state is authoritative; Graphiti is an optional, rebuildable context index

- **Status:** Accepted (authority split) · Graphiti use **provisional** (S3)
- **Date:** 2026-11-07

## Context
The spec prefers Graphiti for temporal entity resolution, history and retrieval, but requires that it never be the only durable record and never own user-protected fields. Graphiti builds a temporal knowledge graph by calling an LLM several times per episode (entity extraction, deduplication, edge extraction, invalidation) and needs a graph database and embeddings. On a 3B model on Intel CPU this may be slow and error-prone.

## Decision
1. **Authority:** the workspace event log (initiatives, nodes, edges, sources, assertions, entities) is canonical. Assertions already carry temporal fields (`observedAt`, `validFrom`, `validTo`, `supersededBy`), so temporal history exists without Graphiti.
2. **Interface:** a `ContextIndex` (`ingest`, `resolveEntities`, `related`, `rebuild`).
3. **Default implementation: native** — SQLite tables for entities/aliases/externalIds, FTS5 over titles and excerpts, optional embeddings (e.g. `sqlite-vec`) when the model tier provides an embedder. Deterministic and cheap.
4. **Graphiti adapter:** offered in the full tier only if S3 shows acceptable quality and cost with local models and an acceptable graph store (license + maintenance). Its output is advisory input to the reconciler; it is rebuilt from sources + assertions and can be deleted at any time.

## Alternatives
- Graphiti as primary store — rejected: violates portability and protected-field rules.
- No context layer — rejected: entity resolution across aliases (scenario 6) needs one.

## Consequences
- Fulcrum works fully without Python or a graph database.
- If Graphiti is adopted, a Python sidecar is added only on the ingestion device.

## Validation (S3)
Graphiti + Ollama (OpenAI-compatible endpoint) + candidate stores on Intel and Apple Silicon: episodes/min, LLM calls/episode, RSS, dedup accuracy on synthetic alias fixtures, full rebuild time from the workspace.


## S3 engineering update (2026-11-10)

The [S3 comparison](../spikes/S3.md) now exports the same synthetic workspace
episodes to the production native index and an isolated Graphiti adapter. Native
passes seven alias/ambiguity/abstention cases without inference. The pinned
FalkorDBLite wheel fails execution on Intel (OS error 86); no Graphiti inference
or Apple Silicon result is claimed. Retain native as the shipping default.
[ADR-0025](0025-isolated-graphiti-experiment.md) permits only the optional spike;
its BSD wrapper does not accept the embedded SSPL engine for distribution.
Graphiti tier adoption remains provisional pending measurements and review.
