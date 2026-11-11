# ADR-0023: guided setup and local model profiles

- **Status:** Accepted implementation direction; native acceptance pending
- **Date:** 2026-11-10
- **Implements:** ADR-0018; no model/runtime adoption decision

## Decision

The native shell owns folder picking, startup and switching. Native selections
are held behind a one-use-context token; the webview cannot substitute a path
or executable. Create refuses nonempty folders; interrupted creation can reopen
the same manifest on retry. Opening encrypted/unsupported data never creates a
replacement workspace. New workspace selection disables MCP before launch.
A successful core startup records its active workspace in the private profile.

Use AppKit's maintained folder picker and Security.framework Keychain APIs
through the existing Objective-C driver boundary. No new daemon, database or
credential-storage dependency is introduced. The signed native executable also
serves a narrowly scoped provider-key helper mode. Keys enter over stdin, never
argv; only fixed Anthropic get/set/remove operations are accepted. No key is
returned to the webview or persisted in workspace/profile JSON. Actual macOS
approval/ACL behavior remains an owner check.

Canonical device naming, self-person creation/selection and ingestion assignment
use Domain commands in one transaction. The existing v1 device label is renamed
by `device.rename`, allowed only to the local user for this device. Readers still
replay ordinary v1 ops; no persisted field/schema changes. Local configuration
cannot be changed indirectly by MCP undo of device/settings events.

AI starts off. The wizard and Settings share one chooser. Architecture, current
memory, disk and supported OS inform provisional candidates; they do not accept
an Intel tier. A fixed reviewed catalog provides terms, base/developer origins,
processing location and artifact sizes/digests. Country filters persist outside
the workspace, do not relax silently, and disable an active excluded model.
Unknown origins remain unknown. Search alone does not revoke a model.

Explicit local setup downloads the pinned official Ollama app archive, verifies
its exact hash/size, then uses codesign and Gatekeeper assessment without removing
quarantine or bypassing approvals. Its owned CLI binds a separate loopback port,
uses private managed weights, disables cloud features and limits concurrency.
Model pull verifies the pinned installed manifest digest; verified model layers
can resume on retry. Runtime archives restart on retry. No existing Ollama server,
benchmark process, global models or installation is adopted or replaced.

A bounded synthetic test records output validity, time, core RSS and a local
runtime-process-tree RSS sample, not peak memory or extraction accuracy. Only a
successful explicit test activates a profile. Cancel/off is serialized against
profile publication, so a late job cannot reactivate AI.

Hosted setup requires terms, a key, sharing scope and daily token allowance.
Only typed requests and selected initiative command context may be sent; no
source excerpts or background ingestion uses this path. Context is filtered
before encoding model references. The API destination/model is fixed; provider
responses cannot choose settings, tools or destinations. Reserve a conservative
allowance before every call, including tests and failures. There is no fallback.

## Limits

The native bootstrap expects P5's bundled core/shim. Browser fixtures do not
prove native startup, Keychain prompts, clean-user onboarding, Gatekeeper,
real downloads, model performance or provider-account behavior. Source connection
steps honestly show unavailable until I2 provides reviewed connectors. Existing
source/model/sync/signing Owner checks remain open.

Official sources: [Ollama macOS requirements](https://docs.ollama.com/macos),
[local-only configuration](https://docs.ollama.com/faq),
[release metadata](https://api.github.com/repos/ollama/ollama/releases/tags/v0.40.16),
[API pull](https://github.com/ollama/ollama/blob/main/docs/api.md#pull-a-model),
[Qwen model/license](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
[Llama model/license](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct),
[Anthropic Messages](https://platform.claude.com/docs/en/api/messages) and
[pricing](https://platform.claude.com/docs/en/about-claude/pricing).
