# Documentation index

Start with the [product spec](PRODUCT_SPEC.md) (authoritative), then [architecture](ARCHITECTURE.md).

- Product: [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [DESIGN_RULES.md](DESIGN_RULES.md)
- System: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_MODEL.md](DATA_MODEL.md) · [WORKSPACE_FORMAT.md](WORKSPACE_FORMAT.md) · [DOMAIN_COMMANDS.md](DOMAIN_COMMANDS.md)
- Runtime: [INGESTION.md](INGESTION.md) · [OPERATIONS.md](OPERATIONS.md) · [MCP.md](MCP.md)
- Trust: [SECURITY_MODEL.md](SECURITY_MODEL.md) · [LICENSING.md](LICENSING.md)
- Delivery: [ONBOARDING.md](ONBOARDING.md) · [RISKS.md](RISKS.md) · [SCENARIOS.md](SCENARIOS.md) · [../backlog/BACKLOG.md](../backlog/BACKLOG.md)
- Decisions: [decisions/](decisions)

| ADR | Decision | Status |
|---|---|---|
| [0001](decisions/0001-desktop-shell.md) | Tauri shell; UI developed browser-first | Accepted; packaging provisional |
| [0002](decisions/0002-integration-boundary.md) | SourceAdapter interface; Activepieces is a candidate | Provisional |
| [0003](decisions/0003-local-model-runtime.md) | Meta Llama via Ollama, hardware-tiered | Provisional |
| [0004](decisions/0004-context-layer.md) | Canonical state authoritative; Graphiti optional index | Accepted; Graphiti provisional |
| [0005](decisions/0005-portable-workspace-event-log.md) | Per-device event logs + checkpoints; SQLite local cache | Accepted; sync provisional |
| [0006](decisions/0006-single-ingestion-device.md) | One ingestion device per workspace | Accepted |
| [0007](decisions/0007-local-mcp-security.md) | Local stdio MCP, off by default, scoped | Accepted; client behavior provisional |
| [0008](decisions/0008-schema-source-of-truth.md) | JSON Schema is the contract | Accepted |
| [0009](decisions/0009-core-process-and-language.md) | Single TypeScript core process per Mac | Accepted; packaging provisional |
| [0010](decisions/0010-license.md) | MIT | Accepted |
