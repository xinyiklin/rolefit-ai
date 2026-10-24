---
name: RoleFit
description: Calm native workspace design system for a local-first resume-tailoring studio
colors:
  # Every value is a light-dark() pair in src/styles/tokens.css; light shown first.
  chrome: "oklch(0.962 0.004 265) / oklch(0.215 0.005 265)"
  paper: "oklch(0.978 0.003 265) / oklch(0.185 0.004 265)"
  card: "oklch(1 0 0) / oklch(0.235 0.005 265)"
  card-soft: "oklch(0.962 0.004 265) / oklch(0.27 0.006 265)"
  card-elev: "oklch(1 0 0) / oklch(0.26 0.006 265)"
  card-hover: "oklch(0.952 0.005 265) / oklch(0.29 0.007 265)"
  control: "oklch(0.935 0.005 265) / oklch(0.31 0.007 265)"
  control-hover: "oklch(0.905 0.006 265) / oklch(0.35 0.008 265)"
  thumb: "oklch(1 0 0) / oklch(0.43 0.008 265)"
  ink: "oklch(0.25 0.01 265) / oklch(0.92 0.004 265)"
  ink-strong: "oklch(0.18 0.01 265) / oklch(0.97 0.003 265)"
  ink-muted: "oklch(0.42 0.01 265) / oklch(0.8 0.006 265)"
  ink-soft: "oklch(0.5 0.01 265) / oklch(0.72 0.008 265)"
  ink-faint: "oklch(0.53 0.01 265) / oklch(0.68 0.008 265)"
  hairline: "oklch(0.905 0.005 265) / oklch(0.32 0.006 265)"
  hairline-soft: "oklch(0.94 0.004 265) / oklch(0.28 0.006 265)"
  hairline-strong: "oklch(0.86 0.006 265) / oklch(0.4 0.008 265)"
  accent: "oklch(0.53 0.2 258) / oklch(0.72 0.14 253)"
  accent-deep: "oklch(0.47 0.19 260) / oklch(0.8 0.11 252)"
  accent-hover: "oklch(0.48 0.2 259) / oklch(0.77 0.12 253)"
  accent-soft: "oklch(0.95 0.03 255) / oklch(0.31 0.07 258)"
  on-accent: "oklch(0.995 0.002 260) / oklch(0.17 0.02 260)"
  warm: "oklch(0.55 0.13 62) / oklch(0.8 0.13 75)"
  cool: "oklch(0.52 0.09 235) / oklch(0.76 0.09 235)"
  positive: "oklch(0.49 0.11 160) / oklch(0.76 0.12 160)"
  gold: "oklch(0.51 0.11 75) / oklch(0.82 0.11 85)"
  danger: "oklch(0.54 0.2 27) / oklch(0.72 0.16 25)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Display, Segoe UI, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 570
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 650
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0"
  data:
    fontFamily: "the UI stack (--font-mono aliases --font-ui)"
    fontSize: "0.78rem"
    fontWeight: 550
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink-faint}"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  input:
    backgroundColor: "{colors.card-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  segmented:
    backgroundColor: "{colors.control}"
    selectedBackground: "{colors.thumb}"
    rounded: "{rounded.md}"
    padding: "2px"
  studio-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "16px 24px"
  nav-row:
    textColor: "{colors.ink-muted}"
    selectedBackground: "{colors.control}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
---

# Design System: RoleFit

## 1. Overview

**Creative North Star: "A calm native workspace"**

RoleFit should feel like a well-made desktop app, in the lineage of Apple's
own apps and Things 3: hierarchy comes from type, space, and alignment, not
from containers. A full-height, collapsible soft gray sidebar headed by the
brand sits beside a slightly lighter workspace plane that runs to the top of
the window; there is no top bar. The global Apply action floats as a pill at
the workspace's bottom-right. Content sits in borderless white groups; inputs are quiet
filled fields; buttons are filled shapes without outlines; selection is a
filled row. The tool is calm, dense, and trustworthy; it disappears into the
task of tailoring a resume. (Chosen by the user 2026-10-22 over the earlier
green-paper "Drafting Desk": modern, not AI-feeling, not bulky or boxy; no
liquid glass, because Firefox lacks backdrop refraction.) Product and engineering docs still call the browser app
the Drafting Desk; the name now names the surface, not its look.

Inside the workspace, the system rejects marketing landing-page patterns and
oversized in-app heroes, gradient-heavy surfaces, glass and blur as
decoration, SaaS dashboard clichés (hero metrics, identical card grids),
sales-style copy, fake loading states, shimmer, decorative motion, nested
card-in-card containers, tracked uppercase eyebrows, and serif or monospace
costume. Status is stated quietly (a small dot beside a word), never shouted
(filled pills, banners, badges everywhere).

Applications and Analytics use layout-shaped placeholders during real initial
page-code or saved-data loading. A restrained opacity pulse communicates that
pending state; reduced motion leaves the shapes static. Keep the page title,
loading status, masthead, and navigation available. Resolve immediately to
content, empty guidance, or failure feedback, and keep populated content visible
during refresh. These app-local placeholders do not introduce shimmer or
artificial loading delays.
The Applications placeholder preserves the detached table-header band and uses
the real table's column grid and compact-column rules. Its side rail retains
the full inspector frame, identity block, facts, Fit, documents, and action
regions, including the desktop height and stacked layout.

Layout is structural and predictable: a full-height, resizable and collapsible
studio rail headed by the brand that moves through Prepare, Draft, and Track
beside a full-width workspace, a floating Apply pill, a bottom utility group with read-only Sessions immediately above Settings
outside `OUTPUT_TABS` and the APG tablist, matched
resume and cover-letter document chrome with rail-owned primary actions, and document-specific review
rails. Breakpoints (1280/1180/1080/900/820/760
px) collapse structure; they never fluidly rescale type. Desktop ~1440px is
the primary canvas; content wraps rather than clips below it.

**Key Characteristics:**

- Tone, not lines: chrome, plane, and white groups separate by value; borders
  are reserved for row separators inside a group.
- One type family: the platform UI face for everything, with tabular figures
  for data instead of a monospace face.
- One clear blue accent for action, selection state, and focus.
- Light and dark themes from one token set; the resume page stays paper.
- Dot-plus-word status vocabulary; label/value rows for facts.
- Density with calm: compact spacing, short labels, generous group padding.

### Public product/download page

`landing/` is a separate public composition, not a route or mode of the
Drafting Desk. It follows the user-selected RoleFit brand direction (2026-10-23,
D097): the ribbon-R mark beside a bold "RoleFit" wordmark, a bold display
headline with tight tracking, and blue-to-lavender wave art (the user's
supplied wave images and the kit's SVGs) as section backgrounds that fade at
section edges and drop to a wash behind the hero copy. It still imports `src/styles/tokens.css` (the one
token source), follows the OS light/dark preference with no override control,
sets everything in the system UI face, and keeps blue for action and focus.
Brand-only tints (`--brand-ink`, `--brand-mist`, `--brand-tile`) and the art
opacity live in `landing.css`; the art dims in dark mode. Unlike the Drafting
Desk, which rejects decorative motion, the landing carries the restrained
entrance motion shared across the portfolio: a one-shot hero entrance and a
one-shot fade-and-lift as sections scroll into view (never looping), both a
progressive enhancement that collapses under `prefers-reduced-motion` and never
leaves content hidden when scripting is unavailable. It must not imitate the
working app shell, imply hosted execution, guess the user's architecture, or
attempt native-install detection. Unlike the workspace, the landing's cards and
panels are frosted glass (user direction, 2026-10-24): a translucent tint
(`--glass`, about 58% white in light and 50% deep slate in dark; `--glass-strong`,
80% in both, for the text-dense download card and browser chips, whose fine
print uses `--ink-muted` to hold AA over the ribbon), a 22px backdrop blur with
1.6 saturation, and a light inset top edge, over the page's brand art and a
soft CSS color field behind the extension and privacy sections (`.glow-zone`).
Browsers without `backdrop-filter`, and visitors who ask for reduced
transparency, get the opaque card tone instead. The sticky header is a lighter
frost (86% paper, 16px blur). Gallery screenshots sit inset 8px in their glass
card. A third ribbon from the same family (`ribbon-accent.webp`, generated with
Codex image generation and compared against `ribbon.webp` before use) runs
behind the privacy diagram's lower edge. At a missing or invalid
release, it keeps both platform choices visible and states that no complete
verified installer set is available instead of rendering a broken primary
action.

**Composition.** A header with the mark, section navigation, GitHub, and one
Download action. The hero pairs the headline, lede, and both explicit platform
buttons (macOS Apple silicon, Windows x64) with the real resume-editor capture
inside the reusable laptop frame (`.device-laptop`: the screen is a slot for
any image, the frame image's screen is transparent). A five-step strip
(Prepare, Assess fit, Polish, Export, Track) uses the brand kit's line icons on
a tinted disc. "Everything you need in one focused workspace" is a scroll-snap
gallery of real captures (Prepare, Resume, Cover letter, Applications) with
arrow buttons; each card zooms its capture to the working area. The extension
section shows the real Chrome, Firefox, and Edge logos (Chrome and Firefox
from the installed browsers' app icons, Edge from Microsoft's logo SVG; used
only to name supported browsers and repeated on the privacy diagram) on a quiet
tinted panel, beside a generated import illustration (`extension-import.webp`,
made with Codex image generation) whose only labels are the popup's real
wording: Prepare in RoleFit and Opened in RoleFit from the popup, then Job
brief, Responsibilities, and Required qualifications from Prepare. It is captioned as an illustration, never a screenshot claim;
regenerate it rather than ship invented UI text. Type follows a fixed scale:
a 52px hero heading, 36px section headings, 11px tracked eyebrows, and 16px
card titles, with 40 to 80px between sections and no standalone spacers. The
privacy section shows the runtime as three nodes (extension, desktop companion,
your AI provider) plus two short facts; it must keep the build-checked
disclosures that the workspace stays on this machine and that AI input goes
directly to the chosen provider, and never claim that all data stays local
(the build rejects "your data stays on/local"). The download card is one
compact, centered column: the pitch, both platform buttons, the platform line,
a dot-plus-word release status, and a quiet foot row with the checksum note and
archive links. Ribbons are never cropped and always pass behind content: the
band ribbon (`ribbon.webp`) runs full-width behind the download card, sized
from the section's height so it shows above and below the card; a flattened,
mirrored copy of the same ribbon (`ribbon-low.webp`, ends faded to
transparent, so all ribbon art shares one style) runs
behind the workspace gallery's lower edge so the cards sit on it, a layered
transition rather than a standalone divider. The hero's wave art fades at the
hero's edge (a CSS mask) rather than ending in a line. The footer
carries the mark, section links, the maker, and the sibling projects. Status is
a dot beside a word (green for a signed release, amber for an unsigned
preview). The CSP stays `font-src 'self'`; the page loads no fonts, and the
stylesheet holds no `url()` (decorative art is an `aria-hidden` image layer).

### Shared editor boundary

The resume and cover-letter pages, document/formatting primitives, fonts,
direct-edit behavior, measurement, pagination, and PDF path come from
`@typeset/editor` over `@typeset/engine`. RoleFit frames those surfaces with
its own host chrome. The resume injects its section-scope/review overlay;
the cover letter selects the plain-paragraph layout, keeps header structure
controls, and disables resume section/entry/bullet controls. It uses the same two-row document/formatting toolbar, replacing only
the resume style-menu group with a focused line-height control and the shared
page-margin control. Shared zoom, selection typography, emphasis, alignment,
links, and spell-check remain in place. Its file actions, workflow rail, and
deterministic resume proposal review remain RoleFit-owned. Do not fork shared editing or layout code for
a RoleFit-only tweak; add a narrow host seam and verify affected consumers.

`packages/editor/src/styles/` owns shared editor/tooling behavior. RoleFit's
`src/styles/` owns the masthead, studio, tracker, materials, review, workflow,
and host-specific integration overrides. The cascade between them is a public
integration contract, not permission to duplicate the shared component.

### Desktop companion

The Electron companion (`desktop/companion.{html,css}`) speaks the same calm
native language at its fixed 760×480 size, sized so every section but the
open extension install guide fits without scrolling: one unified shell. There is no
native title strip; the window is `--chrome`, the sidebar runs to the top edge
with the brand once in its head, and the pages sit on a `--paper` sheet whose
left corners round 16px against the chrome while it stays flush with the top,
right, and bottom edges. The brand row sits on the 48px title band (on macOS
just below the traffic lights). Nav rows are icon-led like the browser rail (16px stroke icons in
`--ink-faint`, accent on the selected row) with filled neutral selection, the accent **Open RoleFit**
as its one global action, and an empty sticky 48px band at the top of each
page that is the draggable title bar. Pages show no visible title, since the
selected sidebar row names them; each keeps a visually hidden `h1` (its
sidebar label) for screen readers and `aria-labelledby`. A page's status line
and actions (Providers' counts and Check again, Workspace's transfer state)
sit in one quiet row at the top of the content, never beside the window
controls; pages whose status the content already shows have none. The
extension port is copied from Settings, not repeated on the extension page. Native window
controls overlay the band's trailing edge in theme-matched colors; on macOS
the sidebar drops below the traffic lights, using the window-controls-overlay
`titlebar-area-x`. Borderless `--card` groups on the
`--paper` plane with hairline row separators (Providers is one grouped list),
filled `--control` secondary buttons, `--card-soft` fields with the accent
focus ring, a `--control`/`--thumb` segmented browser switch, and
dot-plus-word statuses in sentence case. Its strict local-file CSP loads no
webfonts, so it uses the system stack only; the one monospace is the system
`ui-monospace` stack for an inline `code` file name in the extension install
guide. `companion.css` mirrors the token values of `src/styles/tokens.css`
and never imports the browser app's CSS; change both together. It follows the OS theme through `color-scheme: light
dark` (it has no Appearance override), and the window's pre-paint background
picks the matching `--chrome` tone from `nativeTheme`.

The brand mark is the ribbon R from the RoleFit brand kit (2026-10-23, D097):
three gradient paths (blue top bowl, blue stem, indigo leg). The desktop
`.ico`/`.icns` put it on a navy tile; the browser app's `public/favicon.svg`,
the landing page's `landing/public/assets/favicon.svg`, the companion's inline
favicon, and the extension's `icons/icon{16,32,48,128}.png` put it on a light
tile (PNG because Chrome and Edge do not render SVG manifest icons), and the
landing's touch icon is the same light tile full-bleed.
`desktop/assets/generate_icons.py` writes all of them from those paths
(Pillow + CairoSVG); rerun it instead of editing an asset by hand. The two SVG
favicons are byte-identical outputs. In page
chrome (the browser masthead, the companion brand row, the landing header)
the mark appears bare, without a tile, beside the "RoleFit" wordmark.

### Extension popup

The browser extension's popup (`extension/popup.{html,css}`) is the same calm
native workspace at 344px: a `--chrome` masthead over a `--card` body,
label/value ledger rows, dot-plus-word statuses whose colors match the
tracker's stage dots for Applied through Withdrawn, and the accent filling
only its one primary action.
`popup.css` mirrors the token values of `src/styles/tokens.css` (it never
imports app CSS), follows the OS theme with no Appearance override, and keeps
its own compact px type scale. Its toolbar badge colors in
`extension/background.js` are the light `--accent` and `--danger` values. Change
these mirrors with `tokens.css`. `extension/AGENTS.md` owns the popup's
detailed visual contract.

## 2. Colors

Near-neutral cool grays (hue 265, chroma ≤ 0.01) around one clear blue
accent, with quiet semantic signals. Every token is a `light-dark()` pair in
`src/styles/tokens.css`; `:root` declares `color-scheme: light dark`, and
Settings › App › Appearance can pin `data-theme="light"` or `"dark"` on the
root (a per-browser view preference, like zoom; it never enters workspace
preferences or document files).

### Primary

- **Blue** (`--accent`): primary actions (Polish, Apply, Open details),
  focus rings, switches that are on, selected rows' tint (`--accent-soft`),
  and accent icons in selected rail rows. Hover uses `--accent-hover`;
  `--accent-deep` is the accent as text on `--accent-soft`. In dark mode the
  accent lifts and `--on-accent` inverts to a near-black label so both the
  fill and accent text clear AA.

### Neutral

- **Chrome** (`--chrome`): the full-height studio rail (masthead included) and
  the body behind it.
- **Plane** (`--paper`, `--paper-deep` aliases it): the workspace behind
  content, from the top of the window to the bottom. The Resume and Cover letter header and formatting rows sit on it
  too (no white band, no rules), so the paper page is the only sheet there.
- **Groups** (`--card` white / raised gray in dark): borderless content groups,
  tables, inspector panels, and dialog cards (on `--card` their filled fields
  keep their step in dark mode). `--card-elev` is the floating layer
  (popovers, menus, toasts, the Apply pill). `--card-soft` is the filled-field and quiet-well tone;
  `--card-hover` is row hover.
- **Control** (`--control`, `--control-hover`): secondary buttons, segmented
  tracks, the selected rail/settings row, neutral avatars and counts.
- **Ink** (`--ink-strong` → `--ink` → `--ink-muted` → `--ink-soft` →
  `--ink-faint`): the only text colors. `--ink-faint` clears AA (≥ 4.5:1) on
  every surface in both themes except the filled `--control` tones, where text
  starts at `--ink-soft`; it must not be lightened.
- **Hairlines** (`--hairline-soft`, `--hairline`, `--hairline-strong`): row
  separators inside a group, scrollbars, and unchecked rings. Never a frame
  around a group.

### Signal

- **Steel blue** (`--cool`): the Applied stage — filed, not active.
- **Green** (`--positive`): the Interviewing stage.
- **Gold** (`--gold`): the Offer stage.
- **Amber** (`--warm`, `--warm-soft`, `--warm-veil`, `--warm-line`): attention
  without alarm — blocked rows, warnings, the No response callout.
- **Red** (`--danger`, `--danger-soft`, `--danger-hover`): errors, Rejected,
  destructive actions.
- `--scrim` dims the app behind modal dialogs.

Analytics keeps its own validated categorical stage fills (`--an-*` in
`analytics.css`), also as light/dark pairs; their hues match the tracker's
stage dots.

### Named Rules

**The Tone-Not-Lines Rule.** Regions separate by surface value (chrome → plane
→ group → floating layer). A 1px border never frames a group, card, input,
button, or menu; borders survive only as separators between rows inside a
group, the ring of an unchecked radio/check marker, the warm edge of a
warning note, the hairline a text field shows on hover, and the outlines restored under `prefers-contrast: more`.

**The One Accent Rule.** The blue touches at most ~10% of a screen: primary
actions, focus, on-states, and selection tint. Never decoration, a section
background, or a heading color. A selected navigation row is a neutral filled
row with an accent icon, not a blue wash.

**The Paper Rule.** The resume and cover-letter pages are paper in both themes:
`.tsd-page`, the editor marks drawn on it (`.ts-grip`, `.ts-drag-source`,
`.ts-drop-indicator`, RoleFit's `.ts-chrome` chips), and `.resume-print-layer`
pin `color-scheme: light` and re-declare the tokens, because the build lowers
`light-dark()` into variables that resolve where a token is declared. The
editor's context menu, link card, and paste dialogs keep the app theme.

**The Dot-Plus-Word Rule.** Stage and readiness are a 5–7px dot beside plain
text. Color never carries meaning alone, and filled pill badges are not the
default status vocabulary.

## 3. Typography

**One family:** the platform UI face — SF on macOS, Segoe UI Variable on
Windows (`--font-ui`, with `--font-display` selecting the Display optical
size where the platform has one). No webfonts, no serif, no monospace in
chrome (the companion's one inline file name is the exception).
`--font-mono` remains as a name for data styling but aliases the UI face;
numbers get `font-variant-numeric: tabular-nums`.

### Hierarchy

- **Page title** (`.page-serif`, a historical class name; in a page head it is
  the UI face at 570, 0.86rem, lh 1.3, the shared document name's style; the class alone, used by a few dialogs, stays
  700, 1.75rem). Every page head is one 48px row, like the document editors'
  name row: the title at the 32px inset with its details (path, lede, job
  target) inline after it, actions on the trailing edge. The document name
  starts on the same inset. The wordmark is 650 at 0.98rem.
- **Group title** (650, 0.92rem): panel and section heads.
- **Body** (400–500, 0.8–0.86rem, lh 1.45–1.5): controls, prose, table text.
  Prose stays under 75ch.
- **Label** (550–650, 0.72–0.75rem, sentence case, no tracking): field labels,
  rail group labels (Draft / Track), table column heads, section
  labels. Uppercase tracked eyebrows are retired; the one exception is the
  three-letter month above a date in Analytics' Coming up list.
- **Data** (500–600, tabular figures, same family): dates, counts, scores,
  ledger values.

### Named Rules

**The One Family Rule.** Hierarchy comes from size and weight steps within the
UI face. No serif, no separate display family, no monospace costume.

**The Sentence Case Rule.** Labels, headings, and table heads are sentence
case; letter-spacing stays at 0 except negative tracking on large titles.

## 4. Elevation

Groups sit flat on the plane (`--shadow-rest` is `none`). Only floating layers
cast a shadow: `--shadow-lift` combines a 1px ring with two soft drops, tuned
separately for light and dark, so popovers, menus, dialogs, and the progress
dock need no border. Raised segment thumbs use `--shadow-thumb`, a 1px 2px drop. The paper page
in the document editor floats on its own soft shadow and ring.

### Named Rules

**The Floating-Only Shadow Rule.** If it does not float above other content,
it has no shadow. Declare elevation once: a shadow or a tone change, never a
border plus a shadow.

## 5. Components

Component character: calm and native; filled controls without outlines,
borderless groups, and one accent-filled primary action per view. Every
interactive control shares the same focus treatment: 2px accent outline,
2px offset (or a 3px `--accent-veil` ring plus accent border on text fields).

### Buttons

- **Shape:** 8px radius; compact heights (38px primary, 32px secondary, 28px
  ghost), 120–160ms transitions, 1px translateY on press. The floating Apply
  button is a pill and is accent-filled only when ready.
- **Primary:** accent fill, `--on-accent` label, no border or glow; hover
  `--accent-hover`. One per document view (Polish beside the workflow rail's
  disclosure control, in the header while open and on the document's edge
  while collapsed; compact `.is-compact` variant in rail actions). While a run
  is in flight that same button is its Stop: a quiet raised "Polishing…" that
  turns warm "Stop" on hover or keyboard focus (always Stop without hover),
  armed after 600ms so a double-click never stops the run it started. The rail
  then shows no footer Stop and no earlier status line, only a run ledger
  (resume: sections; both: elapsed time).
- **Secondary:** `--control` fill, no border; hover `--control-hover`.
- **Ghost:** transparent; hover fills with `--card-hover`. Tertiary row
  actions.
- **Danger:** `.primary-button--danger` fills `--danger`; `.danger-button`
  is red text that gains `--danger-soft` on hover.
- **Disabled:** flat neutral (`--control` fill, `--ink-faint` text), never a
  washed-out tint of the enabled state, so "inert" and "ready" cannot be
  confused.

### Segmented controls and switches

- **Segmented** (`.settings-segment`, the tracker's view switch and lifecycle
  filter, Answers' mode): a `--control` track with 2px padding; the chosen
  option is a raised `--thumb` (lighter than the track in both themes) with
  ink-strong text. No dividers.
- **Switch** (Prepare's Include): 34×20 track, white 16px knob with a soft
  drop; on is the accent fill.

### Chips

- **Style:** pill (999px), `--control` fill, no border, sans 0.72–0.74rem in
  `--ink-muted`; used for keyword lists, refinement chips, and starter
  questions.
- **Counts in the tab rail:** 16px tabular-figure pills on `--control`.

### Cards / Containers

- **Corner Style:** 12px (`--r-lg`) for groups; 16px (`--r-xl`) for popovers,
  dialogs, and the workspace corner.
- **Background:** `--card` groups on the plane; `--card-soft` for quiet wells;
  `--card-elev` for floating layers.
- **Border:** none. Separation is tone (see The Tone-Not-Lines Rule).
- **Internal Padding:** `--s4`/`--s5` (16/24px); heads carry a group title
  plus, when needed, a quiet meta note, not badges.
- **Flush variant** (`.studio-card--flush`): when the content is already a
  framed surface (editor, cover-letter sheet), the wrapper drops its box
  entirely; box-in-a-box is forbidden.

### Inputs / Fields

- **Style:** filled `--card-soft`, transparent 1px border (a hairline appears
  on hover), 8px radius, 32px min height, 0.82rem; labels are 0.75rem
  sentence-case medium weight.
- **Focus:** the field turns `--card`, its border the accent, plus a 3px
  `--accent-veil` ring.
- **Inline list fields** (Prepare's brief rows): transparent at rest so the
  list reads as text, filled on hover, a field on focus.
- **Native appearance** is stripped from text fields only; checkboxes and
  radios keep native controls. Editor font-family choices use the shared custom
  dropdown so the toolbar and Styles matrix have the same visual and keyboard
  behavior in every browser.
- **AI setup** keeps every configured stage expanded together with no
  per-section collapse affordance. Each stage retains its own concrete
  provider/model/effort controls and **Copy from** action. Provider rows come
  from the local companion's explicitly added registry; added-but-unready rows
  show reconnect guidance. Only Resume Polish, Cover letter, and Application
  questions expose a custom-instruction disclosure. Job analysis keeps its fixed,
  complete extraction contract and Fit Assessment keeps its fixed rubric. API
  credentials are never rendered or entered in the browser.

### Prepare

- **Role:** the first/default studio page and the sole job-intake surface.
  Extension receipt is primary; URL fetch and pasted text are compact fallback
  controls on the same page, never masthead inputs or a second intake menu.
- **Composition:** before a posting is prepared, one centered Source panel is
  the whole task: a job link field over a posting box, with one Prepare button
  that prepares typed text, else fetches the link, else re-prepares the
  captured posting; empty Job brief, Materials, and readiness scaffolds do not
  render. After preparation, Source
  collapses into its head (captured size and origin), the editable Job brief
  leads the main column, and one Application rail combines Resume and Cover
  Letter choices, readiness, the saved-application summary, and Apply. Panels
  keep a head — title, quiet meta, trailing actions — over
  plain content; nothing on the page is a card inside a card, and no status
  earns a tinted box or icon tile of its own. Keep explicit View, Replace, and
  Prepare again paths. Keep View and Prepare again bound to the immutable
  captured posting, not the compact brief as the user edits it. Keep role,
  company, location, type,
  source, work authorization, compensation, and
  role context in one aligned form grid rather than a card per field. Continue
  the brief with responsibilities, required and preferred
  qualifications, technical keywords, seniority and domain signals, and
  benefits. Show extraction gaps beside the fields they qualify, as flat
  columns; missing extraction is an edit invitation, not hidden uncertainty.
  In the Application rail, Resume and Cover Letter are two divided groups
  sharing the same anatomy: title and state beside Include, followed by the
  named-variant selector and document-specific actions. The DOM and visual order
  agree. The state line reports state only; the selector already names the
  variant. Disclose at most one note under a group — the blocker while its
  action is unavailable, its live status otherwise. Neither is labeled
  “optional.” Resume starts included and Cover Letter starts excluded. A flat
  Fit Assessment row follows the materials: show its verdict as a dot plus
  word (never a filled pill), short summary, compact run attribution, at most
  three matches and gaps, and an eligibility warning only when relevant. A completed result offers **Reassess fit**; running, not-yet-assessed
  (**Assess fit**), unavailable/retry, and out-of-date/reassess states use the
  same flat hierarchy.
  Starting or failing a new assessment keeps the latest completion visible, and
  an out-of-date result stays visible only as a **Previous preparation** with
  its timestamp plus one compact, hairline-separated **Changed since assessment**
  list. That list names only the changed input groups — job posting, resume
  content, Profile, or assessment setup — before **Reassess fit**. Never add
  scores, confidence, evidence ledgers, quotes, or a recommendation to this row.
- **Automation and assessment boundaries:** keep Fit Assessment and Proposal
  Validation visibly and architecturally distinct. Fit Assessment is the
  reusable advisory about how the selected resume and candidate context align
  with the prepared role at the time it runs. Proposal Validation checks content
  and safe operations. Evidence concerns are advisory before acceptance; technical
  guards preserve operation safety.
  Polish also instructs the selected model to silently audit its own evidence
  and output before returning; that internal pass is not a third user-facing
  workflow. No layer substitutes for another or turns its result into a numeric
  score. User behavior belongs to the
  [Fit Assessment contract](PRODUCT.md#fit-assessment-user-contract), while provider
  mechanics belong to the
  [technical contract](server/ai/README.md#fit-assessment-technical-contract).
  Resume Polish started from Prepare also completes there. Rank the actual
  contents of the saved resume and cover-letter variants left eligible in
  Settings > Automation against weighted prepared-job sections. Either material
  may auto-select a meaningful unique winner while its editor has no unsaved
  document changes and is not application-owned; a sole eligible variant is
  selected without ranking. The
  cover-letter resolver waits for its workspace snapshot and preserves the
  application-output title that Prepare assigns, so that title-only change does
  not masquerade as an edited letter body. A tie or
  incomplete read keeps the current selection and shows no recommendation.
  The selector is the normal receipt; show one compact recommendation line only
  when unsaved work blocks replacement. Neither comparison persists variant
  metadata beyond that eligibility list. Resume and Cover Letter automatic Polish controls remain
  independent. Only the first Fit Assessment launched by the current Prepare may
  start either automatic action; reassessment, retry, resume-change assessment,
  and restored history stay advisory. Manual Polish remains available in every
  state.
- **Apply:** the page and the floating Apply action invoke the same Apply command and show the
  same readiness blockers. The current job must be prepared; each included
  material must be ready; and preparation for selected work must be idle.
  Either or both materials may be excluded, so a prepared tracker-only
  application is valid. A later update leaves any previously saved artifact intact
  when its card is excluded. Apply persists the latest completed Fit Assessment
  snapshot as historical evidence even when its inputs changed or Resume is
  excluded, and preserves an existing snapshot when no newer run completed.
  Apply also persists the complete corrected brief, including benefits, while
  Resume Polish receives the benefits-excluded projection.

### Navigation

- **Masthead:** the head of the full-height studio rail: the 22px ribbon-R
  mark beside the sans wordmark (the one place brand color is identity, not
  action). The brand is the rail's collapse toggle (a button
  named Collapse/Expand sidebar, `aria-expanded`); on hover or keyboard focus
  the mark gives way to the sidebar icon on a `--control` tile. The `<h1>RoleFit</h1>` is visually
  hidden beside it. No job input or Inputs group lives in the masthead.
- **Floating Apply action** (`ApplyAction`): a `--card-elev` pill with
  `--shadow-lift`, fixed at the workspace's bottom-right on every tab. With a
  prepared job it names the role and company on one line, a dot-plus-word
  status line below (Ready in green, the blocker sentence in amber, the busy
  label in blue), and the Apply pill. The status line is the visible
  readiness reason and Apply's `aria-describedby`; there is no hover hint (only the icon-only
  state below carries a native tooltip).
  With no prepared job it shrinks to a round icon-only Apply, which stays
  mounted as the focus-return target. While work runs (Preparing job…, Polishing
  resume…, Polishing cover letter…, or Apply's own busy label, which wins) the
  pill expands even without a job: the button's icon becomes a spinner and the
  status dot pulses in blue; both stop under reduced motion. Pages keep `--apply-clearance` (72px)
  free beneath it where it would cover controls: the end of a one-column
  Prepare page, Prepare's two pane scrollers, the
  document rail's content (or its sticky footer's own bottom padding), and
  the Applications inspector. Apply carries the shared
  readiness state. Its outcome is not reported here: Apply, Update application, and
  Skip share one receipt that leads the top-center task dock, in the eye's
  return path from the action and initially clear of the right inspector where
  the committed record opens. Outcome-first headline, secondary detail line
  for the record and any recovery step; a success expires after active work
  and direct interaction end, while an error, including any partial save,
  waits to be dismissed.
- **Studio utilities:** at the foot of the vertical rail, a bottom utilities
  group places read-only Sessions immediately above Settings, outside
  `OUTPUT_TABS` and the APG tablist. Expanded Sessions shows its label and
  count; the collapsed rail shows an icon plus a compact count/working state.
  Its 14px-radius raised popover opens rightward, clamps to the viewport, and
  enters with a 150ms 6px slide-fade.
- **Applications:** it has no new-work button in its head (Prepare is one
  click away in the rail); only the empty tracker offers a quiet Go to Prepare.
  **Answers** centers its empty intro and composer in the space below the head. The application
  detail modal edits committed tracker records and never becomes a second job
  intake surface. The broad viewport-bounded panel remains the outer working
  sheet, while Overview uses a small
  number of compact groups to make application controls and saved job
  facts scannable without recreating an intake form. Its head
  carries the prominent sans record name over one dot-led identity line (saved stage, the
  date that stage governs, an available posting ID with its source label, and the
  linked-record count), so stage never needs
  restating inside the body. Its sections are APG tabs, not toggle buttons:
  `tablist`/`tab`/`tabpanel`, roving tabindex, arrow/Home/End. Three task tabs
  remain: Overview, Prep, and Documents. Overview is split by task rather than
  storage fields: the wide working pane leads with compact Application status and Key dates
  cards, then shows read-only Role &
  company, Job details, Compensation, and Job snapshot cards. The 392px rail
  leads with Fit and always keeps Job activity directly below it, with a dated
  timeline or an explicit no-other-records state. Source is
  posting provenance, so Overview keeps it read-only under Job details rather
  than beside Stage; correction remains in Prepare. A saved Skipped record uses
  its compact dot-led Stage control as a disclosure trigger instead of showing a
  one-option select or a second card. The trigger reads `Skipped · reasons` on one
  line (at most two short names, then `+N`) and opens an accessibly labelled, visually headerless, focus-managed non-modal popover over the
  sheet for the bounded decision fields; at narrow widths that surface becomes
  a viewport-safe bottom sheet. Application status carries a quiet Timeline
  button in its corner (history icon, visible label, entry count) that opens
  the same anchored popover shell beside the card, falling back below it and to
  the bottom sheet: a titled list of hairline rows (marker, label, optional
  note, date), one row editing in place with its own Save and Cancel, and
  filled Log buttons. Both popovers rely on `--shadow-lift`, whose ring
  separates them from the white groups beneath without a border. Skip reasons, there and in the Skip dialog, are
  native checkboxes in labelled groups, not chips; a suggested reason carries a
  quiet `· suggested` note and its basis is listed in a soft well below. The decision date remains in Key dates, while
  general application notes remain independent data in Prep. Prep
  also owns contacts, saved application questions, and interview preparation.
  Documents remains separate because it is the saved application record, not
  preparation input: its primary row groups Job posting, Resume, and Cover
  letter, while additional uploads sit below. A Skipped record keeps this tab
  job-only: document and additional-upload controls explain that a new
  application attempt is required and cannot write into the historical
  decision. Job posting and saved-PDF previews
  use the same 50–200% zoom strip and Ctrl/Cmd +/-/0 keyboard contract.
  The vertical divider supplies enough context, so neither pane repeats a pane
  header. The cards are borderless groups on the large-radius token, and group
  facts rather than decorate empty space. Dates and numeric values use tabular
  figures. Prepared data is one full-width, permanently expanded
  `Job snapshot` card after the compact facts. Its header carries no item or
  section count. It uses the saved
  brief's existing deterministic structure: Overview; Responsibilities;
  Required and Preferred qualifications; Benefits & policies; and compact tool,
  seniority, and domain signal rows. The potentially long Benefits & policies
  group stays locally collapsed; other list groups show four items before
  disclosing their remainder, so no section becomes another wall of text. The immutable source
  posting opens from Job snapshot or Documents in a read-only overlay that follows the same
  focus-managed stacked-viewer contract as saved PDF previews. The smaller
  viewer centers the text in a bounded document panel so the large application
  dialog does not make the posting feel stretched. The UI never synthesizes a replacement summary. On desktop,
  the working pane and the 392px Fit/activity rail scroll independently; at
  and below 1080px they stack into one natural modal scroll. Fit remains a plain
  categorical advisory: the one-word Limited / Stretch / Reasonable / Strong
  verdict stays left while the summary sits right in one
  quiet tinted block, with no score, ring, confidence, or implied gauge. A
  warning that names no shown finding sits full-width under that block, never
  inside its verdict column. Delete sits apart from Cancel/Close and Save changes, and closing
  edited fields confirms before discarding them. It labels its handoff Edit
  preparation for every stored record. Prepare uses one flat persistent banner
  — not a live region — to
  state which exact application or saved decision an update will mutate.
  Related decisions and attempts never collapse into one row: a quiet linked
  count sits beside the company, while the inspector and detail modal list each
  dated status independently. Each related row exposes Open plus an overflow
  menu; non-destructive Mark as unrelated and destructive Merge duplicate both
  live there so neither carries Open's weight, and Merge always confirms.
- **Stage vocabulary:** every stage label is a settled state
  (Skipped, Applied, Interviewing, Offer, Rejected, Withdrawn). The
  skip stage is **Skipped**, not "Not applying" — a present participle reads as
  an intention rather than a recorded decision, and "Not applying"/"Applied"
  are too close to tell apart in the Stage column. "Passed" is reserved: beside
  Interviewing and Offer it reads as passing a round. The stored status key
  remains `not_applying`. The row context menu separates Active
  (Applied, Interviewing, Offer) from Inactive (Skipped, Rejected, Ghosted,
  Withdrawn), and allows movement in either direction; Ghosted is offered only
  from Applied or Interviewing, and a flagged No response row also offers a
  direct Mark as Ghosted. Ghosted's stage dot is a hollow faint ring. The
  checked current stage is
  disabled. A later-Skipped application retains its historical materials, while
  a Skipped record without an application date remains job-only.
- **Tab rail:** icon-led entries ([icon] [label]) on the chrome tone, under
  sentence-case group labels (Draft / Track) separated by space, not rules.
  Prepare is first and selected by default; its group shows no label, since
  a label over a lone tab of the same name only repeats it. The active entry is a
  native sidebar selection: a `--control` filled row, accent icon,
  ink-strong semibold label. The rail's edge is a resize separator (168–200px,
  default 200; arrow keys step 16px, double-click resets). A drag follows the
  pointer down to icon width, one write per frame. Release snaps toward the
  state the drag left: from the expanded rail, 24px below the minimum
  collapses it to the 52px icon rail; from the icon rail, a 24px pull opens
  it. Anything else settles into range or back where it started.
  Width and collapse are per-browser view preferences (`rolefit:sidebar-width`,
  `rolefit:sidebar`). At 1080px and below the rail is always the icon rail,
  with no toggle or resize. It never changes axis into a top navbar. APG tabs keyboard model is mandatory.
- **Narrow authoring:** at 720px and below, only the Resume tab's precise editor
  becomes the width notice. Prepare, the simpler Cover letter page, masthead,
  tab rail, Answers, Applications, and Analytics remain part of the working
  product, including under high zoom.

### Ledger Rows (signature)

Label/value facts render as settings-style rows: `--ink-soft` label on the
left, `--ink-strong` value with tabular figures on the right, an empty
(invisible) leader between them; 26px line rhythm. Used for analytics lists and
side-panel facts. This, not stat cards, is the default way to show a list of
named numbers. A value that is not recorded ("Not recorded", "Not saved") drops to
`--ink-faint` sans so it never outweighs real data, and prose values (a source
name, "Saved") keep proportional figures; numbers, dates, and identifiers use
tabular figures.

### Analytics Insights (signature)

Analytics is the one chart-led surface. It follows the user's own mockup: a
grouped KPI row, then one grid of bands so the columns end together. From a
900px page width the bands sit on a 15-column track:

1. Activity (two thirds) beside the No response callout above the silence
   bars. Both columns stretch to the same height.
2. The stage distribution across the full width.
3. Needs your attention (three fifths) beside Coming up.

Narrower pages stack the cards in that reading order. Cards use the
tracker's frame; card titles take the display face at 0.92rem, the group
title size.

- **Head.** The page title over a one-line lede. On the right, "Mark as
  Ghosted after [N days]" (common thresholds plus the saved value), an info
  button that opens How it works, and the period select with a calendar icon
  (Last 8, 12, or 26 weeks, or All time).
- **KPI row.** The period's applications by current stage, in grouped cards:
  Total; Applied, Interviewing, Offer; Ghosted (tinted in its own hue);
  Rejected; Withdrawn, Skipped. Each figure is set in its stage's text-strength
  hue. Only Total carries a change, against the same elapsed span one period
  earlier (accent up, danger down; New or a dash when the earlier span had
  none; nothing for All time). Stage figures show their share of the period
  instead: an older cohort has had longer to be answered, so stage counts
  compared across periods would show a trend that is not there. Groups wrap
  rather than squeeze; on narrow pages the single figures share the first
  row.
- **Application activity.** A sub-line with sent, reply rate (a fraction under
  three sent), and reached interview; a Weekly/Monthly select (All time is
  always monthly); a stage legend; columns stacked by current stage (up to
  30px, 2px surface gaps, a 6px rounded top, hairline gridlines). Hover or
  focus shows a tooltip; clicking a column lists it. A screen-reader table
  goes with it.
- **Current stage distribution.** The same cohort as the KPI row, as a pill
  segmented bar with share labels under segments of 4% or more (8% on narrow
  cards), the total beside it, and a key of stage dots with tabular counts.
  Selecting a stage shows an accent selection bar in a live region with a link
  that opens Applications filtered to that stage.
- **No response callout.** A warm cream card with a bell badge, "N
  applications may be ghosted", a plain explanation, Review applications
  (moves focus to the attention list), and the Mark automatically
  `.check-row`. It turns neutral with a check badge when nothing is waiting.
- **Time without a response.** Pill bars (0-7, 8-14, 15-30, 31-59, 60+ days,
  with the threshold always inserted as an edge) spread over the card's
  height; bins at or past the threshold take the full accent. An info hint
  explains the measure.
- **Needs your attention.** A table-like list: select, company with its
  initials mark, role, applied, days quiet, an inferred "No response" pill, a
  next step (Send a follow-up, or Consider Ghosted after an unanswered
  follow-up), and a row menu (Open details, Mark as Ghosted) on the app's
  row-menu primitive. Up to 8 rows show; View all reveals the rest. Mark N as
  Ghosted sits in the header beside the selection it acts on. Narrow cards
  fold the role under the company, then drop next step, applied, and status.
- **Coming up.** Interviews and follow-ups as one dated list: a month/day
  block, the initials mark, company and role, and the event with its relative
  day (overdue in warm). View all opens Applications; a footer counts open
  records without a follow-up date. Rows carry no time of day.

Stage fills are muted inks at the chroma floor so they sit on the neutral
plane, each a light/dark pair (light values below),
validated together in this order (dataviz validator, every adjacent check
passing; ochre, sand, and sea sit under 3:1, relieved by the legend, share
labels, tooltip, and table):

| Stage | Fill |
|---|---|
| Applied | slate `oklch(0.66 0.102 240)` |
| Interviewing | green `oklch(0.55 0.102 165)` |
| Offer | ochre `oklch(0.77 0.11 90)` |
| Ghosted | mauve `oklch(0.66 0.102 310)` |
| Rejected | terracotta `oklch(0.57 0.12 33)` |
| Withdrawn | sand `oklch(0.76 0.105 65)` |
| Skipped | sea `oklch(0.7 0.102 205)` |

Chart text always uses ink tokens; KPI figures use darker steps of the same
hues (all above 4.5:1). Fit verdicts never appear as an analytics dimension.

### Tracker Control Bar (signature)

Tracking surfaces open with one compact control row aligned to the
register-and-inspector grid: a flexible search field, All / Active / Inactive
lifecycle filters, per-status drill-down inside the Active and Inactive split
controls, and one Table / Calendar switch. Filter labels stay plain and counts
live inside the drill-down menu; the page does not grow a second summary or
"Up next" surface above the work. Table mode groups the chronological default
under month dividers and keeps the selected application in the right inspector.
Search defaults to visible identity fields — company, role/title, and posting
ID — and ranks active-query table results by exact company, company prefix,
posting ID, company substring, then role/title before the selected column sort.
Descriptions and notes are excluded. Active searches use a flat
relevance-ordered list; clearing the query restores chronological month groups.
Calendar reuses the same query and lifecycle filter state. On desktop, search,
lifecycle filters, and the view switch share one control height and top edge.
The table pagination footer stays visible for empty results, preserving the
table-and-inspector height register.
The inspector mirrors Application Detail's information ownership without
repeating its form: stage and governing date sit in the identity line; key dates,
an available posting ID with its source label, and Source are read-only; Fit reuses the same two-column verdict-and-rationale
advisory without repeating the assessed resume, and lists its matches, gaps,
and any eligibility concern through the same shared Fit findings Prepare uses;
Job activity always renders, including its no-other-records state; and Documents
always summarizes posting, resume, cover letter, and additional uploads. Open
details owns application edits, while Edit preparation owns prepared-job edits.
The row menu remains the compact exception for quick stage changes.

### Page Anatomy: Sheets Center, Rail Right

Working pages share one skeleton: content as white groups in the main
column, one control surface docked right. Prepare intentionally begins as one
centered Source task, then becomes collapsed source + brief beside one
Application rail containing materials, readiness, and Apply; Resume = one engine-painted
structured editing sheet + workflow rail. That sheet is always mounted, using a
clean blank document when no source exists; content readiness gates PDF, Polish,
and Apply without replacing the editor with an empty-state panel. Cover letter = one engine-painted
plain correspondence sheet + the same workflow-rail hierarchy. Both rails remain
visible from idle through blocked, working, proposal, stale, and applied states.
Resume's primary Polish action runs one grounded proposal request from either
Resume or Prepare. Its rail shows What improved, the proposed edits open in one
disclosure, and one quiet withheld line; when the prompt budget
excludes editable fields, one equally quiet neutral line reports that count.
With the opt-in Polish review on, one more quiet line says the review kept every
edit or could not run, or a collapsed "N held back by review" disclosure lists
the held-back edits with their reason and a Restore action (this resume Restore
returns an edit to the queue; the cover letter's Restore reverts an accepted
letter). A restored row carries a neutral Restored chip, and a result whose
every edit was held back reads "No worthwhile changes after review." above the
same disclosure. Proposal, No changes, and Withheld remain visibly distinct.
When the run was sent Fit gaps, the Resume rail folds one quiet "What this proposal
did about Fit gaps" disclosure (`FitGapStatements`): each gap's posting
excerpt with Addressed and where, No evidence, or Not reported, an earlier-version
note when it applies, and a line that these are the model's statements, not a
check; no count or score. The Resume rail also folds "Posting terms and your
resume" beside the terminology-check limits, grouping recognized terms without
a score. Cover letter keeps
the editor unchanged while showing a whole-document proposal with explicit
Accept proposal and Discard proposal actions; Restore appears only after acceptance.
A resume-only change keeps that existing proposal in the proposal state with
an inline earlier-resume warning and an enabled Accept proposal action; changes
to the letter, job, personal evidence, or polishing instructions use the blocked
stale state and require Polish again.

**Accepting is one interaction across both documents.** The unit differs — the
resume decides individual edits, the letter decides one replacement — and that
difference stays; nothing else about the act does. One decision bar in the rail
footer states what is left, then offers a primary accept beside a secondary
discard, in that order, for both: Accept all / Discard all on the resume,
Accept proposal / Discard proposal on the letter. The resume's rows group by
operation (Rewrite, Add, Remove, Reorder); when several groups show, each
group header repeats the same Accept / Discard pair scoped to that group. One diff treatment marks
changed words in both: the resume's Now and Proposed lines, and the letter's
Changes view behind a Changes / Full letter switch that opens on Changes. One
chip vocabulary reports a settled resume row (Accepted, Discarded, Changed in
editor), each row carries Undo, and each names the section and entry it edits so
the list reads on its own. A decided row de-emphasizes so the queue shows what is
still waiting. Do not give either document a commit location beyond its footer
bar and the resume's group headers, a third verb, or a private way of showing
what changed.
A usable draft keeps its proposal controls and displays compact content warnings
before acceptance. Technically unusable responses show bounded recovery issues;
Cover retries structure once, without repairing content-only concerns. Do not badge ordinary readiness gaps or provider errors as evidence
warnings.
Answers uses a centered conversation column, one rounded bottom composer,
compact Context and Saved answers disclosures, and a model/effort picker inside
the composer. The picker uses the existing stage-settings owner and catalogs and
is the only control for the Answers stage,
opens above its trigger, and stays inside the viewport; it is a compact
label/control grid (Provider, Model, Effort, as in Settings › Models), and the
trigger carries a warm dot when its provider needs attention. The composer
auto-grows without a resize grip; its footer holds the picker, a Refine / Add a
detail switch while refining, and the question's limits beside Send. Employer
questions use quiet right-aligned bubbles whose Edit question appears on hover or
focus for pointer devices; answers stay on an open editable reading surface.
A reopened saved answer with facts shows a collapsed **Your facts (N)**
disclosure inside its question bubble: a muted summary, then a plain list of the
facts as typed.
While drafting, the pending answer slot shows three pulsing dots and "Drafting
your answer" (no simulated streaming: responses arrive whole and fade in), and
the progress dock omits the Answers card while that thread is in view.
Questions and answer revisions stay visually distinct;
counts, warnings and Copy/Save controls sit outside the answer body. New question
clears the refinement target explicitly. The conversation owns its scroll; the
composer remains reachable at narrow widths. Reuse the workspace type, tones,
and accent without a permanent plan
rail. Applications = view surface + inspector. The rail is a single sheet
(`--card`, borderless);
the main column sits directly on the plane. Resume and Cover letter use the same
rail width, divider, labelled header, readiness order, failure placement, and
sticky action footer while retaining document-specific content. Each document remembers its own disclosure preference; collapsing hides
content without unmounting it or resetting inputs, and new results do not force
it open. Collapse reserves no gutter: the rail's track animates shut and the
document takes the space, leaving only the panel icon as a tab on the document's
right edge (plus the issue count only when a blocked cover-letter draft needs
attention). Below ~1080px the rail becomes a full-width
accordion below the editor without desktop overflow. New pages reuse this
skeleton rather than inventing a new arrangement. Resume and Cover letter share
the same two-row editor chrome:
the first row is the document/file bar, and the second is the formatting
toolbar. Primary Polish actions live in the workflow rail; file menus reuse one anchored action-menu component; document-specific
content stays with its owning workflow. The Resume file picker accepts only
`.resume`, and the Cover Letter picker accepts only `.cover`; client preflight
enforces the same boundary if a picker filter is bypassed. Resume Header and
Section controls sit
immediately before Spacing in the formatting row. Every menu in that row is
icon-only at every width — the row shares its container with the action bar and
has no width for labels — and paragraph alignment is one trigger with a menu
rather than four buttons. Nothing in the row scrolls or crops; see
`docs/engineering/ui-principles.md` for the measured disclosure ladder.

### Register Grouping

Long chronological tables group rows under month dividers: a
`.table-eyebrow` month label pinned to the visible left edge while the data
columns scroll horizontally and to the top of the row viewport while the
current month's rows scroll vertically. The table adds no local scrollbar width
or vendor-specific thumb treatment beyond the inspector rail, allowing native
overlay and auto-hide preferences in Firefox and Chromium-based browsers; both
scrollports retain the enclosing studio surface's shared scrollbar color;
when the platform supplies a physical scrollbar, the header reserves only its
measured width so labels and rows remain aligned. The table reads as a logbook
register, not a CRM grid.

## 6. Do's and Don'ts

### Do:

- **Do** use package tokens/classes for shared editor behavior and
  `src/styles/tokens.css` plus per-surface app classes for RoleFit host chrome;
  if a value has no owning token, it does not ship.
- **Do** state status as a small dot beside plain sentence-case text
  (`.stage-dot`, `.nav-menu__sub`).
- **Do** set numbers, dates, scores, and indices with `tabular-nums` in the
  UI face (The One Family Rule).
- **Do** keep errors inline, localized, and user-safe, near the affected
  workflow; surface gaps and bracketed placeholders for human review.
- **Do** keep keyboard access first-class: APG tabs model, visible
  `:focus-visible` rings (2px accent, 2px offset), 24px minimum icon hit
  targets, `aria-live` for async status; honor `prefers-reduced-motion`.
- **Do** keep motion 120–250ms with the house ease
  (`cubic-bezier(0.2, 0.8, 0.2, 1)`), state-driven only.
- **Do** make disabled controls flat and neutral, never a faded tint of the
  enabled state.
- **Do** check every new surface in light and dark; colors come only from
  `light-dark()` tokens.

### Don't:

- **Don't** put marketing landing-page patterns, oversized heroes, or
  gradient-heavy surfaces inside the workspace. The isolated public page
  follows the scoped contract above.
- **Don't** reach for SaaS dashboard clichés: hero metrics and identical
  card grids are banned; use ledger rows. Analytics' grouped KPI row is the
  one exception, set by the user's own mockup.
- **Don't** write sales-style or hype copy, in-product manuals, or
  multi-sentence help essays; labels and hints stay short.
- **Don't** ship fake loading states, shimmer, or decorative motion.
- **Don't** nest cards inside cards; use the flush card variant or drop the
  wrapper.
- **Don't** use `border-left`/`border-right` thicker than 1px as a colored
  accent stripe, gradient text, or glass/blur surfaces.
- **Don't** frame a group, card, input, button, or menu with a border, or
  stack a border under a shadow (The Tone-Not-Lines Rule).
- **Don't** bring back a top bar; the full-height rail + tabbed workspace +
  floating Apply is the shell (2026-10-22).
- **Don't** introduce global toast/banner/loading frameworks, webfonts, or
  new hues outside the token set.
- **Don't** bring back serif, monospace, or tracked uppercase eyebrows in
  chrome.
- **Don't** print raw provider errors, stack traces, or resume text in
  chrome.
- **Don't** lighten `--ink-faint` or lower text contrast below WCAG AA.

One-sentence audit test: if a screen would look at home in a SaaS template
gallery (filled pills, stat cards, banner CTAs) or a bordered form builder,
it has left the workspace; rebuild it from tone, space, and type.

### Content warnings

Follow the [system-wide product policy](PRODUCT.md#content-and-evidence-warning-policy).
Job analysis shows editable extracted fields without evidence warnings or a
condition-review disclosure, including when reopening saved jobs.
Use one compact "Review before use" note beside affected generated content or
assessment findings, visible before acceptance, listing specific concerns;
evidence concerns use **Not supported by provided evidence**, with a short
specific reason only when useful. The note is a small warm-veil box with a
hairline border and a warm dot before its label — never a thick side stripe —
and a Fit finding's note sits under that finding. Every Fit surface (Prepare,
inspector, detail modal) renders the same findings, so no warning ever names a
match or gap the user cannot see. Keep existing Accept, Edit, and Reject
controls and downstream actions available. Do not require dismissal, added
evidence, confirmation, or a separate review step. Accepting never changes a
warning into a Verified label. Unknown citations remain unconfirmed text without
source navigation/highlighting while use stays enabled. Shortness and
content-quality issues are warnings; unresolved template placeholders, invalid
edit targets, and other technical failures retain blocking recovery. Reuse the current rail, findings, disclosures, and tokens.

### Final application review and evidence disclosures

Keep final review flat in the Application rail after readiness and before Apply.
Its secondary action shows the selected provider and a Settings link. Findings
show a concise action, document navigation, and native source disclosures. Preserve
visible keyboard focus, cancellable progress, incomplete/previous-input labels,
and Apply as the primary action. Optional Resume Suggestions and extracted-condition
details use existing disclosures and tokens. Insufficient Fit information uses a
neutral label. Do not use “Verified” for supplied evidence or a clean review.
