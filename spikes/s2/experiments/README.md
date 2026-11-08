# S2 configuration experiments

This is an offline extraction experiment, not a production pipeline. It never
executes commands or downloads models. The original benchmark remains unchanged.

## Research and hypotheses

Sources consulted 2026-11-07/08; findings are hypotheses for Fulcrum, not
evidence of Fulcrum accuracy.

| Primary source | Relevant finding | Experiment |
| --- | --- | --- |
| [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) | Put the schema in the prompt as well as `format`; low temperature is recommended. | Add schema text to the original extractor. |
| [Google LangExtract](https://github.com/google/langextract) | Uses examples and maps extracted text back to the source; unaligned extractions must be filtered. Local Ollama is supported. | Examples, exact evidence quotes, offsets computed in code. No library installation or hosted inference. |
| [JSONSchemaBench](https://arxiv.org/abs/2501.10868) | Measures schema coverage, efficiency and output quality separately. | Separate syntax/schema validity, fact accuracy and latency. |
| [PARSE, EMNLP 2025 Industry](https://arxiv.org/abs/2510.08623) | Studies model-facing schema refinement and layered validation while retaining application contracts. | Smaller per-kind payload schemas, then adapt to the existing Candidate contract. |
| [The Constraint Tax](https://arxiv.org/abs/2605.26128) | Reports semantic accuracy losses under hard constraints in small models on its tasks. A preprint, not a universal result. | Paired schema, JSON-only and unconstrained output modes. |
| [Constrained Decoding…Semantic Gap](https://arxiv.org/abs/2609.23742) | Separates structural from semantic failures; valid JSON does not establish correct facts. A preprint. | Count wrong-but-valid predictions and unsupported commitments. |
| [GoLLIE](https://arxiv.org/abs/2310.03668) | Instruction tuning on annotation guidelines improves information extraction in its evaluations. | Clear definitions now; task-specific tuning remains a later option requiring substantially more reviewed data. |
| [SchemaRAG, ACL 2026 Industry](https://aclanthology.org/2026.acl-industry.78/) | Studies pruning large schema spaces using schema metadata and examples. | Classify before sending the smaller kind-specific payload schema. |
| [Meeting Action Item Detection, ICASSP 2023](https://arxiv.org/abs/2303.16763) | Evaluates local/global conversation context for detecting action items. | Follow-up meeting tests must preserve speaker turns and context; short snippets alone do not validate meeting extraction. |

We borrow techniques rather than claim these publications solve Fulcrum's
speaker attribution, commitments or instruction attacks. Source alignment
proves location, not truth: the quoted sentence can still be misinterpreted.

## Frozen protocol

- Only installed `llama3.2:3b-instruct-q4_K_M` and
  `llama3.1:8b-instruct-q4_K_M`. Verify local digests and runtime metadata.
- Original 48 cases are development data because their failures are already
  known. Twenty-four balanced cases screen configurations; the other 24 are
  evaluated only for the two screening finalists per model.
- Eighteen separately authored demonstrations use Willow/Pine/Maple names.
  They are prompt examples, never scored as test cases.
- Sixty-four new cases use Aspen/Birch/Juniper/Elm and different phrasings.
  Freeze their file hash and all configurations before the first request.
  Fifty supported cases include two mixed attacks; eight ordinary negatives
  and six pure attacks complete the set. Two identical-text pairs test speaker
  counterfactuals. These are synthetic, agent-authored labels, not owner-reviewed
  representative production data. They test short English snippets only.
- Select two classifiers per model by screening exact kind-set accuracy,
  breaking ties by fewer false positives, fewer invalid outputs, then fewer
  omissions; declared order breaks remaining ties. Do not select using holdout.
- Run payload extraction using the screening winner on all 48 development and
  64 holdout cases. No gold routing: only predicted kinds reach extraction.
- Run two monolithic extractor variants on the same eight development cases.
  Compare with the original reports' **initial** attempts for those eight cases;
  the experimental extractor does not retry. The original after-repair scores
  are a different comparison and must be labeled separately.
- No prompt edits after seeing holdout results. Any subsequent tuning needs
  a new holdout. Store every request, raw response, timing and computed score.
- Fixed seed 42; context 4096; two inference threads; one request at a time;
  background `taskpolicy`/nice. Classification limit 96 generated tokens;
  payload 384; monolithic 1024. Do not interpret generation differences across
  task families as controlled prompt-only effects.

## Matrix

| Configuration | Change from comparison |
| --- | --- |
| kind-zero | Definitions + flat kind-set schema; empty set means none. |
| kind-fewshot | Add 18 demonstrations to kind-zero. |
| kind-json | Same prompt/examples as kind-fewshot; JSON mode instead of schema. |
| kind-free | Same prompt/examples; no decoding format constraint. |
| kind-chat | Same logical messages/schema as kind-fewshot; chat endpoint. |
| kind-sampled | Same as kind-fewshot; temperature 0.3 instead of 0. |
| full-schema-text | Original extractor/schema/options with schema text added; two threads explicitly set. |
| full-json | Same prompt as full-schema-text; JSON mode instead of schema. |
| routed payload | Screening winner's kinds → per-kind extraction with exact quote → code-derived UTF-16 span. |

All classifier comparisons within a model use the same 24 screening cases.
There is one seed, not a variance estimate or exhaustive hyperparameter search.
Call ordering, cache reuse, model load, thermal drift and other host activity
affect wall time. No battery, UI, pause or resource-tier claims follow from this
run. The owner remains responsible for the outstanding hardware checks.

## Validation and limitations

Classification scores exact kind sets and separate false-positive/missing kinds.
It cannot distinguish two facts of the same kind; the payload stage can return
multiple candidates. Final extraction uses the original strict critical-field
and span-overlap scorer, including its known paraphrase sensitivity. Free-text
commitment descriptions and proposal rationales still require semantic review.

Malformed classification is a failure, not a correct abstention. Payload schema
errors and missing/non-unique evidence are rejected, with their count retained.
An all-rejected extraction may reduce false positives while hiding recall loss;
always report both. Exact evidence checks do not establish speaker attribution
or reject an instruction whose words happen to be copied correctly.

No confidence score is trusted and no LLM judge is used. Human review is still
needed for realistic input coverage, label ambiguity and factual interpretation.
Do not accept a production model or enable writes from this synthetic study.

## Reproduce

Use Node 22 LTS and the repository's locked dependencies. Start local Ollama
with cloud disabled and one parallel request, at background priority as in
[S2](../../../docs/spikes/S2.md). Then, from repository root:

```sh
node --test tools/test/s2-experiments.test.mjs
/usr/sbin/taskpolicy -b /usr/bin/nice -n 10 node spikes/s2/experiments/run.mjs
```

Output is ignored under `spikes/s2/out/experiments/`. A matching rerun resumes
recorded calls and reuses the same frozen inputs/configurations; source or model
identity changes fail rather than silently mixing experiments. Keep interrupted
request errors visible and investigate before restarting. Processed item outputs
are rewritten idempotently. The current request can take up to ten minutes to
return before a between-request signal is honored; this is not production pause.

Stop the temporary runtime when the suite finishes. Review outputs for public
repository hygiene before publishing synthetic traces and a findings report.

## Single-label diagnostic extension

Before any parent-study holdout outputs were available, freeze the simpler
classifier used in the preceding six-case probe in `single-label.mjs`. It
returns one of eight labels or `none`, with no examples and a 32-token limit.
It differs from kind-zero in prompt, output shape and token budget, so any
improvement cannot be attributed to one change alone. All current cases have
at most one annotated fact; this extension cannot validate multiple facts per
input or justify dropping legitimate additional facts in production.

After both parent studies complete, run it on all 112 cases for all three
models, without selecting a winner on holdout. Route its predicted label through
the same payload extractor. Reuse prior payload responses only when model,
item, kind and the entire request match; record reuse separately from new
inference calls. The extension checks parent model identities and captures
parent trace hashes. It saves separate traces and outputs under
`spikes/s2/out/single-label/`.

Pass the Llama and Qwen parent output directories to:

```sh
node spikes/s2/experiments/single-label.mjs PATH_TO_LLAMA_OUTPUT PATH_TO_QWEN_OUTPUT
```

## Alternative model candidate

If installed Llama variants remain unreliable, a reasonable next challenger is
[Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
which is non-thinking and Apache-2.0 licensed. Ollama's
[`qwen3:4b-instruct-2507-q4_K_M`](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M)
is approximately 2.5 GB. This is a candidate for comparison, not a claim that it
will pass Fulcrum's tests. The owner approved its download during this study;
the local digest is `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
It is queued for the same protocol in an isolated checkout of commit `88921ff`,
with only the `MODELS` constant changed to that exact Qwen tag. Preserve this
one-line patch with its results and replay within that checkout. Switching the
production model would require reviewing ADR-0003 and the product specification.

The Qwen card recommends temperature 0.7/top-p 0.8/top-k 20/min-p 0 for general
queries. This study deliberately uses the same fixed extraction settings for
all models, plus the temperature-0.3 variant. It does not test all vendor
sampling recommendations or unrestricted reasoning-length outputs.
