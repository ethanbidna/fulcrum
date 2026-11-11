# ADR-0025: Isolate the Graphiti feasibility experiment

- Status: Accepted experiment boundary; Graphiti adoption not accepted
- Date: 2026-11-10
- Extends ADR-0004

Keep the native ContextIndex as the shipped implementation. An optional Python
3.12 Graphiti/FalkorDBLite spike may start its own temporary embedded graph
process solely for synthetic comparison. It does not add a product daemon,
database service, MCP server, model fallback or canonical write path.

Use explicit local inference/embedding clients, no hosted defaults, one model
request at a time, disabled telemetry and loopback route guards. The harness
never downloads models or touches another runtime. It deletes only temporary
indexes/owned child processes and records count-only measurements and failures.
Both implementations consume the same exported canonical snapshot and alias
queries. Expected answers are scoring data, never input to the model.

FalkorDBLite's BSD wrapper and its SSPL engine are distinct licensing questions.
Installation for an isolated experiment is not distribution approval. Its current
Intel wheel fails execution with bad CPU type; no-go on that configuration is
based on an actual store probe. Apple Silicon compatibility and local-model
cost/quality remain pending. No production Graphiti adapter is selected until
those results and the distribution obligations are reviewed at the checkpoint.
