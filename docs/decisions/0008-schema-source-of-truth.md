# ADR-0008: JSON Schema is the data contract; TypeScript types are generated

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The same records are read by the TypeScript core, the UI, MCP tool definitions, and possibly a Python context sidecar. Fixtures and on-disk files must be checkable by any tool.

## Decision
- `schemas/v<N>/*.schema.json` (draft 2020-12) are canonical.
- TypeScript types are generated (`json-schema-to-typescript` or equivalent) into `packages/schema`; generated files are committed and CI fails if regeneration produces a diff.
- Runtime validation uses Ajv with the same files. MCP tool input schemas are derived from them.
- Zod or other runtime-type libraries may be used inside the UI for forms, but never as a second source of truth for persisted data.

## Consequences
- Language-neutral contract; fixtures validated in CI today (`npm test`).
- Some TypeScript ergonomics (discriminated unions) depend on generator quality; acceptable, or hand-write thin wrappers that are type-checked against the generated types.
