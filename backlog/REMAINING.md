# Remaining work

Updated November 10, 2026. Current work is **integrating the model benchmark and experiment reviews**.

The detailed plan and owner procedures live in [PROGRESS.md](PROGRESS.md). Update this checklist in each follow-up PR, link its evidence, and push each completed task. An owner acceptance checkbox is completed by the owner after its procedure.

## Completed in the latest batch

- [x] Fix the documented development startup failure with a regression test. [#86](https://github.com/ethanbidna/fulcrum/pull/86)
- [x] Verify encryption, native tests and Intel production executables. [#84](https://github.com/ethanbidna/fulcrum/pull/84)
- [x] Run schema/lint/typecheck, reference/workspace tests, 49 Storybook checks and release license generation. [#85](https://github.com/ethanbidna/fulcrum/pull/85)
- [x] Exercise durable edits, History undo, command review/apply/undo, question answer/defer and narrow-screen behavior. [#87](https://github.com/ethanbidna/fulcrum/pull/87)
- [x] Publish the model experiment review, normalized outputs, scores and trace hashes. [#44](https://github.com/ethanbidna/fulcrum/pull/44)

## Next engineering work

- [ ] Review and integrate the original benchmark results and experiment branch, resolve conflicts with current main, run the required checks, and merge the engineering artifacts. [#43](https://github.com/ethanbidna/fulcrum/pull/43), [#44](https://github.com/ethanbidna/fulcrum/pull/44)
- [ ] Freeze a broader Qwen3.5 evaluation protocol and new case coverage using the observed attribution, dependency, state, multiple-fact and mixed-attack failures.
- [ ] Run the frozen candidate evaluation locally with saved requests, runtime identity, native thermal monitoring and explicit budget/incomplete counts.
- [ ] Replay and inspect those results, then publish an adoption recommendation with resource and quality limits.

## Feasibility and hardware acceptance

- [ ] Step 1 — Run the two-Mac local/Dropbox/Drive sync matrix. Requires a second Mac or macOS VM.
- [ ] Step 3 — Review the model labels and finish battery, responsiveness, pause and available Apple Silicon checks.
- [ ] Step 4 — Record controlled Intel/Apple Silicon packaging and universal-app measurements.
- [ ] Step 5 — Complete the actual Claude Desktop shim and confirmation checks.
- [ ] Step 6 — Supply throwaway Slack/Google accounts and OAuth apps, run live probes, and choose the Activepieces execution route.
- [ ] Step 8 — Resolve Graphiti store availability and record the supported-hardware/model comparison or the decision to defer it.
- [ ] Step 31 — Complete native Intel power, sleep/wake, pause-to-idle and resource observations.
- [ ] Step 9 — Complete the final feasibility/adoption checkpoint after the recorded results.

## Product review

- [ ] Step 16 — Review the native app shell and navigation.
- [ ] Step 17 — Review the portfolio.
- [ ] Step 18 — Review the flow canvas and relationship editing.
- [ ] Step 19 — Review inspector and focused-task behavior.
- [ ] Step 19a — Review the command bar, model-generated proposals and undo.
- [ ] Step 20 — Use List and History for about a week and record issues.
- [ ] Step 29 — Review Questions Center usability.

## Connector and release work

- [ ] Step 25 — Implement and exercise the first real connector after step 6 supplies the selected execution route.
- [ ] Step 37 — Configure the GitHub release environment, Developer ID/notary credentials, updater keys and provisioning profile. Build and test the signed universal release and signed update.
- [ ] Step 34 — Complete clean-user onboarding and managed download/cancel/retry checks with the signed build.
- [ ] Step 33 — Test packaged Claude Desktop installation, sharing scopes, writes and headless startup.
- [ ] Step 36 — Test signed Keychain/recovery/lock/rotation/restore and encrypted two-Mac sync.

The release environment was absent at the last check. The 12-case Qwen3.5 development result leaves model adoption pending. The original progress tracker has 19 waiting-owner steps and step 25 blocked.
