# U4a command bar review

## Agent evidence

- Owner explicitly requested both inline AI commands and external MCP, with less
  dependence on dropdowns and buttons. ADR-0017 updates the entry-point contract;
  one request plus structured review carries no ongoing chat transcript.
- Inline entry, Cmd-K, Enter to review, Cmd-Enter to apply and Escape to cancel.
  Node manual editing sits under Edit directly. Named changes and before/after
  values remain in the page; exact-event Undo is adjacent to the acknowledgement.
- Generation is local, asynchronous, cancellable and bounded. Domain preview
  preflights every command without writes; approval commits one atomic event with
  the exact request as evidence. Stale plans, invalid actions, autonomous batches,
  unknown/colliding references and transport retries have regression coverage.
  Runtime redirects are refused; model identity, transport, evidence and actor
  come from trusted core configuration, never generated output.
- Actual browser/file-backed core: the local Qwen3 4B model generated a Task
  Prepare launch notes and contains link under focused Test design capabilities.
  Reviewed both, applied by keyboard, observed the new child while parent stayed
  open, then used Undo command and observed its removal. The successful post-fix
  generation took 22.4 seconds warm; an earlier identical diagnostic took 90.2
  seconds and exposed relationship-before-creation ordering and a declared n2
  alias. Those original failures are preserved privately, not retried as scores.
- Earlier experiments also hit a two-minute deadline, asked unnecessary questions
  and emitted invalid references. Bounded alias context, parser-only output and
  declared-reference normalization address execution mismatches, not general
  model accuracy. This is a synthetic integration demonstration, not an accuracy
  benchmark or model adoption. No original benchmark traces/settings changed.
- Exact named rename review/apply/undo was observed separately without inference.
  Required desktop/narrow captures show that literal review; applied.jpg records
  the model-created child result. Screenshots contain synthetic fixture data only.
- Focused-task context after deselection, context changes while planning, retained
  drafts after disconnect, exact-event undo bookkeeping, parent-reference decoding
  and sequential before/after projection were reproduced before regression fixes.
- The existing crash-test setup compiled the whole growing app within a 10-second
  hook, causing contention and a cleanup race. It now compiles only the store
  dependency graph; normal full-project typechecking is retained. Worker count is
  bounded, with test deadlines/assertions unchanged. Security fixture cases run
  independently rather than sharing one aggregate timeout.
- Independent Impeccable finish review: disposition ship, no material fixes.
  Required captures are 1280x800, 390x844 and 644x800. Detector: zero anti-patterns;
  the readable compact command-input typography is recorded by the documenter.
- Full Node 22 `pnpm check`: 79 reference plus 319 workspace tests pass
  (398 total), with one existing S1 TODO. Core and release frontend builds pass.
  Final head c0fdc9e passed CI 42656203194 and Intel/ARM native tests/debug
  builds 42656203322; PR #58 merged as 612130d5.

## Limits

Native launch/Keychain/CSP, external-client usability, hardware acceptance, model
adoption and owner feel remain unverified. No model downloads or hosted inference;
MCP remains separately disabled by default. Full P1 settings/installation/headless
startup/packaging remain later work. No persisted schema change.

## Owner observations

Pending. Follow step 19a in backlog/PROGRESS.md; synthetic content only.
