# ADR-0018: Model choice and guided setup

- **Status:** Accepted direction; implementation and model adoption pending
- **Date:** 2026-11-09
- Supersedes ADR-0003's Llama-only tiers and exclusion of direct hosted adapters.

## Context

The owner requires a model-agnostic wizard: hardware-based suggestions, a choice
of local open-weight models or optional hosted providers, model-developer origin
preferences, and downloads/setup completed inside one guided flow. Existing S2
results do not accept any model for unattended writes or establish hardware tiers.

## Decision

Keep model providers behind runtime interfaces. Local inference remains the
default; hosted providers require the user's own API key and explicit sharing
scope. Provider choice never changes domain policy, evidence, review or undo.
No silent fallback from local inference to a hosted service.

The wizard detects architecture, available memory, disk and runtime support,
then suggests a purpose-specific profile with its validation status. The user
can override it. A bounded synthetic compatibility test measures successful
structured output, latency and resource behavior. It does not replace an
extraction accuracy evaluation or owner hardware acceptance.

Offer a searchable model/provider list with license, download size, expected
resource needs and verified developer country/region. Let users choose their
home country and optionally prefer domestic developers or exclude regions,
including China; make no nationality assumption. For derivatives, show the base-model developer as well as the publisher or
fine-tuner. Unknown origin is labelled unknown. Developer origin and hosted data-processing location are separate
fields. Filters affect recommendations and alternatives; they are never silently
relaxed. Local use of a foreign-developed model does not itself require sending
work content to that developer.

After model choice and required license consent, one primary action manages
runtime setup and model download, progress, cancellation and retry/resume where
supported, followed by verification and the compatibility test. Use trusted
publisher artifacts; retain the installed model digest and profile revision.
No Terminal is required. Required macOS installation/permission prompts remain
visible; the wizard does not bypass them. Weights stay outside git, the app bundle
and the synced workspace.

Hosted setup offers provider/model selection, declared processing location and
data handling, Keychain-backed key entry, a sharing scope and usage budget, then
Connect and test using synthetic input. Existing accounts/keys are supported;
provider account creation and billing remain with the provider. Keys, local paths
and provider preferences remain machine-local. Switching models/providers is
also available later in Settings, with a fresh compatibility check.

## Consequences

P2 owns the walkthrough/download UX; I3 owns provider-neutral extraction adapters;
P4 owns later configuration and credential controls. No hosted inference,
downloads, accounts or model acceptance are enabled by this design-only change.
Llama 8B remains a provisional capable-hardware profile; Qwen3.5 4B is a smaller
candidate needing a comparable full holdout before recommendation as a default.
There is no universally accepted Intel default from the current results.
