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
rounded:
  control: "6px"
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
---

# Design System: Fulcrum desktop

## Overview

**Creative North Star: "Four stable destinations"**

A white work area and cool neutral navigation make location and connection state easy to read. Muted blue identifies the selected destination and recovery actions; fine separators and restrained type establish hierarchy.

This records the implemented U1 shell, not later portfolio or graph workflows. ../../docs/DESIGN_RULES.md remains the higher visual authority; ../../docs/PRODUCT_SPEC.md remains the product authority. The owner pinned system fonts and this code-first shell.

**Key Characteristics:**
- White work area with cool neutral navigation.
- Muted blue selection and visible keyboard focus.
- Inline connection recovery and honest workflow notices.

## Colors

The palette uses cool neutrals, one muted blue accent and reserved semantic colors.

### Primary

- **Muted blue:** selected navigation, focus outlines and retry actions.
- **Deep muted blue:** primary-button hover.
- **Pale blue:** selected navigation and text selection.

### Neutral

- **White:** main work area and primary-button text.
- **Cool paper:** navigation surface.
- **Cool hover:** navigation hover and loading placeholders.
- **Charcoal:** primary text.
- **Slate:** supporting copy, counts and connection text.
- **Fine gray:** sidebar, header and connection separators.

### Named Rules

**The Quiet Accent Rule.** Reserve blue for selection, focus and actionable recovery.

Blocked red, waiting amber and completed green retain semantic roles from the higher visual contract. Only waiting and completed currently appear in connection dots; accompanying text conveys the state.

## Typography

**Body and heading font:** the platform system sans-serif stack in the tokens above. No separate display face is implemented.

### Hierarchy

- **Headline:** destination heading; tight tracking and compact line height.
- **Title:** connection or unavailable-workflow message heading.
- **Body:** descriptions, recovery copy and primary-button text.
- **Label:** navigation at medium weight.
- **Caption:** question and initiative counts; question counts use tabular numerals.
- **Status:** connection text.

The brand wordmark uses a local 17px, 600-weight treatment with -.02em tracking. Navigation becomes 12px on compact layouts. These are observed component treatments, not a separate display scale.

## Layout

Desktop uses a 216px navigation column beside a flexible work area, with a viewport-height minimum. Navigation has 32px top padding; main content has 40px padding. Settings rests at the navigation foot, above connection status. The page header uses a bottom separator and 24px bottom padding.

At 700px and below, navigation moves above content into four columns, the sidebar becomes a top region with 16px padding, and main padding becomes 32px vertically and 24px horizontally. At 430px and below, destinations form two columns. Destinations remain visible.

Message content is centered within a 460px maximum width. Its desktop top margin is max(64px, 12vh); compact layouts use 64px. The shared spacing rhythm is recorded above. These measurements describe the shell and do not prescribe future graph or portfolio composition.

## Elevation & Depth

No box shadows are implemented. Surface tone, whitespace and one-pixel separators distinguish regions. A primary button shifts down one pixel while active. Focus uses a two-pixel accent outline with a three-pixel offset, not a shadow.

## Shapes

Controls and loading placeholders use gently rounded corners from the control radius. Connection dots are circular. Fine straight separators organize the shell. Icons are consistent outline SVGs; the brand retains the original geometric SVG mark. No raster assets ship with this shell.

## Components

### Buttons

The primary retry action uses muted blue, white text, the control radius and 8px by 16px padding. Hover uses the deeper accent; active shifts down one pixel. The sidebar retry action is an unfilled text button with status-sized text and 8px vertical padding. Both inherit visible keyboard focus. Disabled buttons use a wait cursor and 0.6 opacity.

### Navigation

Four links identify Initiatives, Priorities, Questions and Settings. Links have a 38px minimum height, 8px by 12px padding, outline SVGs and medium-weight labels. Hover uses cool gray; the current page uses pale blue and muted blue text with aria-current. Background changes take 150ms ease-out. Compact navigation uses 8px padding and smaller labels.

### Connection status

An explicit text status accompanies a six-pixel dot. Connecting uses slate, unavailable uses waiting amber, and connected uses completed green. Only unavailable state exposes retry. This is local-core reachability, not initiative completion.

### Loading and workflow notices

Two static rounded loading lines accompany opening text and a busy section. Connected destinations state which workflows are unavailable. Counts appear only from connected-core queries; question count is quiet and shown only when positive. No card, chip or input primitive is implemented yet.

### Keyboard access

A skip link appears on focus. Destination changes focus the main heading; all interactive elements retain the shared visible focus outline. Reduced-motion preferences remove transitions.

## Do's and Don'ts

### Do:

- **Do** retain all four named destinations across viewport sizes.
- **Do** pair connection color with explicit status text.
- **Do** show visible keyboard focus and move focus to the destination heading.
- **Do** state unavailable workflows plainly in the main content.
- **Do** use the original geometric SVG mark.

### Don't:

- **Don't** add completion percentages, status columns, avatars or embedded AI chat.
- **Don't** turn Questions into an uncategorized inbox or interruptive popup.
- **Don't** use color as the only state cue.
- **Don't** infer unimplemented controls or workflow capabilities from this shell.
