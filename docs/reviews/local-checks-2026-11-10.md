# Independent local checks — 2026-11-10

Tested source tree 3d2e9dd, merged by bc078f7, on Intel macOS 15.7.9 with Node 22.23.4 and pnpm 10.11.0. All data was synthetic and all workspace mutation used disposable local fixtures.

| Check | Actual result | Acceptance still pending |
| --- | --- | --- |
| Schema generation, lint, TypeScript and full reference/unit suite | Passed. 79 reference tests and 556 workspace tests. One existing S1 reference-reader TODO. | Owner usability and external acceptance |
| Storybook UI suite | UI typecheck, 49 component interactions and static build passed. All 49 stories checked for accessibility with zero reported violations. | Native dialogs, full application usage and owner review |
| S1/S4/S6 focused reference run | 31 tests passed, one existing S1 TODO. Real MCP SDK stdio subprocesses and mocked connector probes passed. | Two-Mac Dropbox/Drive, real Slack/Gmail OAuth and Activepieces execution, actual Claude Desktop |
| Native desktop Rust suite | All seven tests passed with Unix socket permission. | Native visible-window behavior, signed credentials, sleep/wake and Apple Silicon |
| Intel production SEA core and MCP | Both rebuilt. Both returned schema, FTS5 and encryption self-test success. | Universal signed/notarized application, clean-user launch and signed update |
| Release license notices | Generated successfully, auditing 340 package entries and the exact Node 22.23.4 license. | Inspection of the actual signed distribution |

The first sandboxed full and native runs denied local socket operations. They were repeated with socket permission and passed. License generation initially could not resolve the Node license host inside the sandbox, then passed with network permission. The Storybook server was already listening on its documented loopback port, so the test CLI reused it. The component suite did not report accessibility violations. The static workshop build emitted chunk-size and third-party module-directive warnings.

Reproduce with the repository toolchain and an available Storybook server.

```sh
pnpm check
pnpm check:ui
node --test tools/test/s1.test.mjs tools/test/s4.test.mjs tools/test/s6.test.mjs
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node tools/release/sea.mjs /tmp/fulcrum-release-verification
node tools/release/notices.mjs /tmp/fulcrum-release-verification/THIRD_PARTY_NOTICES.txt
```

The 49 stories cover the existing AI chooser, onboarding, settings, MCP settings, priorities, timeline, context and evidence components. Full application flows have their own unit checks and still require the owner walkthroughs. Local test results leave the pending owner boxes open. The detailed [P6 local verification](https://github.com/ethanbidna/fulcrum/pull/84) is proposed separately in #84.


## Complete application browser checks

A separate disposable file-backed core and Chromium browser exercised the same merged application UI. The preview used its own loopback port and Vite cache to coexist with the existing Storybook server.

- A List title edit survived page reload and appeared with its before/after values in History. History undo restored the original title.
- The deterministic rename command showed its proposal before any mutation. Explicit Apply changed the same List title, and Undo command restored it. This path ran without inference.
- A contextual question answer removed the question from the open list. The status Undo restored it. Indefinite deferral then appeared in the Deferred filter with its original context.
- At a 390-pixel viewport, the deferred Questions view measured a 390-pixel body with no horizontal overflow. The synthetic capture was inspected.
- Chromium reported no uncaught application errors during these actions.

The first test selectors expected only the confirmation text and an exact label. Playwright includes the status button text and select options in those names. Retesting with the full status and combobox names passed.

The separate startup issue discovered before this walkthrough is fixed in [#86](https://github.com/ethanbidna/fulcrum/pull/86). Its regression failed with the original parser import error, then passed. The full suite with that test passes 79 reference and 557 workspace tests. The walkthrough is an agent check of synthetic data. The owner's week-long usage and native reviews remain pending.

## Release environment prerequisite

The GitHub environment list returned an empty array on November 10. The configured workflow requires a named `release` environment. Secret and variable metadata requests for that environment returned 404. Follow [the P5 release procedure](P5.md#owner-release-procedure) to configure the environment, signing/notary credentials, updater keys and P6 provisioning profile before dispatching a signed build. No credential values were retrieved.
