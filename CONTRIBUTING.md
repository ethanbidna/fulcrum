# Contributing

Fulcrum is an early-stage personal project. Issues and pull requests are welcome, but the product scope is deliberately narrow — please read the [product spec](docs/PRODUCT_SPEC.md) non-goals before proposing features.

## Before you start
- Pick an item from the [backlog](backlog/BACKLOG.md) or open an issue describing the problem first.
- Feasibility spikes (M0) come before UI feature work.
- Changing a recorded decision means adding or superseding an ADR in `docs/decisions/` in the same PR.

## Development
Requires Node 22+.

```bash
npm install
```

```bash
npm test
```

The app itself does not exist yet; build instructions will be added with backlog item C1.

## Pull request checklist
- [ ] Linked backlog item or issue; acceptance criteria listed and checked.
- [ ] Tests added or updated; `npm test` passes.
- [ ] Spec invariants respected (see [AGENTS.md](AGENTS.md#product-invariants-you-must-not-break)).
- [ ] Schemas changed only with a version/upcaster plan.
- [ ] **No private data:** no real names, emails, messages, company content, tokens, `.env` files, device paths, screenshots of real data, or model weights. Fixtures are synthetic.
- [ ] No copyrighted third-party artwork or logos.
- [ ] Commit messages: subject ≤ 50 chars, imperative mood, no period; body explains what and why.

## Code style
See [AGENTS.md](AGENTS.md#code-standards). In short: named constants, small functions, guard clauses, descriptive names, comments that explain why.

## License
By contributing you agree that your contributions are licensed under the repository's [LICENSE](LICENSE).
