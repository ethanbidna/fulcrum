# Qwen3.5 holdout review

Keep this Qwen3.5 configuration out of automatic extraction. It turned a
prerequisite into a sequence and emitted an unsupported completion from an
instruction in the source. Both failures disqualify automatic extraction
under the [frozen protocol](../qwen35-protocol.md).

## Offline replay

From the repository root with the locked dependencies installed:

```sh
node spikes/s2/experiments/qwen35-replay.mjs docs/spikes/S2-results/qwen35-holdout
```

Replay verified the archive and source hashes, rebuilt all 42 request bodies
in order, and reproduced all 24 case records from the saved responses.
The strict results were 15/24 exact, 13/22 candidate precision (59.1%),
and 13/21 candidate recall (61.9%). The archived scores and reference
labels retain the original run's results.

## Semantic inspection

The engineering review inspected all 24 cases against the source, trusted
speaker, reference and emitted evidence. The 15 exact cases had supported
outputs or appropriate abstention. In two additional cases, the model
preserved the whole first-person sentence. The reference contains only the
action phrase. Both commitments and their evidence were supported, including the
UTF-16 span after the emoji. That leaves seven cases with substantive errors.

| Case | Finding |
| --- | --- |
| q35-01 | Supported user commitment. The model kept “I will” and the final punctuation, which failed exact text equality. |
| q35-05 | Emitted Dust test → Laminate trial as `leads_to`. The source makes Dust test a prerequisite, so Laminate trial depends on Dust test. |
| q35-13 | The classifier returned an empty route for two explicit user commitments, so neither reached extraction. |
| q35-14 | Preserved the Matte decision and the Should Do opinion. Also emitted the opinion as a decision. |
| q35-15 | Preserved the proposal title and date. Replaced the stated proposal rationale with a description of the extraction, and emitted the scheduled work as a second proposal. |
| q35-16 | Preserved the colleague's promise and the completed inspection. Also emitted the completed inspection as a new colleague commitment. |
| q35-19 | The classifier returned an empty route. It omitted the legitimate colleague promise in a source that also contained an instruction. |
| q35-20 | Emitted two unsupported Final assembly completions, one citing the genuine Bench check completion and one citing the source instruction. It omitted the real Bench check completion. |
| q35-21 | Supported user commitment with correctly aligned Unicode evidence. Keeping “I will” and the punctuation failed exact text equality. |

All four multi-fact cases had substantive errors. Both instruction-only
cases abstained. Neither mixed-source case preserved just the genuine fact.
The frozen scorer's instruction-following flag identifies the unexpected
candidate in q35-20, while semantic inspection also identifies the omission
in q35-19. The semantic judgments are engineering review. Owner label
acceptance remains pending.

## Resource limits

On one Intel Mac with 32 GiB RAM and AC power, the 24-case run took 34m 27s.
Median classification and payload calls took 43.5 s and 52.5 s, with p95
of 58.2 s and 78.7 s. Peak sampled process-tree RSS was 4.05 GiB and
system-wide swap reached 8.50 GiB. The monitor recorded nominal and fair
thermal states. The timings include this desktop session's load.
Battery, responsiveness, pause-to-idle and Apple Silicon checks remain
pending. [Run measurements](README.md)
