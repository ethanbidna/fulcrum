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

The 49 stories cover the existing AI chooser, onboarding, settings, MCP settings, priorities, timeline, context and evidence components. Full application flows have their own unit checks and still require the owner walkthroughs. Local test results leave the pending owner boxes open. The detailed [P6 local verification](P6-local-verification.md) is proposed separately in #84.
