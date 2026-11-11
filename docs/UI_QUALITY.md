# UI quality with Storybook 11 beta

The root workshop uses Storybook 11.0.0-beta.1 with the existing desktop React
and Vite versions. Vitest 4.1.12 matches the workshop browser provider; the unit
suite stays a separate project. Use Node 22.13+ LTS and pnpm 10.11.0.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm storybook
pnpm storybook:tools -- docs list
pnpm check
pnpm check:ui
```

The workshop binds to loopback and disables telemetry. It imports real product
components and synthetic public-domain/transport fixtures; no real services,
credentials or workspace drivers. `pnpm test` runs reference and unit tests;
`pnpm check:ui` typechecks, runs browser interactions/accessibility through the
Storybook CLI, and builds the static workshop. Native behavior remains separate.

Add normal, empty, loading, unavailable and relevant long-content stories for
changed components, with keyboard interactions for controls. Use the official
ui-workflow and component-docs skills. Discover story IDs through docs list or
stories changed; publish a local review after visible changes.

Keep product and design invariants in PRODUCT_SPEC.md and DESIGN_RULES.md.
A browser test is not a hardware, connector, model, sync or packaging pass.
