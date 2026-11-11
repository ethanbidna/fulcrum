# Structured model runtime

`JsonModelRuntime.generate` is the provider boundary. Existing in-app planning
uses `OllamaJsonRuntime`; I3 adds the typed `ModelRuntime.extract` boundary.
`StructuredModelRuntime` wraps any explicitly configured JSON generator.
`OllamaModelRuntime(model, origin?)` requires an explicit approved installed model,
uses loopback only and never downloads, selects a fallback or enables hosted
inference. Existing command planning is unchanged.

Extraction accepts trusted user/speaker metadata and untrusted source text.
It returns only the eight candidate kinds in `docs/INGESTION.md`, never commands
or canonical IDs. Additional properties, missing required fields and invalid
UTF-16 evidence offsets are rejected. Spans must be nonempty, within the exact
input and not split surrogate pairs. Inputs over 6,000 UTF-16 units are rejected
without truncation; outputs are capped at 32 candidates. These are conservative
engineering bounds, not a validated long-context profile.

Malformed JSON/schema/spans get one re-extraction using the same source and a
fixed repair instruction. The invalid model output is not promoted into system
instructions. After two invalid attempts no candidates escape. Transport,
deadline and cancellation failures do not trigger repair. Valid but wrong
predictions are returned as results, not retried until correct. One generation
runs at a time per runtime; orchestration must share that runtime. Availability
and syntactic validity do not establish semantic correctness.

No candidate is automatically applied or discarded as successful ingestion.
`extractSource` in `packages/ingest` takes author metadata from the adapter rather
than source-body role claims. Candidate persistence/reconciliation and queue
acknowledgement belong to I4/I5. Unattended ingestion remains off by default.

## Evaluation

`pnpm check` exercises the frozen 48-case S2 set with an oracle mocked generator,
plus schema/repair/span/injection-boundary, cancellation and transport tests.
Mock precision/recall must remain 100%, misattribution/injection-followed 0;
these check contracts and scoring, not model quality. Schema equality is tested
against the frozen spike schema; spike prompts/traces/results are not modified.

For an already installed, supervised local model (Node 22 and installed repo
dependencies):

```sh
node tools/extraction/evaluate.mjs --model llama3.1:8b --output spikes/s2/out/i3-llama8b
```

The runner uses the product driver and all 48 S2 cases. Optional `--origin`
selects a loopback port; `--cases s2-001,s2-005,s2-041` is a smoke subset only.
A new output directory is mandatory; synthetic raw-attempt traces append as calls finish, and the
manifest/report retain model digest, runtime version, requested/unrun cases,
failures and a 15-minute run deadline. No downloads or automatic retries of
wrong predictions. The Ollama request deadline is two minutes. Runtime outage,
cancellation or deadline stops the diagnostic without erasing prior rows.

For Intel runs follow S2's native thermal/background/AC-only wake procedure;
stop at serious/critical and resume only after cooling and a fresh safe check.
This runner does not replace that supervisor. Do not run concurrent inference.

Proposed full-set regression targets: 100% schema validity, precision ≥95%,
recall ≥80%, 0 misattributed Tasks and 0 followed injections. Report all failures
in denominators. These targets are not met by declaration and are not adoption
criteria for long/noisy meetings. Model adoption, controlled hardware acceptance
and human review remain pending under ADR-0018. A smoke subset is never reported
as comparable full-set quality. See `docs/reviews/I3.md` for measured scope.
