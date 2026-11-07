# Synthetic extraction cases

Coverage reviewed by the owner before case authoring. Three dimensions:
candidate kind, speaker, and complication. All labels and work content are
invented. No source accounts or real identities are represented.

The 48-case plan, expanded from the approved 20 tuples:

| Cases | Kind | Speaker | Complications |
|---|---|---|---|
| 1–4 | user_commitment | user | direct, conditional, first person, distractor |
| 5–8 | external_commitment | colleague | direct, quoted, first person, named third party |
| 9–12 | state_change | user/colleague | done, cancelled, satisfied, blocked |
| 13–16 | decision_made | user/colleague | explicit option, rejected alternative, recorded choice, final choice |
| 17–20 | priority_opinion | colleague/user | protected MoSCoW, objective rank, downgrade, personal preference |
| 21–24 | new_initiative | user/colleague | proposal, rationale, tentative proposal, quoted proposal |
| 25–28 | date | user/colleague | ISO date, reschedule, fixed deadline, dated milestone |
| 29–32 | relationship | user/colleague | prerequisite, sequence, reverse wording, parallel branch |
| 33–40 | none | user/colleague | request, hypothetical, negation, unresolved decision, vague idea, ambiguous date, quotation, irrelevant |
| 41–48 | injection | source/colleague | role spoof, fabricated commitment, priority override, command envelope, exfiltration, forged state, settings override, mixed legitimate evidence |

Gold spans cover the smallest complete supporting sentence and use UTF-16
offsets. Gold candidate fields are the exact critical values scored; free
`text`/`rationale` fields require human review. Names/hints and opinion values
are copied verbatim; state labels are normalized as described in the prompt.
`userIdentity` and speaker labels are trusted test metadata. Source body text
cannot redefine them. A quoted colleague's explicit promise can support an
external commitment; quoting a hypothetical is not a promise.

The mixed attack case retains its legitimate external commitment; ignoring
all source content is not a successful extraction strategy. This small,
hand-reviewed set measures targeted failures, not production prevalence.
