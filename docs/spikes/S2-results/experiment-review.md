# S2 extraction experiment review

Keep automatic extraction disabled for the tested configurations. Qwen3.5-4B is the candidate to carry into a fresh holdout. The best Llama 8B pipeline recovered more facts than either other frozen-holdout model, but also reversed dependencies and proposed unsupported state changes.

## Frozen synthetic holdout

The holdout contains 64 short English snippets with 50 reference facts. The scorer checks critical fields and evidence span overlap. It does not grade the semantics of every free-text field. Results below use the kind-set classifier selected on development cases and the payload schemas it routed to.

| Model | Exact classification | Exact extraction | Candidate precision | Candidate recall |
| --- | ---: | ---: | ---: | ---: |
| Llama 3.2 3B Instruct Q4_K_M | 46/64 | 21/64 | 26.5% | 26.0% |
| Llama 3.1 8B Instruct Q4_K_M | 51/64 | 44/64 | 78.6% | 66.0% |
| Qwen3 4B Instruct 2507 Q4_K_M | 60/64 | 25/64 | 100.0% | 22.0% |

The 8B kind-set pipeline passed all eight ordinary negatives and all eight attack cases on this holdout. Its nine false positives included two reversed prerequisites (h-043, h-046), two unsupported completions (h-037, h-041), a rejected decision option emitted as chosen (h-024), and one promise emitted twice (h-004). An incomplete target (h-015), a speaker label representation mismatch (h-027), and a date quote just below the overlap threshold (h-042) account for the other three. The single-label 8B variant recovered 40/50 facts but emitted 16 false positives and passed 6/8 attacks.

Qwen3's 100% strict precision reflects 11 matched facts and 39 misses. Its kind-set pipeline passed 6/8 holdout attacks. In both longer mixed-attack cases (r-023 and r-024), it returned an empty list, omitting the colleague's genuine commitment. Across all 24 derived stress cases it matched 4/24 exactly and recovered 7.7% of reference candidates. Llama 3B completed 16/24 stress extractions with no exact cases. Llama 8B classified 7/24 and completed no stress extractions within its recorded budget, which includes the thermal interruption.

## Development probes and 8B latency

Qwen3.5-4B matched 24/24 development classifications. Its original budget produced zero completed extractions out of 12. The separately budgeted follow-up completed the same 12 cases with nine new payload calls and scored 12/12 exact. Inspection of its outputs found that the direct user promise remained a user commitment (s2-001), the colleague's promise remained external (s2-005), the prerequisite direction was correct (s2-029), and the mixed attack retained only the legitimate colleague commitment (s2-048). Gemma 4 E4B scored 8/12 on the same development probes and omitted the colleague's promise in both s2-005 and s2-048. Both challengers ran on the newer local Ollama runtime with chat requests and thinking disabled. The 12 probe items came from the development data used to screen the classifiers.

The separate 8B diagnostic observed about 530 seconds before the first token on the cold full-schema prompt. In the resident-model follow-up, all 16 requests returned, six responses were schema-valid, and two scored exact. The original timeouts remain in the original scores. Cache state, runtime, thread count and host activity differed, so the diagnostic does not isolate the impact of threads or establish controlled timings.

## Verification and next decision

Offline replay passed for the 818 Llama and 418 Qwen3 parent requests, the single-label comparison, the 123 stress requests, and the 154 challenger requests. The saved resident 8B replay also passed. See the [frozen protocol](../../../spikes/s2/experiments/README.md) and [original Intel benchmark review](review.md) for scope. These are synthetic experiments with agent-authored reference labels. Owner semantic review, battery and pause-to-idle checks, and Apple Silicon validation remain pending.

Freeze the Qwen3.5 classifier and payload schemas before evaluation on fresh, independently reviewed examples. Include longer transcripts, multiple facts, speaker changes, mixed source instructions and the dependency and state failures observed here. Require usable extraction and acceptable runtime before considering model adoption. Keep the development and follow-up scores as recorded.
