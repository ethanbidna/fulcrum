# ADR-0010: MIT license for repository code, docs and original assets

- **Status:** Accepted (approved by the owner, 2026-11-07)
- **Date:** 2026-11-07

## Context
The handoff asks for a permissive license after reviewing contents and dependencies. The repo contains original code, schemas, docs, synthetic fixtures and an original logo. Planned dependencies are MIT/Apache/ISC/public domain, plus ELK.js (EPL-2.0, used unmodified) and optional components (Graphiti Apache-2.0; graph stores with GPL/SSPL/MIT; Llama weights under the Llama Community License, never redistributed). See [LICENSING.md](../LICENSING.md).

## Decision
MIT for everything in this repository. Third-party notices are collected into the app bundle at packaging time.

## Alternatives
- Apache-2.0 — adds an explicit patent grant; slightly heavier. Reasonable if the owner prefers it.
- MPL-2.0 / GPL — not aligned with the "permissive" goal.

## Consequences
- Anyone may fork and reuse, including commercially.
- The logo is MIT-licensed along with the code; if the owner wants to restrict brand use, add a separate trademark note.
