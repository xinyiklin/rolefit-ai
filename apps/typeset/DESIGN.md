---
name: Typeset
description: A calm, local-first document editor for precise resume typesetting.
colors:
  canvas: "#f0f2f5"
  surface: "#fbfbfd"
  surface-subtle: "#f0f2f6"
  ink: "#3a4250"
  ink-strong: "#1d2430"
  ink-muted: "#525d6d"
  line: "#e0e4eb"
  line-strong: "#bbc4d0"
  accent: "#b73847"
  accent-hover: "#982a38"
  accent-soft: "#fdecef"
  on-accent: "#ffffff"
  surface-raised: "#ffffff"
  positive: "#1e7a4c"
  danger: "#b3261e"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: "34px"
  toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "96px"
  popover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px"
---

# Design System: Typeset

## 1. Overview

**Creative North Star: "The Working Page"**

Typeset feels like opening a dedicated document editor at a quiet desk.
The page carries the visual weight. Toolbars, menus, and status text are exact,
familiar, and intentionally secondary. The interface borrows the legibility of
Pages, Word, and Google Docs without copying their density or general-purpose
complexity.

This is a restrained product system. It rejects the previous permanent sidebar,
generic SaaS cards, decorative branding, and technical export language. Detail
appears when requested, close to the command that revealed it.

**Key Characteristics:**

- A centered paper canvas with quiet cool-neutral surroundings.
- A compact two-row toolbar using standard document-editor grammar.
- One coral-rose accent, taken from the ribbon-T mark, reserved for the
  primary action and active state.
- Anchored formatting popovers that keep the changing page visible.
- Dense enough for expert control, calm enough for long editing sessions.

## 2. Colors

The palette is cool slate and paper with a single coral-rose accent. Typeset
owns it in `src/styles/theme.css`, which overrides the shared editor's default
tokens; the shared package and RoleFit are unaffected. Light mode only; every
text step clears WCAG AA (4.5:1) on every chrome surface.

### Brand Mark

The ribbon T: a curved cap ribbon over a separate tapered stem, built like
RoleFit's ribbon R (separate filled ribbons, diagonal gradients, an open tuck
seam) so the two read as one product line. Cap `#FFB45B → #FF7658 → #E64259`,
stem `#FF795B → #D84462`. `public/favicon.svg` sets it on a 64px white →
`#FFF0EC` tile (rx 14); `src/styles/typeset-mark.svg` is the bare mark that
precedes the toolbar wordmark at 22px, as RoleFit's rail shows its R.
`public/apple-touch-icon.png` is the favicon's geometry on a full-bleed square
tile (iOS rounds it itself) rasterized at 180px; re-render it whenever the mark
changes. The mark carries the only gradients in the interface.

### Primary

- **Coral Rose** (`#b73847`): The filled Save action, selected controls, focus
  emphasis, and active document state.
- **Deep Coral Rose** (`#982a38`): Hover, pressed, and open-menu treatment for
  the primary accent.
- **Washed Rose** (`#fdecef`): Selected backgrounds.

### Neutral

- **Desk Canvas** (`#f0f2f5`): Workspace around the document.
- **Toolbar Paper** (`#fbfbfd`): Toolbar and control surfaces; popovers sit on
  white.
- **Quiet Surface** (`#f0f2f6`): Hover, inset, and grouped-control background.
- **Slate** (`#3a4250`): Default application text and icons.
- **Deep Slate** (`#1d2430`): Titles and strongest emphasis.
- **Muted Slate** (`#525d6d`): Status, metadata, and secondary labels.
- **Hairline** (`#e0e4eb`): Default dividers and control borders.
- **Strong Hairline** (`#bbc4d0`): Hovered controls and structural boundaries.

### Status

- **Saved Green** (`#1e7a4c`): Only the check beside "Saved locally". The
  status text stays neutral, because a rose "saved" would read as an error.
- **Unsaved Amber** (`#8a6224`, the shared default `--warm`): "Unsaved
  changes" status text and icon.
- **Proofing Red** (`#b3261e`): Destructive actions and file errors only, always
  paired with an icon and literal text.

**The One-Ink Rule.** Coral Rose occupies less than ten percent of the
interface. Its rarity identifies action and state rather than decoration.

## 3. Typography

**Display Font:** System UI sans, with platform-native fallbacks
**Body Font:** System UI sans, with platform-native fallbacks
**Document Fonts:** 30 bundled families inside the resume only; the catalog is
owned by `packages/engine/src/lib/fontFamilies.ts`.

**Character:** Application chrome is compact, native, and immediately legible.
The resume uses a selected bundled typesetting family, creating
a clear boundary between the tool and the document. Every family has committed
metrics and faces for body, emphasis, display, and caps so editor and print line
breaking remain deterministic.

### Hierarchy

- **Title** (650, 15px, 1.2): Product name and document title. Style popovers
  are headerless; their sections carry compact titles instead.
- **Body** (400, 14px, 1.45): Control text, helper copy, and status messages.
- **Label** (600, 12px, 1.2): Field labels, compact toolbar groups, and menus.
- **Micro** (500, 11px, 1.2): Keyboard shortcuts and secondary file metadata.

**The Tool-and-Document Rule.** System UI belongs to the application. The
selected bundled family belongs to the resume. Never use a document family as
product branding or allow an unmeasured local system font into the page.

### Document Type Controls

- **Selected family:** the metric-compatible trio Tinos, Carlito, and Arimo
  first, then Source Serif 4, Source Sans 3, and Latin Modern. Recognition leads:
  the families a posting or a style guide names are at the top. Each menu row
  previews in its own face, and the three compatible fonts show the proprietary
  family whose metrics they match beside the name. The 24 additional families
  follow alphabetically in the same scrollable, viewport-bounded menu. Opening
  the list reveals the current choice; keyboard navigation scrolls it into view.
- **Selected size:** A compact Docs-style minus / centered editable value / plus
  control without a separate disclosure icon. Clicking the value opens a narrow,
  centered common-preset menu; custom 6–48 pt values are stored to 0.1 pt, and
  minus/plus step by exactly 1 pt.
- **Tracking:** Physical pt, including restrained negative and positive values.
- **Line height:** Unitless and resume-wide, located with the structural gap
  controls in Spacing. Presets and custom values affect the editable page,
  print layer, and PDF together.

### Document Measurement Policy

Saved page spacing uses physical points. Do not use `em` for these controls:
an `em` gap changes when font size changes, while a page-spacing value should
retain a stable physical meaning for editing and print. Unitless line height is
the deliberate exception because leading should scale with the text. Screen-only
application chrome continues to use px/rem and the spacing tokens above.

Left, center, right, and justified alignment in the toolbar apply to the selected
field/paragraph. The Paragraph menu retains independent document defaults for body,
header, and section-heading alignment. Two-sided title/date and
subtitle/location rows retain their pinned anchors until a local override
intentionally aligns that row as a group.

Wrapped paired fields keep those anchors on each continuation. A short side
retains its natural width; two long sides share the available row width with
one role-size point gap. The header gives an oversized name or contact value
the full text width. Wrapping never introduces a font-size reduction.

## 4. Elevation

The interface is flat by default. Toolbar structure uses tonal layering and
one-pixel dividers. Shadows are reserved for the physical paper and for open
popovers that genuinely float above the canvas.

### Shadow Vocabulary

- **Paper** (`--shadow-rest`: `0 2px 10px rgb(29 36 48 / 12%)`, plus a 1px
  `rgb(29 36 48 / 8%)` border): The resume page only, matching RoleFit's soft
  page shadow. The page's wrapper clips everything outside the page except its
  16px bottom margin, so the edge is a border (an outer ring would be clipped)
  and the blur must fade within 16px; a longer blur is cut into a hard band.
- **Popover** (`--shadow-lift`: `0 2px 6px rgb(29 36 48 / 8%), 0 12px 32px rgb(29 36 48 / 14%)`):
  Anchored menus and format panels. A few package-owned popover and tooltip
  shadows keep their own faint hard-coded tint.

**The Flat-Until-Floating Rule.** Resting application surfaces do not cast
shadows. Elevation appears only when an object is physically above the canvas.

## 5. Components

Components feel refined and restrained. Standard affordances are used without
ornamental reinterpretation.

### Shared Surface Boundary

The document page, direct-editing behavior, toolbar controls, popovers, and
their base styles are owned by `@typeset/editor`; the document rendering and
measurement contract is owned by `@typeset/engine`. Typeset composes those
surfaces with its own file/status row and product identity.

- Put reusable editor behavior and base styles in the owning package, then
  verify both Typeset and RoleFit.
- Keep autosave copy, filename lifecycle, file actions, and Typeset-only
  responsive composition in this app.
- Prefer narrow values, callbacks, and deliberate slots over app-mode flags.
- Never fork shared page geometry or toolbar behavior to make a host-specific
  visual adjustment.

### Buttons

- **Shape:** Compact rounded rectangle (6px), never a decorative pill.
- **Primary:** Coral Rose background, white text. The toolbar Save menu
  trigger is the one filled control; it stays Deep Coral Rose while its menu is
  open.
- **Hover / Focus:** Deep Coral Rose on hover; keyboard focus adds a 2px Coral
  Rose outline offset by 2px.
- **Secondary:** Toolbar Paper surface, Hairline border, Slate content.
- **Ghost:** Transparent at rest with Quiet Surface on hover.

### Chips

- **Style:** Used only for mutually exclusive presets or pressed formatting
  state. Default state is neutral with a one-pixel boundary.
- **State:** Selected state uses Washed Rose plus Coral Rose text and icon.

### Cards / Containers

- **Corner Style:** 8px for floating popovers only.
- **Background:** Toolbar Paper over the Desk Canvas.
- **Shadow Strategy:** Follow the Flat-Until-Floating Rule.
- **Border:** Hairline, with Strong Hairline for active boundaries.
- **Internal Padding:** 12px to 16px, varied by hierarchy.

### Inputs / Fields

- **Style:** 32px minimum height, Toolbar Paper background, Hairline border,
  6px corners.
- **Focus:** Coral Rose border and a visible offset focus ring.
- **Sliders:** Muted Slate at rest; Coral Rose only while hovered,
  keyboard-focused, or dragged, so a dense Spacing or Paragraph panel keeps the
  One-Ink Rule.

### Menus and Secondary States

- **List menus** (font, size, zoom, alignment, line spacing): a hovered or
  focused row takes the neutral `--card-hover` wash (`#ebeef2`), and keyboard
  focus adds a 2px inset Coral Rose ring; the selected row is Coral Rose text
  with a check (bold weight instead in the compact size and zoom lists, which
  have no check column). Focus and selection never look the same.
- **Panels** opened from the keyboard take a 2px Muted Slate outline, not an
  accent frame.
- **Neutral secondary states:** Open/Save menu row icons are Muted Slate; the
  Header visibility toggle and pressed marks in the Styles grid use Deep Slate
  on `--paper-deep` (`#e8ebf0`). Pressed marks add a Muted Slate border, since
  they have no icon change, and keep the shared accent border while
  keyboard-focused; a mixed mark is Muted Slate with a dashed border. Coral Rose
  stays for Save, live toolbar marks, and interaction.
- **Toolbar surface:** both toolbar rows share Toolbar Paper.
- **Footer:** one 12px storage line, "Saved only in this browser · Download a
  .resume file to keep a copy", readable by assistive technology. At 520px and
  below it stacks into two lines instead of truncating.
- **Short windows:** the app has no minimum height, so the workspace is the only
  scroller.
- **Error / Disabled:** Proofing Red is paired with literal error text; disabled
  controls retain readable contrast and remove pointer affordance.

### Navigation

The two-row top toolbar is the application shell. The first row owns file
lifecycle and status, with autosave state grouped directly beside the expanding
filename field. The field reserves only its content width, so short filenames do
not leave an invisible gap before status. Responsive disclosure may remove
adjacent labels, but it does not impose a narrower filename cap; the field
shrinks only when the remaining row width truly requires it. A blank filename resolves to
`Untitled resume` on blur. New and Open share one visible Open menu, while Save
and Export PDF share one visible Save menu; the menu rows carry the detailed
file actions. The second row owns document commands, formatting, and zoom.
Typeset does not hard-gate compact viewports. At 900px and below the Open/Save
triggers and the Header/Section menus drop to icons together, so the filename
keeps its room (a full "Untitled resume" at 390px); below 720px the mark and
wordmark go. Open and Save stay visible at every width. The document remains
editable, and the initial view auto-fits the page within the scrollable
workspace.
Zoom is a conventional editable percent combobox before the selected font,
accepting custom values from 30–200% as well as Fit page and common presets.
Fit measures the real workspace and editor gutters (narrowed to 4px and 20px at
480px and below), so on a 390px phone it shows the whole page width (about 41%)
with no sideways scroll. Zooming out from a Fit below 50% stays put rather than
jumping up to the 50% preset.
The Open menu's "Choose a file" and the Save menu's "Save .resume" rows show
their Ctrl/⌘O and Ctrl/⌘S shortcuts. Export PDF has none: every free-looking
combination collides with a browser shortcut (Firefox's Ctrl+Shift+E and
Ctrl+Shift+S, and print's Ctrl+P).
The formatting row never scrolls and is never cropped. Disclosure is a measured
ladder: formatting-menu labels compact first, then those menu icons move into an
anchored More overlay, then selected-text typography, then paragraph alignment,
and finally clear-formatting and spell check — leaving history, zoom, and the
four emphasis commands. Every stage's threshold is the measured intrinsic width
of the set still inline above it, so no width leaves a control half-visible. The
overlay floats above the page without changing toolbar or canvas geometry. Open
and Save labels remain visible until the middle of that ladder.
Selected-text family and a minus / editable preset-custom size / plus control
stay directly available at wider widths. With a caret, these controls report and
change the next-typing style.
Selected-paragraph alignment is one trigger with a labelled menu rather than four
buttons: it shows the active alignment, costs a quarter of the width, and so
survives much further down the ladder. There is no global
font-default menu; selecting all text is the explicit document-wide font
operation. A standard link control beside inline emphasis edits selected text;
email and web destinations are detected automatically, while explicit edit and
remove actions remain available. A spell-check toggle sits with the inline
formatting group; its underlines are editor-only view state and never reach
print or PDF output. Resume-wide line height and physical document gaps live
together in Spacing. Its preset section shows the fixed Compact, Balanced, and
Spacious presets as one segmented row, then up to eight saved preset rows. Any
preset applies on click; saved rows add icon actions to update, rename inline,
or delete after an inline confirmation.
Global alignment reflects the effective fields in its scope and clears
conflicting local overrides when applied; any later local divergence clears
that global active state. Entry start and end indents and the bullet indent
live independently in Paragraph, while structural formatting values live in Styles.

The Page popover stays compact at 288px on desktop (Paragraph and Spacing are
304px). Every Spacing and Paragraph value is one line: label, slider, and a
typeable value box. Styles is a 452px table, one row per text role under Font,
Size, and Emphasis columns; below 500px each role's name returns above its
controls. Page margins offer Narrow and Normal shortcuts plus
independent Custom top, right, bottom, and left values from 0.25–3 inches.
All four values remain visible for every preset; editing one changes the UI
state to Custom. Only physical point values persist, so screen layout and PDF
output agree without storing presentation-only preset names.

Print-affecting document-style changes share chronological Undo/Redo with
content edits. Zoom, spell-check, and preset labels remain view/UI preferences
and do not enter document history.

### Resume Canvas

The centered engine-rendered page is the signature component. It remains white,
selectable, directly editable, and surrounded by enough neutral space to reveal
page boundaries. Reorder grips appear only for the active or hovered
reorderable block. Header structure stays in toolbar, keyboard, and right-click
commands and never floats over the document. The Header menu keeps the name
field required and uses visibility as the only header-level toggle; contact
items remain optional and individually removable.

## 6. Do's and Don'ts

### Do:

- **Do** keep the resume visually dominant and centered in the available width.
- **Do** use a familiar top toolbar for file, history, formatting, and zoom.
- **Do** reveal detailed spacing controls in an anchored, non-modal popover.
- **Do** provide literal autosave and file-error status with text.
- **Do** maintain visible keyboard focus and reduced-motion behavior.
- **Do** keep the visible Open and Save menus available on supported tablet widths;
  their rows expose New, Open `.resume`, Save `.resume`, and Export PDF.

### Don't:

- **Don't** recreate the previous sidebar-heavy control panel.
- **Don't** resemble a generic SaaS dashboard or AI writing assistant.
- **Don't** use oversized import surfaces, nested cards, or ornamental branding.
- **Don't** expose implementation, server, or conversion terminology.
- **Don't** use glassmorphism, gradient text, decorative motion, or colored side stripes.
- **Don't** hide the primary Open and Save menu triggers inside an overflow menu.
