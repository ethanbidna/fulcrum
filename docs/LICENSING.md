# Licensing notes

> Not legal advice. License facts below reflect the projects' published licenses as understood in November 2026 and **must be re-verified** when a dependency is actually added (backlog item: license audit before first release).

## This repository

License: **MIT** ([ADR-0010](decisions/0010-license.md)). Rationale: the repo contains only original code, docs, schemas, synthetic fixtures and an original logo; no planned dependency is copyleft-linked into distributed code in a way MIT conflicts with (see EPL note).

## Planned dependencies

| Component | License | How used | Notes |
|---|---|---|---|
| Tauri | MIT or Apache-2.0 | App shell | — |
| React, Vite | MIT | UI | — |
| React Flow (`@xyflow/react`) | MIT | Canvas | Pro features not needed. |
| ELK.js | EPL-2.0 | Layout, unmodified npm dependency | Weak copyleft applies to modifications of ELK itself; using it unmodified alongside MIT code is fine. Include its notice. |
| vis-timeline | Apache-2.0 or MIT | Optional | Only if adopted. |
| Ajv, ajv-formats | MIT | Schema validation | — |
| SQLite | Public domain | Local index | — |
| MCP TypeScript SDK v2 | Apache-2.0 | MCP shim spike | Server/client 2.4.0; include their license and retain any supplied notices when distributing. |
| Ollama | MIT | Separate app the user installs (or bundled later) | If bundled, include its license. |
| Meta Llama 3.x weights | Llama Community License + Acceptable Use Policy (not OSI open source) | Downloaded by the user via Ollama; **never** in git or the app bundle | User accepts the license in the wizard. If ever redistributed: license copy, "Built with Llama" attribution, AUP. |
| Graphiti | Apache-2.0 | Optional sidecar | NOTICE file if bundled. |
| Graph store for Graphiti | Neo4j Community: GPLv3 · FalkorDB: SSPL · Kuzu: MIT (upstream reported archived in 2025 — verify) | Optional | GPL/SSPL servers run as separate processes are not linked, but bundling them changes distribution obligations; S3 must pick a store whose license and maintenance status are acceptable. |
| Activepieces | Community edition MIT; enterprise directory under a commercial license | Optional connector runtime or pieces as libraries | Use only MIT-licensed parts; verify each piece's license. |
| Icons | Lucide (ISC) suggested | UI | — |
| Fonts | System font stack (SF Pro via `-apple-system`) | UI | Do not bundle SF Pro (Apple license forbids redistribution). If a bundled font is needed, use an OFL font (e.g. Inter). |

## Assets

- `assets/fulcrum-mark.svg` — original geometric mark created for this project (beam on a triangular pivot, point above). Released under the repository license.
- No Star Wars names, insignia, fonts or artwork anywhere in the repo, app or marketing.

## P5 generated release notices

`tools/release/notices.mjs` audits the production JavaScript dependency closure,
filtered macOS Cargo closure and exact-version Node runtime notices. Unknown
license expressions or absent notice text fail the release job. It includes
upstream license/notice text, source archive URLs and metadata attributions;
`tools/release/licenses/overrides.json` pins supplemental upstream texts by
package version and hash for crates that omit them. ELK's EPL-2.0 option is used;
its exact published source URL remains in the bundle. MPL dependencies likewise
retain source URLs. No dependency is modified. Re-review overrides when updating
those packages. This automates inventory, not legal approval of future licenses.

P2 downloads Ollama/weights only after explicit consent; P5 does not redistribute
them. Graphiti/FalkorDB are not included. The system font remains unbundled.
