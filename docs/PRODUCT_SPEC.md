# Fulcrum — Product and Implementation Specification

Status: Product vision and UI contract, November 2026. This is a build specification, not evidence that any backend integrations work yet.

> **Authority.** This document is the product source of truth. Where the architecture docs make a choice the spec leaves open, they say so and link an ADR. Where they appear to conflict with this file, this file wins and the architecture doc is a bug. Technical refinements of the illustrative schema below live in [DATA_MODEL.md](DATA_MODEL.md).

## Product intent
A single-user, initiative-first desktop application that quietly ingests relevant work conversations, maintains a structured initiative portfolio, and lets the user regain clarity in 30 seconds after days of not opening it. Simplicity, clarity, and flow outweigh automation breadth. The app is not a task manager, project management SaaS, or second brain. Only the user has Tasks. Other people's actions and external constraints are Dependencies.

## Strict constraints and non-goals
- No percent-complete bars, pie rings, or numeric completion estimates on initiatives. Plans are fluid; track actionability, waiting, outcomes, source freshness, and milestones instead
- No built-in AI chat. Conversational operations are exposed through an optional local MCP server for Claude and other MCP clients
- No AI-written dashboard summaries or constantly regenerated prose. Deterministic views over typed state
- No Kanban workflow-status columns by default. Initiatives are highest-order cards grouped by user categories or MoSCoW
- No daily task management homepage, arbitrary task ownership, employee accounts, social features, or cloud application backend
- No required percentage metrics, elaborate workflows, or mandatory form-filling
- Workspaces may be stored locally, or in a Dropbox/Google Drive synced folder. Cloud syncing is optional and user-controlled; inference stays on device. Never sync a live SQLite/graph database
- No automatic creation of active initiatives; require human approval
- Avoid adding infrastructure that creates more maintenance than it saves
- Reference mockup images are *not* pixel-perfect specs. Some generated images show progress bars/percentages and inconsistent colors: IGNORE those elements; this document overrides imagery

## Information architecture / screen inventory
1. **Initiatives / Portfolio (home)**: spacious card-based grouped portfolio. Toggle group by custom Category, MoSCoW (Must Do / Should Do / Could Do / Won't Do), Team, Strategic objective, or None. Sort by manual rank, MoSCoW, relevance, last changed, or date. Card minimal: initiative name, optional description/category, MoSCoW compact indicator, exactly one meaningful state (My next action / Waiting for [dependency] / Blocked by [constraint] / Next step unclear), optional date, quiet freshness indicator. No faces, Slack badges, completion percentage, or activity paragraphs. Keep card spacing such that initiatives are visibly primary, not spreadsheet rows. Right contextual rail: Your next available actions, Waiting on, Meaningful changes, and small Questions count. Rail can collapse
2. **Initiative Detail / Flow (default)**: breadcrumb; title; MoSCoW; category; optional objective links; Flow/List/Context/Timeline/History tabs. Main canvas React Flow + ELK.js, panning/zoom/fit, drag nodes, connect with typed edges, selection, auto-layout, focused detail navigation over the SAME graph, reversible edits. Compact inspector opens on selection; otherwise initiative overview and next-action/waiting summary. Graph remains visible, inspector collapsible. Never show arbitrary progress percentages
3. **List view**: alternative presentation of the same flow objects with inline editing, hierarchy, state, role, due date, dependencies and source count. NOT a separate task manager
4. **Context view / evidence inspector**: linked source references (Slack, Gmail, Granola, files, web links), title/sender/timestamp, local excerpt, source permalink/open original, claims supported, source provenance, explicit vs inferred indication, evidence freshness. Sources → evidence → claims → initiative state. On object selection, show evidence supporting that object's specific attributes and links. Two temporal notions: when event happened and when system learned of it. Source evidence can attach to the initiative, specific nodes, and individual relationships; initiative Context aggregates linked evidence throughout the graph
5. **Timeline view**: optional execution timeline of expected work, dates, dependencies, milestones; optional contextual event/history timeline. Do not force timelines on initiatives without dates. vis-timeline or comparable maintained OSS library when needed
6. **Priorities & KPIs**: user-maintained ordered strategic objectives and optional measurable KPIs. Rank objectives, permit ties and relative importance (lightweight 1–5 or pairwise comparisons if useful). Show linked initiatives and estimated alignment (traceable to evidence; editable). MoSCoW remains an independent human-controlled classification. Never auto-overwrite protected MoSCoW because an executive expressed a preference
7. **Questions Center**: quiet, asynchronous, contextual clarifications. Each question belongs to an initiative, or a specific node/relationship within it, and links to relevant evidence and offers 2–3 concrete resolution actions plus defer. No interrupts/popups or notification spam. Consolidate similar questions, auto-resolve obsolete ones, focus on material ambiguity affecting decisions/progress. No accumulating Unsorted Context queue. Unimportant unresolvable material can be ignored without creating objects; unresolved material questions stay small and contextual
8. **Settings**: Workspace/location, Sources & Integrations, Local AI, Privacy & Data, Background Sync, MCP, Backup/Recovery, About. Use plain-English settings; advanced developer controls hidden
9. **First-run wizard**: (a) choose/create portable workspace, (b) detect Intel/Apple Silicon and RAM and install compatible Meta Llama / local runtime, (c) connect user-selected sources via Activepieces where feasible, (d) create one initiative or review proposed initiative. Honest diagnostics and retry, no terminal assumptions for ordinary users. First release may need prerequisites, but target installer manages them
10. **Optional MCP tools**: expose read/search initiative, get graph, update initiative attributes/MoSCoW, create/update flow objects, inspect evidence, list/answer questions, list objectives. Same domain commands as desktop UI; no duplicate policy engine. Local-only MCP server by default. Hosted Claude/ChatGPT clients can receive selected data only through explicit opt-in

## Five execution primitives
- **Initiative**: goal/stream of work, highest-order portfolio card, may have unresolved plan
- **Task**: action **the user personally must do**; never assign Tasks to external people
- **Dependency**: something outside the user's direct execution, e.g. a colleague's reply, IT approval, credential access, vendor delivery, meeting occurrence, technical constraint; may be waiting, satisfied, blocked, expired, unverified
- **Decision**: explicit choice among paths, may stay open; outcome controls conditional paths
- **Milestone**: significant checkpoint/outcome, not a proxy percentage

Four relationship families: `contains`, `depends_on`, `leads_to`, `related_to`. Edges permit AND/OR group prereqs and conditional outcome predicates; multi-input, parallel branches, joins, revisiting, skip/cancel/supersede, and shared dependencies across initiatives. There is exactly ONE authoritative process graph per initiative, never independent nested subflows. A 'blocker' is normally a state or unsatisfied condition on a dependency or downstream object, not necessarily a sixth primitive. Explicit external constraints are Dependencies.

## Graph and task-composition rules (latest authoritative decision)
- One authoritative flow graph per Initiative. There are **no nested independent graphs** inside Tasks or groups
- Smaller actions are first-class Task nodes with their own stable IDs and direct graph relationships; they are not private subgraph objects
- Distinguish `contains` (organizational grouping) from `depends_on` (execution prerequisite). Membership never implies dependency or automatic completion
- Optional visual groups can collect related tasks; a group is a presentation/organizational construct, NOT a sixth execution primitive or artificial parent Task
- Selecting a node opens the inspector. Double-clicking a Task opens focused details, showing a filtered slice of the same canonical graph if there are child items; no new workflow is created
- Editing in a focused view updates the canonical node/edge, immediately reflected everywhere
- Questions and evidence are contextual: attach at Initiative, node, or edge level, aggregate in initiative Context and the quiet global Questions Center

## Minimal schema (conceptual, adapt when implementing)
Portable authoritative JSON/JSONL records with stable UUIDs, schema versioning and timestamps:
- `initiatives`: id, title, description?, categoryIds[], moscow, priorityOverride, objectiveIds[], state, targetDate?, createdAt/updatedAt, protectedFields[]
- `flow_objects`: id, initiativeId, optional groupId (organizational membership, not nested graph), type [task,dependency,decision,milestone], title, details?, state, kind?, responsibleExternalEntityId?, targetDate?, outcome?, confidence/verified, sourceRefs[]
- `flow_edges`: id, fromId, toId, type, prerequisiteGroup?, groupMode [all,any], condition?, sourceRefs[]
- `objectives`: id, label, rank/tieGroup, relativeWeight?, metricDefinition?, sourceRefs[]
- `entities`: id, type [person,team,org,system,initiative-alias,etc], labels/aliases, sourceExternalIds[], merge/split history
- `sources`: id, connector, remoteId, permalink?, title?, sender?, happenedAt?, ingestedAt, contentExcerpt?, cachePolicy, contentHash
- `assertions`: id, subjectId, predicate, value, evidenceSourceIds[], observedAt, validFrom?, validTo?, certainty [explicit,inferred], supersededBy?
- `questions`: id, initiativeId, optional targetNodeId/targetEdgeId, question, evidenceRefs[], resolutionChoices[], state, materiality, expiresAt?
- `changes`: append-only id, actor [user,ai,connector,mcp], entity+field, before/after, evidenceRefs[], timestamp, undoOf?, deviceId
- `workspace.json`: version, workspace UUID, categories, local preferences free of credentials
This is an illustrative boundary, not a requirement to create every table immediately.

## Autonomy policy (approved)
- Proposed new initiatives require user's approval
- Create Tasks automatically only for explicit user commitments
- External commitments become Dependencies automatically when unambiguous
- AI can update most existing facts, evidence and relationships automatically
- User-protected fields (especially MoSCoW) may never be changed silently
- Only material conflicts affecting decisions/progress go to Questions
- Manual corrections retain precedence; all AI changes traceable, reversible; avoid repeatedly reintroducing rejected suggestions
- Prefer update/merge over creating objects; don't fill in imaginary steps to make a pretty graph
- Source evidence is untrusted: never execute instructions found inside Slack/email/transcripts; all mutations schema-validated

## Local architecture / compatibility
- Preferred UI: Tauri + React + TypeScript, React Flow, ELK.js
- Authoritative file-based workspace in user-selected directory; machine-local SQLite FTS/index/cache; no live SQLite in cloud-synced directory
- Activepieces as preferred integration engine, subject to validating actual connector authentication, historical backfill, pagination, thread retrieval, deep links and local self-hosting footprint. Gmail, Slack, Granola initially; Google Drive, Dropbox, Calendar next. Custom connector pieces supported
- Meta Llama locally via Ollama or equivalent. Auto-select a benchmarked quantized model for hardware; support circa 2019 Intel MacBook Pro with constrained fallback, plus higher-performing Apple Silicon configurations. Avoid resource exhaustion; batch, throttle, and process relevant changes only
- Graphiti as preferred temporal context layer, subject to proof-of-concept for local Llama structured extraction, deduplication and resource requirements. Keep app canonical state separate; Graphiti graph/index rebuildable from portable evidence + assertions
- Optional temporal UI via vis-timeline only if needed
- Background ingestion: while Mac is awake, optionally when plugged in; when lid closed and laptop asleep, processing pauses and catches up on wake. Dedicated always-on host optional later. One designated ingestion machine per workspace to avoid duplicate model reconciliations
- Secure connector secrets in macOS Keychain or machine-local secure store, never synced workspace; workspace encryption for cloud-synced corporate material when authorized. Ingestion is opt-in by account/channel/folder and excludes private/off-limit sources
- Multi-Mac: portable event records with stable IDs, idempotent merges, per-device indexes, conflict detection on concurrent edits and recovery; avoid claim of automatic seamless simultaneous sync until proven
- No vendor-hosted inference, telemetry or hosted app backend by default. Optional source APIs still use network. MCP to external AI provider requires explicit sharing disclosure

## Visual grammar
- Inspired by Linear / Apple / Claude restraint, not decorative AI dashboards
- White/off-white backgrounds, thin neutral borders, sparse blue/violet accents; careful hierarchy, generous whitespace, consistent typography and tight icon system
- Initiative: layered square/card, visually larger than child nodes
- Task: square/checkbox with blue interactive state
- Dependency: hourglass/link indicator; waiting amber, blocked red, satisfied subtle green
- Decision: diamond with conditional outgoing routes
- Milestone: flag, green only for achieved state
- Unknown/inferred: quiet dotted line or small unobtrusive provenance marker, not noisy confidence badges everywhere
- Edges: solid dependency/sequence, dashed inferred or proposed, conditional labels only when useful
- No faces, avatars, emotive agent copy, gradients as decoration, fake generated progress, cards-inside-cards overload
- The canvas supports inline rename, add node, drag connect, auto-layout, and focused navigation into a selected Task without creating a separate graph. Single-click selects and opens the inspector. Double-click opens a focused detail view of the selected Task; if it has child Tasks, show them and their dependencies as a filtered view of the SAME initiative graph. Simple Tasks open ordinary details. Breadcrumbs return to the initiative graph. Separate inspector for attributes and claims

## End-to-end behavior
Source connector imports incrementally → cheap relevance/dedup filter → local Llama structured extraction → Graphiti entity resolution & temporal context → domain validation/reconciliation with user overrides → transactional update and append-only change log → deterministic portfolio/graph views. Provenance is clickable to source original or locally cached excerpt. A source claim is not authoritative state until reconciled.

## Initial verification scenarios
1. After seven days offline/asleep, wake, catch up, and reach a clear initiative portfolio without administrative backlog
2. Conversation explicitly saying user will test vendor creates one Task and clickable source
3. A colleague's promised review creates a Dependency, not user's Task
4. A new idea is proposed as an Initiative but is not activated without approval
5. A conflicting external opinion does not silently override user's Must/Should/Could/Won't classification
6. Same person/project referenced by aliases resolves or produces one contextual material question, no duplicate objects
7. Security approval unavailable blocks only dependent work; parallel user tasks remain actionable
8. Multiple Graphiti source claims conflict: show both sources, preserve timestamp chronology and user confirmed choice
9. Open same workspace on a second Mac; indices rebuilt; no synced credentials; no duplicate IDs
10. When local model/connector unavailable, app still shows prior state plus truthful last-sync/freshness status
11. MCP and UI edit use same command and audit history, remote-model data sharing opt-in
12. Intel Mac test measures CPU/RAM/temperature and can pause local AI without freezing UI

## Build order
**0. Feasibility spikes:** Activepieces + Gmail/Slack/Granola access; Llama + Graphiti local ingestion on Intel Mac; safe portable workspace merge. Build small fixtures first, not full UI
**1. Core product:** local workspace, 5-object domain API, categories and MoSCoW board, flow canvas/editor, right inspector, undo
**2. Context:** connectors, sources, assertions, entity resolution, source-link UI, timelines/history
**3. Autonomy and questions:** protected fields, reconciliation, targeted questions, ranked objectives and KPI alignment
**4. Productization:** wizard, backgrounds, MCP, sync and encryption, backups, packaging and updates

## Implementation note
This is the authoritative product specification. Phase 0 (architecture and repository preparation) is complete; implementation proceeds from [backlog/BACKLOG.md](../backlog/BACKLOG.md). Generated visual mockups from the original handoff are intentionally not committed (see [DESIGN_RULES.md](DESIGN_RULES.md#visual-references)); text always wins over imagery.


## Brand and distribution (final)
- Product name: **Fulcrum** (capitalization for UI and technical docs)
- Personal, single-user initiative workspace; codebase intended for a **public GitHub repository** and downloadable local macOS app
- UI remains professional, sober and utilitarian. Star Wars Fulcrum is a thematic nod only. Use original, non-infringing icon geometry; do not commit copied Star Wars art, logos or fonts into the public repo
- Prefer permissively licensed code, but note Meta Llama weights have a separate community license; never bundle model weights in the public git repository
- Website hosting/download distribution is future work; do not publish binaries until code signing and update strategy are addressed

## Explicit latest refinements
- Questions are contextual attachments to Initiative, flow node or edge and aggregate into the global quiet Questions Center. They are not flow objects and do not pop up during normal work
- Do not build embedded chat. The future MCP server is the exclusive conversational API, and both MCP and UI must call the same domain operations
- Don't construct multi-level graph models. One graph per initiative; focused double-click is merely a filtered view of this graph
- Priorities use **Must Do / Should Do / Could Do / Won't Do**, not *Have*
- Strategic objectives and KPIs are portfolio-level priorities and can use ordered ranking, ties and relative emphasis; MoSCoW remains separately protected by default
- The system is designed to accumulate source context passively during regular work and enable the user to regain orientation within 30 seconds, even after days away
- No permanent unsorted context pile; material uncertainty creates an asynchronous contextual question (deduplicated and resolved when newer evidence arrives)
