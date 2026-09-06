---
name: Chibako
description: Private self-hosted second brain with agent-native Markdown notes.
colors:
  accent: "#7C5CFF"
  bg: "#FAFAF8"
  bg-panel: "#F7F7F5"
  bg-elevated: "#FFFFFF"
  border: "#E5E5E3"
  text: "#2D2D2D"
  text-muted: "#787876"
  text-faint: "#A0A09E"
  hover: "#F3F3F1"
  mark: "#FFECB3"
  primary: "oklch(0.508 0.118 165.612)"
  primary-foreground: "oklch(0.979 0.021 166.113)"
  destructive: "oklch(0.577 0.245 27.325)"
  graph-wiki: "#10B981"
  graph-index: "#F59E0B"
typography:
  display:
    fontFamily: "Figtree, Source Sans 3, system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Figtree, Source Sans 3, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Figtree, Source Sans 3, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "Source Sans 3, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 550
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "4px"
  md: "6px"
  lg: "7px"
  xl: "10px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "6px 11px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "6px 11px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.lg}"
    padding: "6px 11px"
  input:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    rounded: "8px"
    padding: "7px 12px"
  card:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "16px"
  tree-item-active:
    backgroundColor: "rgba(124, 92, 255, 0.12)"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
---

# Design System: Chibako

## Overview

**Creative North Star: "The Ink Archive"**

Chibako is a calm, precise operating surface for private thinking. Warm paper backgrounds carry dense Markdown reading; a single ink-violet accent marks links, active states, and primary actions — nothing else competes for attention. The chrome is small, quiet, and keyboard-driven; content carries all visual weight.

State is conveyed with borders and tonal steps, never resting shadows. Dark mode is a true inverse (deep zinc panels, same violet voice) rather than a dimmed afterthought.

**Key Characteristics:**
- Warm paper surfaces with ink-charcoal text, one violet voice
- Small quiet controls (6–10px radii, fast 120ms hovers)
- Borders and tonal layering carry depth; shadows reserved for popovers
- Reading-first density: 15–15.5px body, generous 1.6–1.7 line height
- Tactile and confident interactions without ornament

## Colors

One violet accent on warm paper neutrals; shadcn teal reserved for shadcn primitives only.

### Primary
- **Signal Violet** (#7C5CFF, `rgb(124 92 255)`): links, wikilinks, active tree item, primary button, caret, focus glow, graph `note` nodes. The only saturated voice.

### Secondary (optional; omit if the project has only one accent)
- **Shadcn Teal** (oklch(0.508 0.118 165.612)): shadcn `Button` default variant and sidebar-primary only. Do not mix with Signal Violet on the same control.

### Tertiary (optional)
- **Wiki Emerald** (#10B981): graph `wiki` nodes only.
- **Index Amber** (#F59E0B): graph `index` nodes only.
- **Highlight Parchment** (#FFECB3, dark: `rgb(82 66 28)`): `mark` and search-hit background.

### Neutral
- **Warm Paper** (#FAFAF8, dark: `rgb(24 24 27)`): app background.
- **Panel Paper** (#F7F7F5, dark: `rgb(28 28 32)`): code blocks, table headers, kbd wells, `pre` surfaces.
- **Elevated White** (#FFFFFF, dark: `rgb(32 32 36)`): cards, inputs, dropdowns, dialogs.
- **Hairline** (#E5E5E3, dark: `rgb(48 48 53)`): all borders, dividers, table and input strokes.
- **Hover Wash** (#F3F3F1, dark: `rgb(40 40 45)`): hover fills, inline-code fill, blockquote fill.
- **Ink Charcoal** (#2D2D2D, dark: `rgb(226 226 229)`): primary text.
- **Muted Ink** (#787876, dark: `rgb(150 150 156)`): secondary text, ghost buttons, tree items.
- **Faint Ink** (#A0A09E, dark: `rgb(105 105 112)`): placeholders, missing wikilinks, search icons.

### Named Rules (optional, powerful)
**The One Voice Rule.** Signal Violet appears on ≤10% of any screen — links, the active row, one primary action. Its rarity is the point; never fill large surfaces with it.
**The Paper Stack Rule.** Depth goes Paper → Panel → Elevated White, separated by Hairline borders. Do not introduce a fourth surface tone.

## Typography

**Display Font:** Figtree (with Source Sans 3 fallback)
**Body Font:** Source Sans 3 (with system-ui fallback)
**Label/Mono Font:** ui-monospace stack (SFMono-Regular, Menlo, Monaco, Consolas) for editor, code, and kbd hints

**Character:** Quiet editorial pairing — Figtree headlines with tight tracking against a highly legible Source Sans body; monospace reserved for the working surface (editor, code, keystrokes).

### Hierarchy
- **Display** (650, 29px / 1.85em, 1.3, -0.015em): rendered Markdown `h1`; also note titles.
- **Headline** (650, 22px / 1.45em, 1.3): rendered Markdown `h2`, with Hairline underline.
- **Title** (650, 18px / 1.18em, 1.3): rendered `h3`; dialogs and sheet titles use Figtree 14px medium.
- **Body** (400, 15px, 1.6; preview 15.5px / 1.7, max ~75ch): app text and `.md` paragraphs.
- **Label** (550, 13.5px / 0.84–0.88rem, 1.4): buttons (`.btn`), tree items, inputs, nav.

### Named Rules (optional)
**The Weight-650 Rule.** Headings and strong text use weight 650, never full bold — emphasis stays ink-like, not poster-like.

## Layout

App shell: fixed sidebar (folder tree, recents, pins, Trash) + top bar (pill search, actions, theme toggle) + central note column. Editor supports edit / split / preview with persisted view mode (`chibako_view`); flush-on-leave and `beforeunload` guard.

Density is comfortable-tight: tree rows ~4px vertical padding, buttons ~6px, inputs ~7px, cards 16px. Rhythm follows an 8px base (8 / 16 / 24). Search caps at `max-w-md`; dropdowns float full-width under the field. Mobile collapses the sidebar into a Sheet drawer behind a hamburger; top bar keeps search + primary actions.

Graph view is a full-bleed force canvas with a floating filter bar (zoom/pan, orphans toggle, folder filter); nodes scale by kind (index 11 / wiki 8 / note 6).

## Elevation & Depth

Flat by default. Resting surfaces carry zero shadow — depth comes from Hairline borders and the three-step paper stack. Shadows appear only as a response to floating: search results, command palette, dialogs, and sheets.

### Shadow Vocabulary (if applicable)
- **Floating popover** (`box-shadow: 0 8px 10px -6px rgb(0 0 0 / 0.1), 0 20px 25px -5px rgb(0 0 0 / 0.1)`): search dropdown, palette, dialog, sheet.
- **Focus glow** (`box-shadow: 0 0 0 3px rgb(124 92 255 / 0.15)`): focused `.input` with violet-tinted border.

### Named Rules (optional)
**The Borders-Only Rule.** Borders only, no resting shadows. If a card needs more separation, step its background tone — do not add a shadow.

## Shapes

Gently rounded rectangles everywhere; circles reserved for status dots and graph nodes. Radius strategy: code and tags (4px) → tree rows (6px) → buttons (7px) → inputs, pre, images (8px) → cards (10px) → search field and dropdowns (pill / 12px). Kbd hints are 5px with a 2px bottom border for a keycap edge. Wikilinks use a dashed violet underline that goes solid on hover; missing links fall back to Faint Ink. Blockquotes get a 3px violet edge with a soft wash fill and 0–6px rounding.

## Components

### Buttons
Tactile and confident, small and quiet.
- **Shape:** gently rounded (7px)
- **Primary:** Signal Violet fill with white text, 6px 11px padding; hover deepens to 90% violet
- **Hover / Focus:** ghost (`.btn`) shifts Muted Ink → Ink on Hover Wash; focus shows ring; active presses translate 1px (shadcn)
- **Secondary / Ghost / Tertiary (if applicable):** shadcn `outline` / `secondary` / `ghost` / `destructive` / `link` variants exist for dialogs and settings; app chrome prefers `.btn` ghost + `.btn-primary`

### Chips (if used)
- **Style:** scope chips and kind dots in sidebar/graph filter; Hairline border on Panel fill, Muted Ink text
- **State:** selected state uses violet wash (`rgb(124 92 255 / 0.12)`) with violet text

### Cards / Containers
- **Corner Style:** softly rounded (10px)
- **Background:** Elevated White on Paper
- **Shadow Strategy:** none at rest (see Borders-Only Rule); popover shadow only when floating
- **Border:** 1px Hairline
- **Internal Padding:** 16px scale

### Inputs / Fields
- **Style:** Elevated White fill, 1px Hairline stroke, 8px radius (pill for top-bar search), 7px 12px padding
- **Focus:** violet-tinted border (`rgb(124 92 255 / 0.6)`) + 3px violet glow
- **Error / Disabled:** destructive oklch red for purge/revoke confirms; disabled at 50% opacity, no pointer events

### Navigation
Sidebar tree rows (0.88rem, Muted Ink) with 6px rounding; hover applies Hover Wash; active applies violet wash + violet text + 550 weight. Top bar is a Hairline-bottomed strip with pill search (magnifier icon, `⌘K` hint, spinner). Icon buttons carry themed tooltips with shortcut hints. Mobile nav moves into a left Sheet drawer.

### Graph Nodes (signature)
Force-directed circles with 2px Elevated-White stroke: violet (note, r6), emerald (wiki, r8), amber (index, r11). Edges are 1px Hairline. Dimmed (non-matching) nodes drop to 15% opacity. Click navigates to the note; hover raises a label card.

### Wiki Links (signature)
Violet text with dashed violet underline; hover fills violet wash and solidifies the rule. `.missing` renders in Faint Ink and opens the create-note dialog on click.

## Do's and Don'ts

Concrete guardrails grounded in the incumbent implementation.

### Do:
- **Do** keep violet rare — links, active row, one primary action per screen (The One Voice Rule).
- **Do** separate surfaces with Hairline borders on the Paper → Panel → Elevated stack.
- **Do** use weight 650 and -0.015em tracking for headings; body stays 15–15.5px at 1.6–1.7 line height.
- **Do** give every icon button a themed tooltip with its shortcut (`.kbd` hint).
- **Do** honor both themes — every paper/ink token has a dark inverse; violet stays constant.

### Don't:
- **Don't** add resting box-shadows to cards, sidebars, or editor panes (borders only, no shadows).
- **Don't** fill large areas with violet or introduce new saturated hues outside graph kind colors.
- **Don't** use gradients, heavy shadows, or marketing ornament in app chrome.
- **Don't** mix shadcn Teal buttons and violet `.btn-primary` in the same row — pick one voice per surface.
- **Don't** render FTS snippets or Markdown preview without the established sanitize + `<mark>` highlight treatment.
