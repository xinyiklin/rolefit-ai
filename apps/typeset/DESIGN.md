---
name: Typeset
description: A calm, local-first document editor for precise resume typesetting.
colors:
  canvas: "#eef1ef"
  surface: "#fbfcfb"
  surface-subtle: "#f4f6f4"
  ink: "#242826"
  ink-strong: "#171a19"
  ink-muted: "#626965"
  line: "#d9dedb"
  line-strong: "#bec6c1"
  accent: "#176b5c"
  accent-hover: "#12594d"
  accent-soft: "#e4f1ed"
  danger: "#a5413d"
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
    textColor: "{colors.surface}"
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
    backgroundColor: "{colors.surface}"
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
- One low-chroma teal accent reserved for primary actions and active state.
- Anchored formatting popovers that keep the changing page visible.
- Dense enough for expert control, calm enough for long editing sessions.

## 2. Colors

The palette is tinted graphite and paper with a single drafting-teal accent.

### Primary

- **Drafting Teal** (`#176b5c`): Primary export actions, selected controls,
  focus emphasis, and active document state.
- **Deep Drafting Teal** (`#12594d`): Hover and pressed treatment for the
  primary accent.
- **Washed Teal** (`#e4f1ed`): Selected backgrounds and quiet success state.

### Neutral

- **Desk Canvas** (`#eef1ef`): Workspace around the document.
- **Toolbar Paper** (`#fbfcfb`): Toolbar, popover, and control surfaces.
- **Quiet Surface** (`#f4f6f4`): Hover, inset, and grouped-control background.
- **Graphite** (`#242826`): Default application text and icons.
- **Deep Graphite** (`#171a19`): Titles and strongest emphasis.
- **Muted Graphite** (`#626965`): Status, metadata, and secondary labels.
- **Hairline** (`#d9dedb`): Default dividers and control borders.
- **Strong Hairline** (`#bec6c1`): Hovered controls and structural boundaries.
- **Proofing Red** (`#a5413d`): Destructive actions and file errors only.

**The One-Ink Rule.** Drafting Teal occupies less than ten percent of the
interface. Its rarity identifies action and state rather than decoration.

## 3. Typography

**Display Font:** System UI sans, with platform-native fallbacks
**Body Font:** System UI sans, with platform-native fallbacks
**Document Fonts:** Latin Modern, Source Serif 4, or Source Sans 3 inside the
resume only

**Character:** Application chrome is compact, native, and immediately legible.
The resume uses one of three restrained, bundled typesetting families, creating
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

- **Selected family:** Latin Modern, Source Serif 4, or Source Sans 3.
- **Selected size:** A compact Docs-style minus / centered editable value / plus
  control without a separate disclosure icon. Clicking the value opens a narrow,
  centered common-preset menu; custom 6–48 pt values are stored to 0.1 pt, and
  minus/plus step by exactly 1 pt.
- **Tracking:** Physical pt, including restrained negative and positive values.
- **Line height:** Unitless, so leading scales predictably with the text.

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

## 4. Elevation

The interface is flat by default. Toolbar structure uses tonal layering and
one-pixel dividers. Shadows are reserved for the physical paper and for open
popovers that genuinely float above the canvas.

### Shadow Vocabulary

- **Paper** (`0 1px 2px rgba(21, 29, 25, 0.08), 0 18px 48px rgba(21, 29, 25, 0.10)`): The resume page only.
- **Popover** (`0 12px 32px rgba(21, 29, 25, 0.14), 0 2px 6px rgba(21, 29, 25, 0.08)`): Anchored menus and format panels.

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
  verify both Typeset and RoleFit AI.
- Keep autosave copy, filename lifecycle, file actions, and Typeset-only
  responsive composition in this app.
- Prefer narrow values, callbacks, and deliberate slots over app-mode flags.
- Never fork shared page geometry or toolbar behavior to make a host-specific
  visual adjustment.

### Buttons

- **Shape:** Compact rounded rectangle (6px), never a decorative pill.
- **Primary:** Drafting Teal background, Toolbar Paper text, 34px height.
- **Hover / Focus:** Darker teal on hover; a visible two-pixel offset focus ring.
- **Secondary:** Toolbar Paper surface, Hairline border, Graphite content.
- **Ghost:** Transparent at rest with Quiet Surface on hover.

### Chips

- **Style:** Used only for mutually exclusive presets or pressed formatting
  state. Default state is neutral with a one-pixel boundary.
- **State:** Selected state uses Washed Teal plus Drafting Teal text and icon.

### Cards / Containers

- **Corner Style:** 8px for floating popovers only.
- **Background:** Toolbar Paper over the Desk Canvas.
- **Shadow Strategy:** Follow the Flat-Until-Floating Rule.
- **Border:** Hairline, with Strong Hairline for active boundaries.
- **Internal Padding:** 12px to 16px, varied by hierarchy.

### Inputs / Fields

- **Style:** 32px minimum height, Toolbar Paper background, Hairline border,
  6px corners.
- **Focus:** Drafting Teal border and a visible offset focus ring.
- **Error / Disabled:** Proofing Red is paired with literal error text; disabled
  controls retain readable contrast and remove pointer affordance.

### Navigation

The two-row top toolbar is the application shell. The first row owns file
lifecycle and status, with autosave state grouped directly beside the expanding
filename field. The field reserves only its content width, so short filenames do
not leave an invisible gap before status. Responsive disclosure may remove
adjacent labels, but it does not impose a narrower filename cap; the field
shrinks only when the remaining row width truly requires it. A blank filename resolves to
`Untitled resume` on blur. The
second row owns document commands, formatting, and zoom.
Typeset does not hard-gate compact viewports. At 400px and below the file-action
cluster is hidden, the document remains editable, and the initial view auto-fits
the page within the scrollable workspace.
Zoom is a conventional editable percent combobox before the selected font,
accepting custom values from 50–200% as well as Fit page and common presets.
At tablet widths formatting-menu labels compact first; menu icons then move
into an anchored More overlay, followed by alignment at the next narrower
threshold. The overlay floats above the page without changing toolbar or canvas
geometry. Open, Save, and Export labels remain visible until that later stage.
Selected-text family, a minus / editable preset-custom size / plus control, and
selected-paragraph alignment stay directly available at wider widths. With a
caret, these controls report and change the next-typing style. There is no global
font-default menu; selecting all text is the explicit document-wide font
operation. A standard link control beside inline emphasis edits selected text;
email and web destinations are detected automatically, while explicit edit and
remove actions remain available. A spell-check toggle sits with the inline
formatting group; its underlines are editor-only view state and never reach
print or PDF output. Line height and physical page gaps live in Spacing.
Global alignment reflects the effective fields in its scope and clears
conflicting local overrides when applied; any later local divergence clears
that global active state. Entry start and end indents live independently in
Paragraph, while structural formatting values live in Styles.

The Page popover stays compact at 288px on desktop (Paragraph/Styles are
324px and Spacing 316px). Page margins offer Narrow, Normal, and Wide presets
plus independent custom top, right, bottom, and left values from 0.25–1.5
inches. Custom values persist in physical points so screen layout and PDF
output agree.

### Resume Canvas

The centered engine-rendered page is the signature component. It remains white,
selectable, directly editable, and surrounded by enough neutral space to reveal
page boundaries. Structure controls appear only on focus or hover.

## 6. Do's and Don'ts

### Do:

- **Do** keep the resume visually dominant and centered in the available width.
- **Do** use a familiar top toolbar for file, history, formatting, and zoom.
- **Do** reveal detailed spacing controls in an anchored, non-modal popover.
- **Do** provide literal autosave and file-error status with text.
- **Do** maintain visible keyboard focus and reduced-motion behavior.
- **Do** keep Open, Save `.resume`, and Export PDF available on supported tablet widths.

### Don't:

- **Don't** recreate the previous sidebar-heavy control panel.
- **Don't** resemble a generic SaaS dashboard or AI writing assistant.
- **Don't** use oversized import surfaces, nested cards, or ornamental branding.
- **Don't** expose implementation, server, or conversion terminology.
- **Don't** use glassmorphism, gradient text, decorative motion, or colored side stripes.
- **Don't** hide primary file actions inside an overflow menu.
