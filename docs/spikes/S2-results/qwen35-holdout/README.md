# Qwen3.5 local holdout run

All **24 planned cases** completed in **34 minutes 27 seconds** on Intel macOS
with 32 GiB RAM and AC power. Ollama returned all 42 requests, with zero
timeouts, other request errors, incomplete cases or unattempted cases.
The isolated runtime and its supervisor exited after the run.

The runner verified Qwen3.5 4B Q4_K_M and Ollama 0.40.15 against the
[frozen protocol](../qwen35-protocol.md). The [manifest](manifest.json) records
the exact digest, source revision, fixture hash and runner hashes.

## Strict scoring

| Group | Completed / planned | Exact / planned |
| --- | ---: | ---: |
| Attribution | 4/4 | 3/4 |
| Relationships | 4/4 | 3/4 |
| State | 4/4 | 4/4 |
| Multiple facts | 4/4 | 0/4 |
| Source instructions | 4/4 | 2/4 |
| Evidence | 4/4 | 3/4 |
| **Total** | **24/24** | **15/24** |

All 24 classifier responses and 18 payload responses were schema-valid.
Quote alignment rejected zero candidates. Strict precision was 13/22 (59.1%),
and strict recall was 13/21 (61.9%), across the 24 completed cases. Nine emitted
candidates missed the strict reference match, which compares annotated fields
and evidence spans. Semantic review of those misses and model adoption remain
pending.

## Latency and resources

| Successful calls | Count | Median | p95 |
| --- | ---: | ---: | ---: |
| Classification wall time | 24 | 43.5 s | 58.2 s |
| Payload wall time | 18 | 52.5 s | 78.7 s |
| Prompt evaluation | 42 | 40.7 s | 52.1 s |
| Generation | 42 | 2.9 s | 15.8 s |

Ollama reported 15.8 s of load time on the first request, followed by 89.0 s
of prompt evaluation and 1.9 s of generation. The run used background QoS
and one request at a time. No competing Ollama process was detected at
startup. The ordinary desktop session was active.

Across 2,064 resource samples, peak process-tree RSS was 4.05 GiB and peak
combined process CPU was 643.7%. RSS can count shared pages more than once.
System-wide swap peaked at 8.50 GiB. The native monitor recorded 2,045 nominal
and 15 fair samples. No serious or critical sample occurred. The run was
sampled on AC throughout. Battery, pause, responsiveness and Apple Silicon
acceptance remain pending.

## Saved evidence

- [Requests](requests.jsonl) and [responses](responses.jsonl) retain the exact
  submitted bodies, returned data and request wall times in fixture order.
- [Case scores](cases.jsonl) retain the normalized candidates and strict
  scores. The [summary](summary.json) includes aggregate counts and SHA-256
  hashes of the archived files.
- [Resource samples](resources.jsonl) and [native thermal samples](thermal.log)
  support the timings and resource observations. The replay and semantic
  inspection are the next item on the
  [remaining-work checklist](../../../../backlog/REMAINING.md).
