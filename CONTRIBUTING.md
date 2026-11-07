# Contributing

Fulcrum is an early-stage personal project. Issues and pull requests are welcome, but the product scope is deliberately narrow — please read the [product spec](docs/PRODUCT_SPEC.md) non-goals before proposing features.

## Before you start
- Pick an item from the [backlog](backlog/BACKLOG.md) or open an issue describing the problem first.
- Feasibility spikes (M0) come before UI feature work.
- Changing a recorded decision means adding or superseding an ADR in `docs/decisions/` in the same PR.

## Development
Requires Node 22.13+ (22 LTS), 24 LTS, or 26+. Use the pnpm version pinned in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
```

```bash
pnpm check
```

Commands from the repository root:

- `pnpm test` (or `npm test`): reference Node tests and all workspace Vitest tests.
- `pnpm test:reference`: the existing reference model and S1 simulations.
- `pnpm typecheck`: strict TypeScript, including generated public type checks.
- `pnpm lint`: TypeScript lint and architecture import boundaries.
- `pnpm schema:generate`: regenerate committed types from `schemas/v1`.
- `pnpm schema:check`: fail if committed types differ from regeneration.
- `pnpm check`: all checks above, without modifying generated files.

The workspace directories are scaffolds; there is no runnable app or packaged build yet. Add tests as `*.test.ts` within an app/package; the root Vitest configuration discovers them automatically.

Import other workspace packages by their public `@fulcrum/<name>` entry point and declare them with `workspace:*` in the importing package. Relative imports stay inside their package. Schema imports are type-only. Domain imports only schema types and type-only `store/interfaces` or `index/interfaces`; ingestion additionally uses domain commands and type-only driver interfaces. Desktop and MCP use domain and schema. Drivers cannot import domain. Pure layers reject external runtime modules and I/O globals. Interfaces live in separate `src/interfaces.ts` entry points; do not re-export implementations there.

`packages/schema/src/generated.ts` is generated; its public names are exported from `src/index.ts`. JSON Schema and Ajv remain the runtime authority: TypeScript does not express every JSON Schema constraint (including conditional requirements, formats, and `unevaluatedProperties`). The generator preserves unconstrained event values as `unknown`. Never hand-edit generated output or alter a persisted schema without a version plan.

## Pull request checklist
- [ ] Linked backlog item or issue; acceptance criteria listed and checked.
- [ ] Tests added or updated; `pnpm check` passes.
- [ ] Spec invariants respected (see [AGENTS.md](AGENTS.md#product-invariants-you-must-not-break)).
- [ ] Schemas changed only with a version/upcaster plan.
- [ ] **No private data:** no real names, emails, messages, company content, tokens, `.env` files, device paths, screenshots of real data, or model weights. Fixtures are synthetic.
- [ ] No copyrighted third-party artwork or logos.
- [ ] Commit messages: subject ≤ 50 chars, imperative mood, no period; body explains what and why.

## Code style
See [AGENTS.md](AGENTS.md#code-standards). In short: named constants, small functions, guard clauses, descriptive names, comments that explain why.

## License
By contributing you agree that your contributions are licensed under the repository's [LICENSE](LICENSE).
