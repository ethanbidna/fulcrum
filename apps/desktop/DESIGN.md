---
name: Fulcrum desktop
description: A restrained shell for a local personal workspace.
colors:
  surface: "#ffffff"
  surface-navigation: "#f6f7f9"
  surface-hover: "#eceef2"
  text: "#252930"
  text-secondary: "#616874"
  line: "#e2e5ea"
  line-control: "#aeb7c3"
  line-relationship: "#697381"
  accent: "#3e659a"
  accent-hover: "#315381"
  accent-surface: "#e7edf6"
  blocked: "#a74343"
  waiting: "#88621e"
  completed: "#427056"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  status:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  card-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.015em"
  card-state:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  rail-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  card-description:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  group-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  brand:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.02em"
rounded:
  control: "6px"
  card: "12px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-text:
    textColor: "{colors.accent}"
    padding: "8px 0"
    typography: "{typography.status}"
  navigation-link:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    typography: "{typography.label}"
  navigation-link-current:
    backgroundColor: "{colors.accent-surface}"
    textColor: "{colors.accent}"
  connection-status:
    textColor: "{colors.text-secondary}"
    typography: "{typography.status}"
  loading-line:
    backgroundColor: "{colors.surface-hover}"
    rounded: "{rounded.control}"
    height: "12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    typography: "{typography.body}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px"
    typography: "{typography.body}"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px"
  initiative-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "24px"
  initiative-card-title:
    typography: "{typography.card-title}"
  initiative-card-state:
    typography: "{typography.card-state}"
  portfolio-rail-title:
    typography: "{typography.rail-title}"
  flow-object:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    width: "224px"
    height: "108px"
  flow-route-label:
    backgroundColor: "{colors.surface-navigation}"
    textColor: "{colors.text}"
    padding: "3px 6px"
  rank-control:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "0"
    width: "24px"
    height: "24px"
---

# Design System: Fulcrum desktop

## Overview

**Creative North Star: "Four stable destinations"**

A white work area and cool neutral navigation make location and connection state easy to read. Muted blue identifies the selected destination and primary actions; fine separators and restrained type establish hierarchy.

This records the implemented U1 shell, U2 active-initiative portfolio and U3 editable initiative flow. Full inspector and focused navigation (U4), priorities, question-review and settings workflows remain outside this build. ../../docs/DESIGN_RULES.md remains the higher visual authority; ../../docs/PRODUCT_SPEC.md remains the product authority. The owner pinned system fonts and this code-first shell.

**Key Characteristics:**

- White work area with cool neutral navigation.
- Muted blue selection and visible keyboard focus.
- Inline connection recovery and honest workflow notices.
- Initiative cards with one meaningful state and a quiet optional context rail.
- A readable flow canvas with distinct object marks and explicit relationship labels.

## Colors

The palette uses cool neutrals, one muted blue accent and reserved semantic colors.

### Primary

- **Muted blue:** selected navigation, focus outlines, primary actions and link hover.
- **Deep muted blue:** primary-button hover.
- **Pale blue:** selected navigation and text selection.

### Neutral

- **White:** main work area and primary-button text.
- **Cool paper:** navigation surface.
- **Cool hover:** navigation hover and loading placeholders.
- **Charcoal:** primary text.
- **Slate:** supporting copy, counts and connection text.
- **Fine gray:** sidebar, header and connection separators.
- **Control gray:** stronger node outlines and flow-edit field borders distinguish interactive objects from the canvas.
- **Relationship slate:** graph strokes remain visible against the neutral canvas; selected edges use the accent.

### Named Rules

**The Quiet Accent Rule.** Reserve blue for selection, focus and actions.

Blocked red, waiting amber and completed green retain semantic roles from the higher visual contract. Waiting and completed appear in connection dots; blocked and waiting also distinguish card-state text. Explicit labels convey every state.

## Typography

**Body and heading font:** the platform system sans-serif stack in the tokens above. No separate display face is implemented.

### Hierarchy

- **Headline:** destination heading; tight tracking and compact line height.
- **Title:** connection or unavailable-workflow message heading.
- **Body:** descriptions, recovery copy and primary-button text.
- **Label:** navigation at medium weight.
- **Caption:** question and initiative counts; question counts use tabular numerals.
- **Status:** connection text.

The brand role records the existing wordmark treatment. Navigation becomes 12px on compact layouts. U2 adds card-title and card-state roles, rail-title, card-description and group-title; these extend the same system family. The inline creation heading shares card-title styling. MoSCoW labels use status-sized text at medium weight; card metadata and indicators use status-sized regular text. Rail item text is caption-sized, with status-sized secondary context. U3 reuses label-sized, medium-weight node titles; status-sized kind, state and ordinary relationship text; and caption-sized group, form and conditional-route labels. It introduces no new type size.

## Layout

Desktop uses a 216px navigation column beside a flexible work area, with a viewport-height minimum. Navigation has 32px top padding; main content has 40px padding. Settings rests at the navigation foot, above connection status. The page header uses a bottom separator and 24px bottom padding.

At 700px and below, navigation moves above content into four columns, the sidebar becomes a top region with 16px padding, and main padding becomes 32px vertically and 24px horizontally. At 430px and below, destinations form two columns. Destinations remain visible.

Message content is centered within a 460px maximum width. Its desktop top margin is max(64px, 12vh); compact layouts use 64px. The shared spacing rhythm is recorded above. These measurements describe the shell and do not prescribe future graph or portfolio composition.

Portfolio content uses wrapping toolbar controls above grouped card grids. Each grid auto-fits columns with a 260px minimum (bounded by the available width) and 16px gaps. Groups are separated by 40px. Cards use 24px padding and a 230px minimum height; at 700px and below the minimum height is removed. The sidebar is sticky above the compact breakpoint and its navigation can scroll.

The open context rail occupies 232px beside the cards with a 32px gap. At 1150px and below it moves beneath the board, replacing its left separator with a top separator. Hiding context removes the rail and lets the cards use the width. Inline creation uses a two-column 2:1 form with a 140px minimum secondary column; it becomes one column at 700px and below.

The initiative flow places a quiet attribute row and wrapping local toolbar above one neutral canvas. The canvas fills available width with a desktop height of max(560px, 100dvh minus 290px); at 640px and below its height is 560px and selection controls wrap. ELK arranges the same graph downward, with 40px between nodes and 72px between layers. Initial and auto-layout views begin at zoom 1 with the first top-row object inset 24px; Fit graph explicitly provides an overview. Panning and zooming retain access to the rest of the graph rather than shrinking initial text to fit everything. Positions and zoom are ephemeral view state.

## Elevation & Depth

No box shadows are implemented. Surface tone, whitespace and one-pixel separators distinguish regions. A primary button shifts down one pixel while active. Focus uses a two-pixel accent outline with a three-pixel offset, not a shadow.

## Shapes

Controls and loading placeholders use gently rounded corners from the control radius. Initiative cards introduce the larger card radius with one fine border and a white background; this component extension does not change the control radius. Connection dots are circular. Fine straight separators organize the shell. Icons are consistent outline SVGs; the brand retains the original geometric SVG mark. No raster assets ship with this shell. Flow objects and visual group frames reuse the control radius; the square Task, hourglass Dependency, diamond Decision and flag Milestone are outline SVG marks inside consistently rectangular nodes. Inferred records use dashed borders or strokes and an explicit node label. Group frames are light visual containers in the same graph, not nested graphs.

## Components

### Buttons

Primary retry and creation actions use muted blue, white text, the control radius and 8px by 16px padding. Hover uses the deeper accent; active shifts down one pixel. The sidebar retry action is an unfilled text button with status-sized text and 8px vertical padding. Secondary buttons use white, a one-pixel line border, 8px by 12px padding and gray hover. All buttons inherit visible keyboard focus. Disabled buttons use a wait cursor and 0.6 opacity.

### Navigation

Four links identify Initiatives, Priorities, Questions and Settings. Links have a 38px minimum height, 8px by 12px padding, outline SVGs and medium-weight labels. Hover uses cool gray; the current page uses pale blue and muted blue text with aria-current. Background changes take 150ms ease-out. Compact navigation uses 8px padding and smaller labels.

### Connection status

An explicit text status accompanies a six-pixel dot. Connecting uses slate, unavailable uses waiting amber, and connected uses completed green. Only unavailable state exposes retry. This is local-core reachability, not initiative completion.

### Loading and workflow notices

Two static rounded loading lines accompany opening text and a busy section. Connected Priorities, Questions and Settings destinations state which workflows are unavailable. Counts appear only from connected-core queries; card question links remain quiet and appear only when positive. No chip primitive is implemented.

### Portfolio toolbar and fields

Group by offers Category, MoSCoW, Team, Objective and None. Sort independently offers Manual order, MoSCoW, Last changed and Date. Labeled native selects and inputs use white, a fine border, the control radius and 8px padding; accent and caret use muted blue. View-control labels are caption-sized and stack above their selects at compact widths. Hiding context and opening New initiative use expanded-state semantics.

### Initiative cards

An initiative is a bordered card, not a task row or status column. Each card presents its MoSCoW label, title, optional two-line description, one meaningful current state, quiet category/date metadata and indicators. Description overflow is clamped to two lines. Blocked and waiting text use their semantic colors; unclear state uses secondary text. Optional due dates and quiet question links do not compete with the title or state. The clock icon explicitly labels source freshness unavailable until ingestion status is connected; it never implies known freshness.

Manual ordering exposes earlier/later buttons and a drag handle. Controls are 24px squares with a two-pixel gap, no resting fill, secondary text and gray hover. Disabled rank controls use 0.35 opacity and a default cursor; reordering is enabled only in manual order and when no command is pending. Space, arrows and Escape accompany pointer dragging, with announcements and focus restored after a successful move. Rank changes do not change grouping.

### Context rail

Next actions, Waiting on and Recently changed are separated by 32px, with 16px between entries. Compact rail headings use the rail-title role; item labels use caption text and secondary initiative context uses status text. Recently changed shows at most five meaningful entries with a concrete item or initiative context, action and date. The Questions link includes its quiet total. Empty sections use short factual text. Context collapses in place and reflows below the board on narrower windows.

### Inline creation

New initiative opens a labeled form beneath the toolbar, above the cards. Name is required and limited to 200 characters; MoSCoW supports Not set plus the four prescribed values. Create and Cancel remain in the page. Pending creation disables fields and actions; errors appear inline with alert semantics and blocked color. Successful creation closes the form. The empty board invites creation without inventing a workflow.

### Initiative flow

An initiative card title opens its flow beneath an Initiatives breadcrumb and the initiative heading; the initiative is the canvas container, never a graph node. Add node and Connect nodes reveal inline forms above the canvas. Selected nodes expose Rename locally; selection also exposes deletion in the toolbar. Auto-layout, Undo, labeled zoom controls and Fit graph remain visible. Full inspection and focused navigation belong to U4.

White flow objects use the stronger control border, 12px by 16px padding and a 224px by 108px base size. Titles clamp to two lines. Kind marks and labels distinguish Task, Dependency, Decision and Milestone. State text uses the reserved semantic colors; selection adds an accent border and outline. Shared references use the navigation surface, an explicit Shared reference label and an Open home initiative link; they are read-only here. Inferred nodes add an explicit Inferred label and dashed outline.

Relationship strokes use relationship slate and accent selection. Prerequisite and leads-to paths have arrowheads; containment is dotted and related-to is long-dashed. Inferred paths add a dashed treatment. Labels name relationships; conditional leads-to paths display the decision option label centered over their target, with a 24px gap before the target handle. Label backgrounds match the canvas and long route text wraps within 200px. This preserves route separation without introducing colored badges.

Flow edit fields reuse the control radius and stronger control border. Rename stays inside the selected node. Errors are inline and use alert semantics. Semantic edits and Undo pass through the core commands; dragging changes presentation only.

### Keyboard access

A skip link appears on focus. Destination changes focus the main heading; all interactive elements retain the shared visible focus outline. Reduced-motion preferences remove transitions.

## Do's and Don'ts

### Do:

- **Do** retain all four named destinations across viewport sizes.
- **Do** pair connection color with explicit status text.
- **Do** show visible keyboard focus and move focus to the destination heading.
- **Do** state unavailable workflows plainly in the main content.
- **Do** use the original geometric SVG mark.
- **Do** keep grouping independent of sorting and change only rank when reordering.
- **Do** keep creation inline and context collapsible within the portfolio.
- **Do** label unknown freshness honestly and preserve item context in recent changes.
- **Do** open flow at readable scale, with Fit graph as an explicit overview action.
- **Do** distinguish object types and inferred or shared records with labels and shape cues.
- **Do** keep graph editing inline and visual groups within the same graph.

### Don't:

- **Don't** add completion percentages, status columns, avatars or embedded AI chat.
- **Don't** turn Questions into an uncategorized inbox or interruptive popup.
- **Don't** use color as the only state cue.
- **Don't** infer unimplemented controls or workflow capabilities from this shell.
