# Visual and interaction design contract

**Reference standard:** Linear-like density, Apple-like clarity, serious desktop software. Avoid generic AI dashboard aesthetics and 'cute' styling. Reference images include inconsistent incidental decorative elements; this document always wins.

## Information architecture
- Home = initiative **cards**, not task rows or ready/in-progress Kanban columns. User-selectable grouping by category, team, strategic objective, MoSCoW or none; sort independently
- Each card: name, MoSCoW, one useful current-action/holding state (my next action, waiting on whom/what, blocked, or undefined), optional due date, quiet question indicator. No avatar portraits, duplicate source logos or activity essays
- Initiative detail defaults to one large flow canvas. Selecting a node/edge opens contextual inspector; double-clicking opens focused details/filtered view of the **same graph**, never another graph. Breadcrumbs back to initiative
- Small tasks with simple children may show a list/checklist in inspector; no required mini-graph or 'task manager' home
- Initiative Context aggregates context attached to initiative, node and edge; inspect individual evidence/source links on-demand
- Priorities: strategic objectives/KPIs ordered, ties supported; MoSCoW Must Do/Should Do/Could Do/Won't Do separate
- Questions: quiet badge and per-initiative questions; no interruption and no growing uncategorized inbox
- Timeline optional when dates exist. No fabricated percent completion
- Natural-language commands are available inline and through external MCP clients.
  Keep one request and a structured, explicitly applied review; no ongoing in-app
  chat transcript. Direct edit forms are secondary fallbacks (ADR-0017).

## Visual vocabulary
Use a restrained typographic system, white/neutral surfaces, near-monochrome sidebar/navigation and a single muted blue accent. Make hierarchy through spacing, weight and shape, not cards-inside-cards or badge overload. Flow nodes: Task (square), Dependency (distinct link/hourglass mark), Decision (diamond), Milestone (flag/terminal), initiative as canvas title/container, not a redundant first graph node. Semantic status: blocked red, waiting amber, completed muted green, inferred subdued dashed edge or indicator.

## A11y and interactions
Keyboard focus, labeled controls, tooltips when icons are ambiguous, legible density, color never sole signal; pan/zoom/fit; edit and undo; source-link open behavior.

## Branding
Name Fulcrum. Use original minimalist geometric pivot/junction symbol in [`assets/fulcrum-mark.svg`](../assets/fulcrum-mark.svg) (a beam on a triangular pivot with a point above; drawn for this project), not copied Star Wars insignia. The reference remains a private allusion and is never named in UI copy, assets or marketing.

## Visual references
The original handoff included four generated mockups. They are **not committed** to this public repository because they contain realistic-looking names and work content, and several rejected elements (percent/status pills, an "Inbox" queue, owner/people panels, a Kanban-like column board, a "Subtasks" table with other people as owners, an initiative node at the top of the graph). What to take from them, in words:

- **Initiative detail:** breadcrumb + large title row; a quiet attribute row (MoSCoW, category, objective, source count); one large flow canvas on the left two-thirds; a narrow right column for the inspector / overview (current state, waiting on, recent evidence). The graph flows top-to-bottom with a diamond Decision branching into labelled routes and a flag Milestone at the end.
- **Portfolio:** large page title; toolbar with Group by / Sort / Filter / New; cards grouped under section headings with generous gaps; a collapsible right rail with "Next actions", "Waiting on", "Recently changed".
- **Object vocabulary:** distinct glyph per primitive (square Task, hourglass/link Dependency, diamond Decision, flag Milestone).

Do **not** reproduce: progress bars or percentages, status columns, faces/avatars, people-as-owners tables, Slack/Gmail logos on cards, an Inbox, colored pill clutter, or the initiative rendered as the first node of its own graph.
