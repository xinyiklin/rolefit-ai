---
name: RoleFit AI
description: Editorial print-desk design system for a local-first resume-tailoring studio
colors:
  paper: "oklch(0.956 0.006 150)"
  paper-deep: "oklch(0.934 0.008 150)"
  card: "oklch(0.992 0.002 150)"
  card-soft: "oklch(0.963 0.005 150)"
  card-elev: "oklch(0.997 0.001 150)"
  card-hover: "oklch(0.976 0.004 150)"
  ink: "oklch(0.25 0.012 160)"
  ink-strong: "oklch(0.18 0.014 160)"
  ink-muted: "oklch(0.41 0.014 160)"
  ink-soft: "oklch(0.5 0.014 160)"
  ink-faint: "oklch(0.51 0.012 160)"
  hairline: "oklch(0.885 0.008 150)"
  hairline-soft: "oklch(0.925 0.006 150)"
  hairline-strong: "oklch(0.81 0.01 150)"
  accent: "oklch(0.46 0.085 165)"
  accent-deep: "oklch(0.36 0.075 168)"
  accent-soft: "oklch(0.945 0.024 162)"
  accent-veil: "oklch(0.46 0.085 165 / 0.12)"
  accent-glow: "oklch(0.46 0.085 165 / 0.2)"
  on-accent: "oklch(0.975 0.008 150)"
  warm: "oklch(0.52 0.1 75)"
  warm-soft: "oklch(0.92 0.05 85)"
  cool: "oklch(0.45 0.06 250)"
  danger: "oklch(0.45 0.12 30)"
  danger-soft: "oklch(0.92 0.04 25)"
typography:
  display:
    fontFamily: "Charter, Bitstream Charter, Iowan Old Style, Georgia, Cambria, Times New Roman, serif"
    fontSize: "1.45rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Helvetica Neue, Segoe UI, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    letterSpacing: "-0.002em"
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Helvetica Neue, Segoe UI, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Helvetica Neue, Segoe UI, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
    letterSpacing: "0.18em"
  data:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace"
    fontSize: "0.78rem"
    fontWeight: 600
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  xl: "14px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "22px"
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
    backgroundColor: "{colors.accent-deep}"
  button-primary-disabled:
    backgroundColor: "{colors.card-soft}"
    textColor: "{colors.ink-faint}"
  button-secondary:
    backgroundColor: "{colors.card-elev}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-deep}"
  input:
    backgroundColor: "{colors.card-elev}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  chip:
    backgroundColor: "{colors.card-elev}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    height: "26px"
    padding: "0 12px"
  studio-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  nav-trigger:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 8px"
---

# Design System: RoleFit AI

## 1. Overview

**Creative North Star: "The Drafting Desk"**

RoleFit AI is a drafting desk, not a dashboard. Content surfaces read as
paper sheets laid on a deeper desk tone; the chrome around them borrows from
print production: a newspaper masthead joined to the workspace by one crisp
hairline, an icon-led
tab rail grouped like a table of contents, dotted-leader ledger rows, mono
indices and tabular figures. The serif voice appears only in identity chrome (wordmark,
page titles), the way a paper's nameplate differs from its body type. The tool
is calm, dense, and trustworthy; it disappears into the task of tailoring a
resume.

Inside the Drafting Desk, the system explicitly rejects marketing landing-page
patterns and oversized in-app heroes, gradient-heavy surfaces, SaaS dashboard clichés
(hero metrics, identical card grids), sales-style copy, fake loading states,
shimmer, decorative motion, and nested card-in-card containers. Status is
stated quietly (a small dot beside a word), never shouted (filled pills,
banners, badges everywhere).

Layout is structural and predictable: masthead menus (Sessions, Resume, Job,
AI, Options) plus the Polish action on top, full-width tabbed studio below, export
rail at the bottom of the resume tab. Breakpoints (1280/1180/1080/900/820/760
px) collapse structure; they never fluidly rescale type. Desktop ~1440px is
the primary canvas; content wraps rather than clips below it.

**Key Characteristics:**

- Paper-on-desk depth: tonal layers and hairlines, not shadows.
- Three type voices with strict jobs: sans chrome, serif identity, mono data.
- One committed accent (Forest Ink) reserved for action and selection.
- Dot-plus-word status vocabulary; ledger rows for label/value facts.
- Density with calm: compact spacing, short labels, restrained contrast.

### Public product/download page

`landing/` is a separate public composition, not a route or mode of the
Drafting Desk. It shares the compact creator-level masthead, screenshot-led
product framing, and clear project boundary used across Xinyi Lin's portfolio,
including Careflow, while retaining RoleFit's paper, forest, hairline,
mono-label, and truthful-copy vocabulary. It may use a larger serif hero and
shows real product captures, the local runtime boundary, and explicit macOS
Apple silicon, macOS Intel, and Windows x64 download rows. Unlike the Drafting Desk, which rejects decorative
motion, the landing carries the restrained entrance motion shared across the
portfolio: a one-shot fade-and-lift as sections scroll into view (never
looping) and a small hover lift on cards — a progressive enhancement that
collapses under `prefers-reduced-motion` and never leaves content hidden when
scripting is unavailable. It must not imitate
the working app shell, use gradients or template-style feature cards, imply
hosted execution, guess the user's architecture, or attempt native-install
detection. At a missing or invalid release, it keeps the platform choices
visible and states that no complete verified installer set is available instead
of rendering a broken primary action.

### Shared editor boundary

The resume page, document/formatting toolbar family, popovers, font controls,
and direct-edit behavior come from `@typeset/editor` over `@typeset/engine`.
RoleFit frames that shared surface with Drafting Desk host chrome and injects
only its section-scope/review overlay. Do not fork shared markup or layout CSS
for a RoleFit-only tweak; add a narrow host seam and verify both products.

`packages/editor/src/styles/` owns shared editor/tooling behavior. RoleFit's
`src/styles/` owns the masthead, studio, tracker, materials, review, workflow,
and host-specific integration overrides. The cascade between them is a public
integration contract, not permission to duplicate the shared component.

## 2. Colors

Green-tinted paper neutrals around one committed forest accent, with three
quiet semantic signals; nothing is ever pure white or pure black.

### Primary

- **Forest Ink** (`--accent`, oklch(0.46 0.085 165)): the working ink of the
  desk. Primary actions (Polish, Apply), current selection, ready-state dots,
  focus rings, the active tab index. Hover deepens to **Forest Ink Deep**
  (`--accent-deep`, oklch(0.36 0.075 168)); **Forest Ink Wash**
  (`--accent-soft`, oklch(0.945 0.024 162)) tints selected rows and hover fills;
  `--accent-veil` (12% alpha) and `--accent-glow` (20% alpha) carry selection
  highlights and the 3px focus ring. Text on the accent uses `--on-accent`,
  a paper tone, never white.

### Neutral

- **Paper** (`--paper`, oklch(0.956 0.006 150)) and **Desk**
  (`--paper-deep`, oklch(0.934 0.008 150)): the app background and the deeper
  canvas behind tracker tabs, so content cards read as sheets on a desk.
- **Sheet family** (`--card` 0.992, `--card-soft` 0.963, `--card-elev` 0.997,
  `--card-hover` 0.976): content surfaces, quiet wells, raised inputs and
  popovers, row hover. All hue 150, chroma ≤ 0.005.
- **Ink family** (`--ink-strong` 0.18 → `--ink` 0.25 → `--ink-muted` 0.41 →
  `--ink-soft` 0.5 → `--ink-faint` 0.51, hue 160): the only text colors.
  Hierarchy comes from stepping down this ramp, not from new hues.
  `--ink-faint` is the floor; it was darkened to pass WCAG AA and must not be
  lightened.
- **Hairline family** (`--hairline` 0.885, `--hairline-soft` 0.925,
  `--hairline-strong` 0.81): all structure. Rules, dividers, borders, dotted
  leaders.

### Signal

- **Warm amber** (`--warm`, oklch(0.52 0.1 75)): attention without alarm;
  empty-input dots, stretch-fit scores, high priority.
- **Archival blue** (`--cool`, oklch(0.45 0.06 250)): the "applied" stage and
  low-priority marks; filed, not active.
- **Brick** (`--danger`, oklch(0.45 0.12 30)): errors, rejected stage,
  weak-fit scores. Soft tints (`--warm-soft`, `--danger-soft`) back inline
  notices only.

### Named Rules

**The One Ink Rule.** Forest Ink touches at most ~10% of any screen: primary
actions, selection, ready states, focus. It is never decoration, never a
section background, never a heading color.

**The Tinted Neutral Rule.** Pure `#fff` and `#000` are forbidden. Every
neutral carries the paper hue (150) or ink hue (160) at chroma 0.001–0.014.

**The Dot-Plus-Word Rule.** Stage, priority, and readiness are a 5–7px dot
beside plain text. Color never carries meaning alone, and filled pill badges
are not the default status vocabulary.

## 3. Typography

**Display Font:** Charter (system serif stack: Bitstream Charter, Iowan Old
Style, Georgia, Cambria, Times New Roman)
**Body/UI Font:** Geist (with -apple-system, BlinkMacSystemFont, Helvetica
Neue, Segoe UI fallbacks)
**Data Font:** JetBrains Mono (with SFMono-Regular, Consolas, Menlo fallbacks)

**Character:** A print shop's three voices. The serif is the nameplate and
page titles only; the sans is every working control; the mono is anything
that is a number, index, or identifier. No webfont theatrics; all three
stacks resolve to system fonts.

### Hierarchy

- **Display** (serif, 600, 1.45rem, lh 1.2, ls -0.005em): page titles
  (`.page-serif`, studio card h2), set on a baseline hairline rule in the
  page head. The wordmark is the same voice at 1.1rem/700; page titles may
  be the largest type on a page, the nameplate stays the most distinctive.
- **Title** (sans, 600, 0.9rem): panel headings and secondary card heads
  (`.studio-card__subhead`); these stay sans so the serif keeps rank.
- **Body** (sans, 400–500, 0.82–0.88rem, lh 1.45–1.5): controls, prose,
  table text. Prose stays under 75ch; tables and ledger rows may run denser.
- **Label / Eyebrow** (sans, 600, 0.62–0.72rem, uppercase, tracked
  0.06–0.18em): `.eyebrow`, `.table-eyebrow`, field labels. The widest
  tracking (0.18em) belongs to the masthead eyebrow only.
- **Data** (mono, 500–600, 0.64–0.92rem, tabular-nums): ledger values,
  figures-strip numbers, dates, fit scores, model identifiers.

### Named Rules

**The Serif Is Chrome Rule.** Charter appears only in identity chrome:
wordmark and page-level titles. Never in buttons, labels, body copy, inputs,
or data.

**The Mono Means Data Rule.** If it is a number, count, date, score, index,
or identifier, it is mono with `tabular-nums`. If it is a sentence, it is
never mono.

## 4. Elevation

The system is hairline-structured and near-flat. Depth is conveyed by tonal
paper layers (desk `--paper-deep` → sheet `--card` → raised `--card-elev`)
and 1px hairlines; shadows exist only as whispers at 3–8% alpha to settle
sheets onto the desk. The fixed-height masthead uses one 1px structural rule
so its lower edge meets the sidebar and workspace without a false gap.

### Shadow Vocabulary

- **Rest** (`--shadow-rest`: 0 1px 0 oklch(0.2 0.01 160 / 0.04), 0 6px 20px
  oklch(0.2 0.01 160 / 0.03)): default studio card sit.
- **Lift** (`--shadow-lift`: 0 1px 0 / 0.05, 0 14px 36px / 0.08): popovers
  and overlays only; the maximum elevation in the app.
- **Inset** (`--shadow-inset`: inset 0 1px 0 oklch(1 0 0 / 0.6)): a top
  inner highlight on accent-filled buttons.
- **Rail** (`--shadow-rail`): upward hairline + faint haze under the export
  rail.
- **Masthead** (`--shadow-mast` and the double-rule box-shadow): hairline
  edges, zero blur.

### Named Rules

**The Whisper Shadow Rule.** No shadow exceeds ~8% alpha. If a surface needs
more separation, change its paper tone or add a hairline; never darken the
shadow.

## 5. Components

Component character: refined and restrained; quiet ink-on-paper controls
framed by hairlines, with one accent-filled primary action per view. Every
interactive control shares the same focus treatment: 2px Forest Ink outline,
2px offset (or a 3px `--accent-glow` ring on text fields).

### Buttons

- **Shape:** gently rounded (6px); compact heights (38px primary, 32px
  secondary, 28px ghost), 120–160ms transitions, 1px translateY on press.
- **Primary:** Forest Ink fill, paper text, `--accent-deep` border, inset
  highlight plus a faint accent glow; hover deepens to `--accent-deep`. One
  per view (Polish in the masthead; compact `.is-compact` variant in title
  rows).
- **Secondary:** raised sheet (`--card-elev`) with `--hairline-strong`
  border; hover tints toward the accent (`--accent-soft` fill,
  `--accent-deep` text).
- **Ghost:** transparent, borderless, for tertiary row actions.
- **Disabled:** flat neutral (`--card-soft` fill, `--ink-faint` text, no
  shadow), never a washed-out tint of the enabled state, so "inert" and
  "ready" cannot be confused.

### Chips

- **Style:** pill (999px), raised sheet background, `--hairline-strong`
  border, mono 0.74rem in `--ink-muted`; used for keyword lists.
- **Counts/badges in the tab rail:** 16px mono pills on `--paper-deep`,
  accent-washed when the tab is active.

### Cards / Containers

- **Corner Style:** 10px (`--r-lg`); popovers 14px (`--r-xl`).
- **Background:** `--card` sheets on the desk; `--card-soft` for quiet wells
  (recovery strip, pipeline columns); `--card-elev` for popovers.
- **Shadow Strategy:** `--shadow-rest` at rest; `--shadow-lift` for floating
  surfaces only (see Elevation).
- **Border:** always a 1px `--hairline`; sheets are framed, not floating.
- **Internal Padding:** `--s3`/`--s4` (12/16px); heads get a serif Display
  title plus a quiet dot-led meta note (`.studio-card__meta`), not badges.
- **Flush variant** (`.studio-card--flush`): when the content is already a
  framed surface (editor, cover-letter sheet), the wrapper drops its box
  entirely; box-in-a-box is forbidden.

### Inputs / Fields

- **Style:** raised sheet (`--card-elev`), 1px `--hairline-strong` border,
  6px radius, 32px min height, 0.82rem sans; field labels are small
  semibold eyebrows.
- **Focus:** border flips to Forest Ink plus a 3px `--accent-glow` ring.
- **Upload box:** dashed `--hairline-strong` border on `--card-soft`,
  accent-tinted on hover.
- **Native appearance** is stripped from text fields only; checkboxes and
  radios keep native controls. Editor font-family choices use the shared custom
  dropdown so the toolbar and Styles matrix have the same visual and keyboard
  behavior in every browser.
- **AI setup** keeps Distill, Tailor, and Review expanded together with no
  per-section collapse affordance. Each stage retains its own concrete
  provider/model/effort controls and **Copy from** action. Provider rows come
  from the local companion's explicitly added registry; added-but-unready rows
  show reconnect guidance. API credentials are never rendered or entered in
  the browser.

### Navigation

- **Masthead:** newspaper-style: a 26px Forest-Ink seal tile with the serif
  initial beside the serif wordmark (the one place the accent is identity,
  not action), then typographic menu triggers (no boxes, no pills) separated
  into groups by hairline verticals; each trigger leads with a small icon
  (`--ink-faint`, accent on hover/open); hover shows a 1px ink underline at
  18% opacity (35% when open) and a `--card-soft` tint. Each trigger carries
  a dot-plus-word input-state readout (`is-ready` accent, `is-empty` warm).
  Popovers are 14px-radius raised sheets with `--shadow-lift`, entering with
  a 140ms 4px slide-fade.
- **Tab rail:** icon-led entries ([icon] [label]) on `--card-soft`, under
  small-caps mono group eyebrows (DRAFT / TRACK) above hairline-separated
  groups. The active entry is the rail's one committed moment: an
  `--accent-soft` washed row with a `--accent-veil` ring, deep-accent icon,
  ink-strong label. Below 1080px it collapses in place to a 52px icon rail; it
  never changes axis into a top navbar. APG tabs keyboard model is mandatory.
- **Narrow authoring:** at 720px and below, only the Resume tab's precise editor
  becomes the width notice. The masthead, tab rail, Materials, Applications,
  and Analytics remain part of the working product, including under high zoom.

### Ledger Rows (signature)

Label/value facts render as print-ledger lines: `--ink-soft` sans label, a
dotted `--hairline-strong` leader filling the gap, mono tabular-nums
`--ink-strong` value; 26px line rhythm. Used for analytics lists and
side-panel facts. This, not stat cards, is the default way to show a list of
named numbers.

### Figures Strip (signature)

Inline summary figures sit in one hairline-bounded strip: tiny faint label
over a mono 0.92rem value, items separated by 1px dividers. This replaces
hero-metric card grids everywhere. It belongs to Analytics: tracking
surfaces lead with search, lifecycle filters, and the working register, never
a second row of summary numbers.

### Tracker Control Bar (signature)

Tracking surfaces open with one compact control row aligned to the
register-and-inspector grid: a flexible search field, All / Active / Inactive
lifecycle filters, per-status drill-down inside the Active and Inactive split
controls, and one Table / Calendar switch. Filter labels stay plain and counts
live inside the drill-down menu; the page does not grow a second summary or
"Up next" surface above the work. Table mode groups the chronological default
under month dividers and keeps the selected application in the right inspector.
Calendar mode reuses the same query and lifecycle filter state.

### Page Anatomy: Sheets Center, Rail Right

Working pages share one skeleton: content as paper sheets in the main
column, one control surface docked right. Resume = one engine-painted editing
sheet with quiet margin controls + review
rail; Materials = draft sheets + plan rail; Applications = view surface +
inspector. The rail is a single sheet (`--card`, hairline, rest shadow);
the main column sits directly on the desk. Below ~1080px the rail drops
under the content. New pages reuse this skeleton rather than inventing a
new arrangement.

### Register Grouping

Long chronological tables group rows under month dividers: a
`.table-eyebrow` month label left, mono count right, one hairline rule.
The table reads as a logbook register, not a CRM grid.

## 6. Do's and Don'ts

### Do:

- **Do** use package tokens/classes for shared editor behavior and
  `src/styles/tokens.css` plus per-surface app classes for RoleFit host chrome;
  if a value has no owning token, it does not ship.
- **Do** state status as a small dot beside plain sentence-case text
  (`.stage-dot`, `.nav-menu__sub`, `.studio-card__meta`).
- **Do** set numbers, dates, scores, and indices in JetBrains Mono with
  `tabular-nums` (The Mono Means Data Rule).
- **Do** keep errors inline, localized, and user-safe, near the affected
  workflow; surface gaps and bracketed placeholders for human review.
- **Do** keep keyboard access first-class: APG tabs model, visible
  `:focus-visible` rings (2px accent, 2px offset), 24px minimum icon hit
  targets, `aria-live` for async status; honor `prefers-reduced-motion`.
- **Do** keep motion 120–250ms with the house ease
  (`cubic-bezier(0.2, 0.6, 0.2, 1)`), state-driven only.
- **Do** make disabled controls flat and neutral, never a faded tint of the
  enabled state.

### Don't:

- **Don't** put marketing landing-page patterns, oversized heroes, or
  gradient-heavy surfaces inside the Drafting Desk. The isolated public page
  follows the scoped contract above.
- **Don't** reach for SaaS dashboard clichés: hero metrics and identical
  card grids are banned; use the figures strip and ledger rows.
- **Don't** write sales-style or hype copy, in-product manuals, or
  multi-sentence help essays; labels and hints stay short.
- **Don't** ship fake loading states, shimmer, or decorative motion.
- **Don't** nest cards inside cards; use the flush card variant or drop the
  wrapper.
- **Don't** use `border-left`/`border-right` thicker than 1px as a colored
  accent stripe, gradient text, or glassmorphism.
- **Don't** reshape the masthead-inputs + tabbed-studio workflow; changes
  refine it, never restructure it.
- **Don't** introduce global toast/banner/loading frameworks, new fonts, new
  hues, or pure black/white.
- **Don't** put the serif in controls or body copy, or mono in sentences.
- **Don't** print raw provider errors, stack traces, or resume text in
  chrome.
- **Don't** lighten `--ink-faint` or lower text contrast below WCAG AA.

One-sentence audit test: if a screen would look at home in a SaaS template
gallery (filled pills, stat cards, banner CTAs), it has left the drafting
desk; rebuild it from hairlines, paper tones, and ledger vocabulary.
