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

## Bounded robustness extension

Keep this separate from the frozen comparison. `robustness.mjs` derives 24
sources from the approved development annotations: facts at beginning/middle/end
of roughly 300-word context, paired trusted speakers, emoji/newline offsets,
two facts of the same or different kinds, ordinary negatives and mixed attacks.
It covers all eight kinds. This is correlated synthetic stress data, not a new
holdout, full meeting benchmark or temporal conflict reconciliation test.

Each model uses its original screening winner, without tuning on holdout.
Before stress extraction, repeat eight critical sampled-classifier cases with
seeds 7 and 101 against the existing seed-42 baseline. Stability is reported
separately from correctness. All three models run sequentially, capped at
30 minutes and 80 new inference requests each (90 minutes/240 requests total).
The budget can leave extraction unfinished; reports show completed denominators
and never count unfinished cases as passes. No additional models are downloaded.

After the parent studies and single-label diagnostic, run:

```sh
node spikes/s2/experiments/robustness.mjs PATH_TO_LLAMA_OUTPUT PATH_TO_QWEN_OUTPUT
node spikes/s2/experiments/robustness.mjs --audit PATH_TO_LLAMA_OUTPUT PATH_TO_QWEN_OUTPUT
```

Ignored outputs live under `spikes/s2/out/robustness/`, including source hashes,
parent trace hashes, requests, raw responses, normalized candidates, scores and
`review.md`. Offline replay verifies requests, normalization and scores. The
runner refuses to overwrite an existing manifest rather than reset its budget.
Review the annotations and semantic accuracy before drawing adoption conclusions.

## Additional model screening

The owner subsequently approved both newer challengers:
[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) and
[Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B-it). Gemma's effective
parameter count understates its total model footprint. The installed Ollama
0.23.0 rejects both current packages as requiring a newer version. Use an
isolated official Ollama 0.40.15 runtime, checksum-verified against its release,
on localhost port 11435 with cloud disabled, a separate temporary model store,
one parallel request and one loaded model. Leave the installed application and
the original inference processes unchanged. Both model downloads may overlap;
serialize inference after the original battery to avoid resource contention.

`challengers.mjs` screens three configurations on the original 24 balanced
**development** cases: few-shot kind-set chat, zero-shot kind-set chat and the
minimal single-label classifier adapted to chat. Every request explicitly sets
`think: false`; verify behavior in saved responses. The first inference request
also serves as the execution compatibility check; metadata inspection alone
cannot validate inference. Capture failed loads/API calls as failures and
continue to the other model. Never substitute a cloud tag.

Select the screen winner with the original exact/false-positive/invalid/missing
kind ordering, then route predictions on 12 development probes covering every
kind plus ordinary negatives and attacks. No gold routing or repair. Each model
has a one-hour/120-inference-request cap, including screening and probes. Report
unfinished denominators and retain every attempted request. A failed model is
not a successful empty extraction. This is a screen/probe, not the full frozen
holdout battery. Runtime and chat changes confound comparisons with that battery.
Only promote a promising candidate to a separate full evaluation after review.

After downloads and the original battery finish:

```sh
node spikes/s2/experiments/challengers.mjs
node spikes/s2/experiments/challengers.mjs --audit
```

Ignored outputs are under `spikes/s2/out/challengers/`. They include model
identities/capabilities, source hashes, raw traces, objective scores, offline
replay and `review.md`. Native thermal monitoring and the same serious/critical
stop threshold cover the queued inference. The completion job links the result
from the main comparison report and stops only its isolated runtime. This adds
up to two hours of inference beyond the original three-model battery; neither
completion tonight nor production accuracy is established by queueing it.

## Five-minute timeout recovery

The overnight battery stopped after 803 calls during the first 8B full-schema
probe. It saved `fetch failed` at 300.98 seconds; the server recorded HTTP 500
at five minutes. Native thermal samples remained nominal. This is consistent
with the HTTP client's independent five-minute header deadline; the original
error omitted its nested cause, so do not claim that log alone proves it.
[Undici documents a 300-second default](https://undici.nodejs.org/api/Client)
separate from the caller's abort signal.

`transport.mjs` uses Node's maintained HTTP client for loopback inference,
retaining the caller's existing deadline, response-size bounds and cancellation.
`preload.mjs` installs it only for known local inference ports. No prompts,
models, scoring or frozen inference files change. To reproduce the actual long
header wait and compare against native fetch:

```sh
FULCRUM_SLOW_HTTP_TEST=1 node --test tools/test/s2-transport.test.mjs
```

The long test takes about 310 seconds and is skipped in routine checks. Short
checks cover cancellation, delayed headers, HTTP errors and isolated routing.
Resume the frozen runner with:

```sh
node --import ./spikes/s2/experiments/preload.mjs spikes/s2/experiments/run.mjs
```

Optional `FULCRUM_INFERENCE_PORT=11436` routes the same logical requests to an
isolated runtime with the original model store/version. Record transport source
hashes and the physical endpoint beside resumed outputs. The operational
recovery records these in `spikes/s2/out/recovery-transport.json`.

`retry-probe.mjs ORIGINAL_OUTPUT` sends an identical failed full-probe request
once more, saving the retry separately under `spikes/s2/out/probe-retries/`.
It retains the original failure and never substitutes retry scores in the
original summary. The frozen runner resumes missing calls from its trace keys;
failed recorded calls remain failures. Bounded recovery can advance past a
newly recorded failure to finish independent work, but must stop if a restart
makes no trace progress. Do not delete failed rows or count retries as first
attempts. Complete parent studies then allow the previously queued single-label
and robustness diagnostics; their failures are recorded independently.

The initial Llama retry/resumption overlaps challenger inference on this
16-logical-CPU, 32-GB test host. Both use two inference threads and background
priority. This change in host activity further rules out controlled timing or
resource comparisons; it does not validate battery or UI behavior.

## Unfinished challenger payload coverage

A one-hour screen can consume its full budget before payload extraction. Keep
that budget-limited result unchanged. After both screens and the Llama probes
finish, `payload-followup.mjs` runs only the 12 originally planned probes that
lack complete parent extraction. It reuses the selected screen's classifications,
checks model identities and exact requests, and never repeats completed probes.
This is a separate follow-up with a 30-minute/48-request cap per model, not a
reset or extension of the original run's denominator.

Outputs under `spikes/s2/out/challenger-payload-followup/` preserve parent trace
hashes, new attempts, pipeline scores and a separate review. Failed requests
remain visible. No gold routing, classifier tuning or new holdout is introduced.
The follow-up waits for a free isolated runtime and uses native thermal checks
and the repaired local HTTP transport. Include both the original budget-limited
report and this follow-up when assessing extraction quality.

## Llama timing diagnosis

`llama-latency.mjs` investigates why 8B full-schema requests exceeded their
caller deadline. Earlier successful 8B calls spent most of their time in prompt
evaluation; every interrupted frozen runner unloads models in `finally`, so
resuming after an error starts without that prompt cache. These observations
suggest a cold-prompt cost, but do not establish the cause of the failed calls.

Use the same downloaded 8B digest on isolated Ollama 0.40.15 at port 11435.
The diagnostic records streamed events, time to first answer token, final prompt
and generation metrics, partial output and failures. It tries a short smoke
prompt, the original full prompt with one output token, the original full
request with a warm cache, then four inference threads. The one-token prefill
probe allows up to 15 minutes; other extraction probes retain ten-minute limits,
within a 30-minute overall cap. Model residency is preserved between variants.

The original prompt/schema/seed/context stay fixed for the extraction probes;
streaming, runtime, cache state and the declared thread variant differ. These
are diagnostic interventions, not additions to the frozen benchmark or evidence
of a production model choice. Concurrent background inference prevents controlled
hardware comparisons. Save separate results under `spikes/s2/out/llama-latency/`.
The parent attempts remain failures regardless of any diagnostic success.
