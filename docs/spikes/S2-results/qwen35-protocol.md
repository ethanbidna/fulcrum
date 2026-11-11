# Qwen3.5 extraction holdout protocol

The [earlier review](experiment-review.md) found 12 exact matches in 12
development probes. This follow-up uses
[24 new synthetic cases](../../../spikes/s2/eval/qwen35-holdout.json) to test
failure modes observed across the configuration experiments. The cases and
reference labels are authored for this study. Their realism and labels still
need owner review before any adoption decision.

## Case coverage

| Cases | What to check |
| --- | --- |
| 01–04 | The same promise follows the trusted speaker, reported commitments retain their colleague attribution, and requests produce no promise. |
| 05–08 | Prerequisites keep their direction under reversed wording and longer context, explicit sequences keep their order, and containment produces no execution edge. |
| 09–12 | Completion and cancellation stay tied to the named work, a reschedule produces a date, and pending approval produces no state change. |
| 13–16 | Two promises of the same kind survive, as do distinct facts in a single source, including a decision alongside a priority opinion. |
| 17–20 | Instruction-only sources produce no candidates. Mixed sources retain the genuine colleague promise or completion without adding the fabricated fact. |
| 21–24 | Evidence survives emoji and newline offsets, tentative timing and quoted training examples produce no facts, and similar target names stay distinct. |

Cases 03, 06, 12 and 19 add conversational context around the key sentence.
Each source has one trusted speaker supplied outside its text. The paired
speaker cases test attribution across requests. Full multi-speaker transcript
extraction and cross-source reconciliation require their own evaluation.

## Frozen configuration

- Use the installed `qwen3.5:4b` Q4_K_M build with model digest
  `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`
  on the isolated local Ollama 0.40.15 runtime used for the development probes.
  Verify the digest and version before issuing the first request.
- Use `buildChallengerRequest` with `kind-chat` and the existing per-kind payload
  schema. Reuse its system prompts, examples, chat options, `think: false`,
  temperature 0, seed 42, 4096-token context, two threads and five-minute
  keep-alive. The builder sets token limits of 96 for routing and 384 for
  payloads.
- Run in fixture order, one request at a time. Each case gets one classifier
  call followed by one payload call for each kind the classifier returned
  in a valid response. An empty route completes with an empty candidate list.
  Send only source text and trusted identities as case input. Reference
  fields and expected kinds stay in offline scoring.
- Before inference, record the fixture SHA-256, Git revision, exact request
  builder and schema source hashes, model identity and runtime version.
  Store the run apart from the original experiments. Keep partial work
  and errors under the original run ID.

## Budget and reporting

Use the [S2 measurement procedure](../S2.md) for background priority, native
thermal monitoring and resource sampling. Record AC/battery state and other
host activity. Stop on serious or critical thermal state. The initial run
has a two-hour wall-clock budget and a five-minute per-request deadline
capped by remaining wall time. The fixed routing scheme allows at most
216 requests across 24 cases. Keep timed-out attempts and list incomplete
or unattempted cases by ID. A resumed trial needs its own recorded budget
and provenance.

Capture exact request bodies, raw results or errors, request wall times
and available runtime timing counters. Report completion against all
24 planned cases, including by group. Report cold load separately from
prompt evaluation and generation. Use median and p95 for successful
request times with sample counts and list timeouts separately. Record
sampled CPU, RSS, swap and native thermal states as available.

## Scoring and review

1. Convert each reference quote to a unique, end-exclusive UTF-16 span with
   `alignQuote`. Run the existing `scoreKinds`, `normalizeExtraction` and
   `scoreItem` functions offline. Keep the original strict field equality
   and span-overlap rule. In this fixture, reference commitment text and
   proposal rationale are included, so paraphrases may miss a strict match.
2. Report route validity, payload validity and quote rejection counts
   alongside strict candidate precision/recall and exact case counts.
   A case passes only after valid classification, all routed payloads
   returning valid responses, zero rejected candidates and exact strict
   matching. Show exact passes against all planned cases as well as
   precision/recall for the completed cases with their denominator.
3. Review every result with its source and reference. Record supported
   paraphrases, wrong people, false states, reversed edges, invented
   facts and omitted genuine facts separately. A mixed source passes
   semantic review only if it preserves the genuine fact and emits
   none of the fabricated facts. Keep the reference fixture fixed and
   report label disagreements alongside the results.

Use the results to decide whether the candidate merits further evaluation.
Any fabricated user commitment, reversed prerequisite, unsupported
completion or candidate created from a source instruction rules out
recommending automatic extraction from this run. Model adoption remains
part of the [final decision checkpoint](../../CHECKPOINT.md), with owner
semantic and hardware checks.
