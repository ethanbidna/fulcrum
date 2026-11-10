# Desktop shell and portfolio (U1/U2)

React + Vite views use `CoreTransport` through a `Platform` adapter. Navigation
contains Initiatives, Priorities, Questions and Settings. The question count is
read from the core and refreshed after AppliedChange and every 30 seconds.
Failed reads hide stale counts and expose retry. Route changes focus the heading;
links support browser history and keyboard activation.

The portfolio displays active initiatives in Category / MoSCoW / Team / Objective
/ None groups with independent Manual order / MoSCoW / Last changed / Date sorting.
Manual drag and earlier/later buttons commit one undoable initiative.rerank batch;
missing/duplicate old ranks are normalized atomically. Movement changes no grouping
fields. UI data refreshes from acknowledged projections; failed writes retain the
prior board. New initiative is an explicit user command. Flow/detail navigation,
objective ranking and settings remain later workflows. U8 supplies question review.

Cards contain one domain-derived state, restrained metadata and an honest unknown
source-freshness indicator. No ingestion status is wired yet; updatedAt is never
presented as proof of a successful source sync. The context rail collapses in place
and moves below the board in narrow windows. Proposed initiatives never become
active cards. The Questions count includes their contextual approval questions.

## Review in a browser

Install Node 22 LTS and pnpm 10.11.0. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Open `http://127.0.0.1:5173`. This launches a real file-backed core and the separate
C6 development bridge against a new disposable synthetic workspace seeded from fixtures/states/portfolio.state.json through domain commands in the OS
temporary directory. It never reads/writes Keychain, starts a model runtime, calls
connectors or opens an existing workspace. An explicit command request can call
an already running local Ollama; ordinary browsing does not invoke inference. Ctrl-C shuts down the session and
removes its temporary workspace. Port 5173 must be free; it never selects another
port silently. Do not use this disposable launcher for real work.

Check all four destinations, back/forward, Tab/Shift-Tab/Enter, selected location,
heading focus, and narrow-window reflow. Zero questions intentionally has no badge.
Compare `src/ui/tokens.css` with `../../docs/DESIGN_RULES.md`.

For an explicitly configured existing development bridge, set
`FULCRUM_DEV_SESSION` to its private `dev-session.json` and run
`pnpm --filter @fulcrum/desktop dev`. The bootstrap endpoint requires the exact
loopback Host and same-origin Fetch Metadata; session files must be owned regular
0600 files, never symlinks. Tokens are not put in URLs, localStorage, compiled
assets or console output. Vite's trusted development process can serve workspace
source; this is not a hardened remote service.

## Native shell

Install stable Rust/Cargo and Xcode Command Line Tools. Build/start the C6 core
following `../core/README.md` with a user-selected synthetic workspace and the
stable synthetic user ID below. Keep that process running. The production profile
is fixed by the core; do not run a second production core.

```sh
pnpm --filter @fulcrum/core build
workspaceDirectory="$(mktemp -d)/review.fulcrum"
node apps/core/dist/core.mjs --workspace "$workspaceDirectory" --user-entity 07000000-0000-7000-8000-000000000001 --create
```

In a second terminal at the repository root:

```sh
pnpm --filter @fulcrum/desktop tauri dev
```

The Tauri UI uses native IPC even in development. Rust reads the existing
`Fulcrum.Core` / `local-client` Keychain item; it never creates or exports a
credential to JavaScript. Requests use the fixed private core socket, authenticate
natively, and are limited to health/query/execute plus native subscriptions.
Keychain and socket I/O have deadlines. Subscriptions are closed on retry/exit.
No filesystem, shell-spawn or network plugin permissions are granted to the UI.
The native development CSP allows Vite styles/HMR only in development; the
release CSP permits native IPC and local packaged assets.
The [Tauri command](https://v2.tauri.app/develop/calling-rust/) and
[event](https://v2.tauri.app/develop/calling-frontend/) APIs are isolated in the
platform adapter. The [Vite server](https://vite.dev/config/server-options) uses
loopback and a strict port.

`pnpm --filter @fulcrum/desktop build` builds the release frontend, excluding the
browser session bootstrap and WebSocket channel. `cargo test --manifest-path
apps/desktop/src-tauri/Cargo.toml` tests the native socket protocol with synthetic
servers. `pnpm --filter @fulcrum/desktop tauri build --debug --no-bundle` compiles the development shell against the production frontend.
CI compiles/tests Intel and ARM separately; it does not prove visible-window or
Keychain acceptance.

The app currently attaches to an already running C6 core. Automatic launch,
standalone runtime selection/bundling, first-run configuration and signing remain
S7/P2/P5 work; this does not choose a provisional packaging runtime. Do not ship
or publish an unsigned app as a release. Actual Keychain prompts/ACLs, native
visible-window behavior and owner usability review must be recorded separately.

## Owner acceptance

Record browser/native observations and blockers in `docs/reviews/U1.md` (synthetic
content only), then tick the Owner box for step 16 in `backlog/PROGRESS.md` once
the app feels right. Leave blocked native checks explicit. Never tick other
hardware, model, connector or packaging checks based on this review.

## Portfolio verification

The browser review uses the real file-backed core and the committed synthetic
portfolio. Initial seeding can take around a minute on a busy machine; wait for
readiness. Record differences from fixture bootstrap history honestly: seeding
creates real synthetic events, so recent changes display those events.

Card snapshots cover all four derived states. Tests cover every grouping, stable
sorts, absent/duplicate ranks, atomic rollback/undo, MCP scope, explicit creation,
failed commands and stale connection disposal. Actual browser drag persisted
after reload; grouping/sorting and rail collapse were exercised. This is not a
sync-provider or target-hardware performance acceptance.

[dnd kit](https://dndkit.com/react/guides/sortable-state-management/) supplies
pointer/keyboard sorting and named screen-reader announcements;
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) supplies
rank strings. Drag style injection receives the packaged stylesheet nonce when
Tauri supplies it; no release CSP permission is relaxed. Native visible-window,
CSP interaction and Keychain acceptance remain owner checks. Cargo.lock now uses
the dependency selection actually produced by U1 macOS CI, and native CI checks
it with --locked.

Record portfolio observations in docs/reviews/U2.md, then tick the Owner box for
step 17 after review. Existing U1 and feasibility owner checks remain separate.

## U3 flow canvas

Open a portfolio title to enter its one canonical graph. React Flow supplies
pan/zoom/fit, keyboard selection/movement and drag-connect; ELK layered layout
arranges nodes and presentation groups. The editor loads separately from the
portfolio. Prerequisite arrows point prerequisite → dependent while storage keeps
`dependent depends_on prerequisite`. Contains remains organizational only.

Add node is inline; Decisions require two user-entered routes. Select a node for
inline Rename, or a relationship for Delete. Connecting proposes an inline typed
relationship form before saving; Connect nodes also works without dragging.
Human domain invariant messages appear in place, and failed drafts remain.
Every semantic mutation uses the existing core commands; only acknowledged reads
update canonical content. Undo/⌘Z restores the last acknowledged user event from
this UI session, including a node's deleted edges. Text inputs retain native undo.
No redo or cross-session undo history UI is supplied by U3.

Node positions and viewport are ephemeral presentation state: dragging or
Auto-layout creates no workspace events and does not survive reopening. Canonical
schemas have no coordinates, and no schema change is introduced here. Shared
prerequisites are read-only references linking to their home initiative. Full
attribute/evidence inspector and focused navigation are U4, not another graph.

Verified against the real synthetic file-backed core in the browser; see
[U3 review](../../docs/reviews/U3.md) and the screenshots under
`.impeccable/review/u3/`. Native visible launch/Keychain and packaged CSP behavior
remain unverified. Source status/connector/model behavior is not accepted here.
Libraries: [React Flow](https://reactflow.dev/learn/customization/custom-nodes)
and [ELK layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html).

## U4 inspector and Task focus

Select a node or edge for its inline attributes/state, distinct attached evidence
source count, and open questions on that exact object. With no selection the
inspector shows the initiative's description and deterministic next-action state.
Hide the inspector from its heading or toolbar; it returns beside the canvas on
wide windows and below it in narrow windows. No modal or separate graph is used.

Node title/details/state and relationship label edits use existing Domain commands;
Decision outcomes use `decision.decide`. Simple Task children use checkboxes that
change only that child's state. Task ownership is never exposed. Full source and
question-resolution controls are now shared with the U8 Questions Center.

Double-click a Task or use Focus task. The URL records initiative and focused node;
`graph.focus` returns the same canonical nodes/edges, contains descendants and
immediate prerequisite references. Breadcrumbs return to the full graph, and an
edit is immediately visible there. References are inspectable but read-only in
this view; Open home initiative provides the editing location. Selecting a child
from its checklist highlights that canonical canvas node.

See [U4 review](../../docs/reviews/U4.md) and paired focused/full edit screenshots
in `.impeccable/review/u4/`. Native launch, Keychain, packaged CSP, sync/hardware and
owner usability are not accepted by the browser or CI checks.

## Natural-language commands (U4a)

Use the inline input on any page, or focus it with Cmd-K (Ctrl-K off macOS).
Enter drafts a plan; inspect the named changes, then Cmd-Enter/Ctrl-Enter or
Apply changes commits one atomic event. Escape cancels/dismisses; Undo command
reverses that exact event. Selecting an object supplies context; in a focused
Task view, “this task” continues to mean the focused Task after deselection.
Manual attributes/state controls remain under Edit directly in the inspector.
There is no ongoing chat transcript.

For model-generated requests, configure a model in Settings → Local AI. AI starts off; the former
`--command-model` override is rejected. P2 uses a separate managed runtime and
does not adopt an existing benchmark server or global weights. See
[the setup review](../../docs/reviews/P2.md).

Examples in the synthetic Vendor evaluation fixture:

- `Rename Test design capabilities to Synthetic design review.`
- `Add a child task called Prepare launch notes under this task.` (focused Task)
- `Make Security approval a prerequisite of Run sample design export.`

The command bar and MCP use the same domain commands. MCP remains separately
disabled by default and requires its explicit sharing configuration; the command
bar does not enable external access. See [U4a review](../../docs/reviews/U4a.md)
for measured results and pending native/owner checks.

## List and History (U5)

Flow, List and History are lateral initiative routes. List uses the same canonical
records and containment hierarchy; prerequisites remain separate. Titles edit
inline: Enter or blur saves, Escape restores. Other edits remain available through
the command input. A refresh retains unsaved/rejected titles.

History records actor, command, before/after and attached evidence. Undo change
compensates one event; Undo AI run compensates the entire indicated run, even
across initiatives. Later-write conflicts remain visible domain errors. Evidence
with a safe HTTP(S) permalink opens the original; other evidence remains named
without inventing a link. Native external-link behavior requires owner acceptance.
No model, connector or external client is needed to use these views.


## Questions Center (U8)

Questions opens a quiet list grouped by initiative. Portfolio question counts and
initiative links open `#questions/<initiativeId>`; All questions returns to the
global list. Show questions separates open, deferred, answered and obsolete
records. Questions attached to a selected node or relationship also appear with
controls in its inspector; shared prerequisite references remain read-only.

Evidence expands inline, shows event/learned timestamps, respects excerpt cache
policy and opens only safe original links. A resolution sends question.resolve
by question/choice ID through the same core used by other edits. Defer offers
Tomorrow, Next week or Until I return; it never creates a popup. Acknowledged
changes expose Undo. Pending actions disable, failures remain inline, and saved
feedback receives keyboard focus. Context links select the exact flow object.

See [the synthetic review captures and owner checklist](../../docs/reviews/U8.md).
Native launch and owner usability checks remain pending.
