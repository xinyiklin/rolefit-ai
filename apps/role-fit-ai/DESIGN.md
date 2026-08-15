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

Layout is structural and predictable: a masthead with the brand plus the global
Apply action, a full-width studio whose rail moves through PREPARE, DRAFT, and
TRACK, a bottom utility group with read-only Sessions immediately above Settings
outside `OUTPUT_TABS` and the APG tablist, matched
resume and cover-letter document chrome with rail-owned primary actions, and document-specific review
rails. Breakpoints (1280/1180/1080/900/820/760
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

The resume and cover-letter pages, document/formatting primitives, fonts,
direct-edit behavior, measurement, pagination, and PDF path come from
`@typeset/editor` over `@typeset/engine`. RoleFit frames those surfaces with
Drafting Desk host chrome. The resume injects its section-scope/review overlay;
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
  empty-input dots and stretch-fit marks.
- **Archival blue** (`--cool`, oklch(0.45 0.06 250)): the "applied" stage and
  quiet archival marks; filed, not active.
- **Brick** (`--danger`, oklch(0.45 0.12 30)): errors, rejected stage,
  weak-fit scores. Soft tints (`--warm-soft`, `--danger-soft`) back inline
  notices only.

### Named Rules

**The One Ink Rule.** Forest Ink touches at most ~10% of any screen: primary
actions, selection, ready states, focus. It is never decoration, never a
section background, never a heading color.

**The Tinted Neutral Rule.** Pure `#fff` and `#000` are forbidden. Every
neutral carries the paper hue (150) or ink hue (160) at chroma 0.001–0.014.

**The Dot-Plus-Word Rule.** Stage and readiness are a 5–7px dot
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
  per document view (Polish beside the workflow rail's disclosure control, in the
  header while open and on the document's edge while collapsed; compact
  `.is-compact` variant in rail actions).
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
  the whole task. URL and pasted text are two keyboard-navigable methods inside
  that panel, and only the selected method is visible; empty Job brief,
  Materials, and readiness scaffolds do not render. After preparation, Source
  collapses into its head (captured size and origin), the editable Job brief
  leads the main column, and one Application rail combines Resume and Cover
  Letter choices, readiness, the saved-application summary, and Apply. Panels
  keep a hairline-separated head — title, quiet meta, trailing actions — over
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
  Fit Assessment row follows the materials: show its verdict, short summary,
  compact run attribution, at most three matches and gaps, and an
  eligibility warning only when relevant. A completed result offers **Reassess fit**; running, disabled,
  unavailable/retry, and out-of-date/reassess states use the same flat hierarchy.
  Starting or failing a new assessment keeps the latest completion visible, and
  an out-of-date result stays visible only as a **Previous preparation** with
  its timestamp plus one compact, hairline-separated **Changed since assessment**
  list. That list names only the changed input groups — job posting, resume
  content, About you, or assessment setup — before **Reassess fit**. Never add
  scores, confidence, evidence ledgers, quotes, or a recommendation to this row.
- **Automation and assessment boundaries:** keep Fit Assessment and Proposal
  Validation visibly and architecturally distinct. Fit Assessment is the
  reusable advisory about how the selected resume and candidate context align
  with the prepared role at the time it runs. Proposal Validation is the
  fail-closed evidence gate over proposed changes before they can be accepted.
  Polish also instructs the selected model to silently audit its own evidence
  and output before returning; that internal pass is not a third user-facing
  workflow. No layer substitutes for another or turns its result into a numeric
  score. User behavior belongs to the
  [Fit Assessment contract](PRODUCT.md#fit-assessment-user-contract), while provider
  mechanics belong to the
  [technical contract](server/ai/README.md#fit-assessment-technical-contract).
  Resume Polish started from Prepare also completes there. Rank the actual
  contents of saved resume and cover-letter variants against weighted
  prepared-job sections. Either material may auto-select a meaningful unique
  winner while its editor has no unsaved document changes and is not
  application-owned; a sole saved variant is selected without ranking. The
  cover-letter resolver waits for its workspace snapshot and preserves the
  application-output title that Prepare assigns, so that title-only change does
  not masquerade as an edited letter body. A tie or
  incomplete read keeps the current selection and shows no recommendation.
  The selector is the normal receipt; show one compact recommendation line only
  when unsaved work blocks replacement. Neither comparison needs persisted
  variant metadata. Resume and Cover Letter automatic Polish controls remain
  independent. Only the first Fit Assessment launched by the current Prepare may
  start either automatic action; reassessment, retry, resume-change assessment,
  and restored history stay advisory. Manual Polish remains available in every
  state.
- **Apply:** the page and masthead invoke the same Apply command and show the
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

- **Masthead:** newspaper-style: a 26px Forest-Ink seal tile with the serif
  initial beside the serif wordmark (the one place the accent is identity,
  not action), then the global Apply action separated by a hairline. Apply
  carries the shared readiness state; no job input or Inputs group lives in
  this bar. Its outcome is not reported here: Apply, Update application, and
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
- **Applications:** its new-work action returns to Prepare. The application
  detail modal edits committed tracker records and never becomes a second job
  intake surface. The broad viewport-bounded panel remains the outer working
  sheet, while Overview uses a small
  number of compact outlined groups to make application controls and saved job
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
  one-option select or a second card. The trigger reads `Skipped · reason` on one
  line and opens an accessibly labelled, visually headerless, focus-managed non-modal popover over the
  sheet for the bounded decision fields; at narrow widths that surface becomes
  a viewport-safe bottom sheet. The decision date remains in Key dates, while
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
  header. The card borders stay hairline-light, use the restrained large-radius token,
  and group facts rather than decorate empty space. Dates and numeric values use
  the mono data treatment. Prepared data is one full-width, permanently expanded
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
  verdict stays left while the fixed summary sits right in one
  quiet tinted block, with no score, ring, confidence, or implied gauge. Delete sits apart from Cancel/Close and Save changes, and closing
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
  remains `not_applying`. Stage changes are forward-only; a submitted record
  cannot be changed into Skipped or moved back to an earlier stage.
- **Tab rail:** icon-led entries ([icon] [label]) on `--card-soft`, under
  small-caps mono group eyebrows (PREPARE / DRAFT / TRACK) above
  hairline-separated groups. Prepare is first and selected by default. The
  active entry is the rail's one committed moment: an
  `--accent-soft` washed row with a `--accent-veil` ring, deep-accent icon,
  ink-strong label. Below 1080px it collapses in place to a 52px icon rail; it
  never changes axis into a top navbar. APG tabs keyboard model is mandatory.
- **Narrow authoring:** at 720px and below, only the Resume tab's precise editor
  becomes the width notice. Prepare, the simpler Cover letter page, masthead,
  tab rail, Materials, Applications, and Analytics remain part of the working
  product, including under high zoom.

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
advisory without repeating the assessed resume, and keeps Top gaps close;
Job activity always renders, including its no-other-records state; and Documents
always summarizes posting, resume, cover letter, and additional uploads. Open
details owns application edits, while Edit preparation owns prepared-job edits.
The row menu remains the compact exception for quick stage changes.

### Page Anatomy: Sheets Center, Rail Right

Working pages share one skeleton: content as paper sheets in the main
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
Proposal, No changes, and Withheld remain visibly distinct.
Cover letter keeps
the editor unchanged while showing a whole-document proposal with explicit
Accept proposal and Discard proposal actions; Restore appears only after acceptance.
A resume-only change keeps that validated proposal in the proposal state with
an inline earlier-resume warning and an enabled Accept proposal action; changes
to the letter, job, personal evidence, or polishing instructions use the blocked
stale state and require Polish again.

**Accepting is one interaction across both documents.** The unit differs — the
resume decides individual edits, the letter decides one replacement — and that
difference stays; nothing else about the act does. One decision bar in the rail
footer states what is left, then offers a primary accept beside a secondary
discard, in that order, for both: Accept all / Discard all on the resume,
Accept proposal / Discard proposal on the letter. One diff treatment marks
changed words in both: the resume's Now and Proposed lines, and the letter's
Changes view behind a Changes / Full letter switch that opens on Changes. One
chip vocabulary reports a settled resume row (Accepted, Discarded, Changed in
editor), each row carries Undo, and each names the section and entry it edits so
the list reads on its own. A decided row de-emphasizes so the queue shows what is
still waiting. Do not give either document a second commit location, a third
verb, or a private way of showing what changed.
If that draft fails the evidence checks after repair, the rail shows one flat
issue list with the exact bounded claim and its recovery action. A collapsed
Cover letter rail adds the bounded issue count to the icon tab and accessible
label; it does not badge ordinary readiness gaps or provider errors.
Materials = draft sheets; Applications = view surface + inspector. The rail is a single sheet
(`--card`, hairline, rest shadow);
the main column sits directly on the desk. Resume and Cover letter use the same
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
- **Don't** reshape the compact masthead + tabbed-studio workflow; changes
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
