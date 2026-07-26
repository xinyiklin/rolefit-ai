# RoleFit AI Continuity

Cross-workspace decisions and handoff state. Keep entries factual, dated, and
bounded; app-only operational detail belongs in the affected app documentation.

## 2026-07-26

- [USER] The next desktop release should reflect a larger product step than the
  previously suggested 0.4.0, refresh the public landing page, and remove stale
  README and engineering-document references before publication.
- [CODE] RoleFit's source version is 0.5.0. The jump from 0.3.0 reflects the
  complete candidate-owned cover-letter document workflow, named resume and
  cover-letter variants and history, expanded shared-editor behavior,
  independent configuration for five AI stages, and the rebuilt application
  tracker. It remains below 1.0 while installers are unsigned and auto-update
  is out of scope.
- [CODE] The public landing page now presents RoleFit as an
  application-materials workbench, gives the cover-letter editor its own
  product surface, and uses fresh fictitious-data captures of the current
  companion, resume, cover-letter, tracker, menu, calendar, and application
  detail interfaces.
- [CODE] The versioned examples in the app README, desktop guide, development
  guide, and distribution plan now use 0.5.0. Historical 0.3.0 release notes
  and the documented 0.3.0 recovery lesson remain unchanged.
- [CODE] Portable backup schema version 1 still excludes standalone saved
  `cover-letter*.cover` variants and their history. The app README, backup
  contract, and 0.5.0 preview note now state that boundary and direct users to
  save `.cover` copies separately.
- [TOOL] Publication target is the curated unsigned preview
  `rolefit-preview-v0.5.0-beta.11`; the release is complete only after its
  native macOS and Windows jobs, installed lifecycle checks, checksum gate,
  GitHub prerelease publication, Pages deployment, and live download
  resolution all succeed.

## 2026-07-25

- [TOOL] CORRECTS the standing note that `vertical-parity.mjs` was "already red
  before this work". It is red on THIS BRANCH ONLY: `origin/main` is green on
  the same eval (last three runs successful), and PR #87's CI reproduces the
  failure as its single RoleFit failure. The eval predates main (`e6ce369`), so
  the divergence was introduced by this branch's engine work and has been
  carried forward, not inherited. Treat it as an open regression against main,
  not as a known-bad baseline.
- [USER] `entryEndIndentPt` is the ENTRY's right edge and applies to every row of
  the entry — head rows, bullets, summary paragraphs, skills rows. Deliberately
  NOT Jake, who insets only the head row's `tabular*{0.97\textwidth}` and leaves
  bullets on a plain `itemize` with no right margin. Jake is the style reference,
  not a specification to match exactly.
- [CODE] That application is unchanged from `main` and was never the problem. The
  real difference is the DEFAULT: `main` ships `entryEndIndentPt: 0`, and this
  branch raised it to 5.4 with the Jake-derived starter defaults. A non-zero
  inset narrows every body column by 5.4bp, which wraps one long bullet a word
  earlier than the frozen Tectonic fixture — compiled when the value was
  effectively 0. An earlier cut of this fix moved the inset off the body columns
  to chase the fixture; that was reverted as soon as the preference above was
  stated. Superseded: the note that the body columns were over-applying it.
- [TOOL] `vertical-parity.mjs` therefore sets `entryEndIndentPt: 0` inside its
  own `legacyStyle()`, beside the other legacy-era mappings. The fixture holds
  per-line `{p, y, x0}` and the probe is named for the VERTICAL model; zeroing a
  horizontal width policy the fixture predates keeps it measuring junctions
  rather than line breaking. A vertical regression still fails it. Green again:
  20 lines within ±1.5bp, RoleFit suite 47/48 with only the Windows-only
  `EPERM: symlink` probe red.
- [TOOL] PR #87 (`codex/wip-editor-document-actions` -> `main`) carries the whole
  branch. Its first CI run reproduced the parity failure as RoleFit's single
  red — Typeset green, and the Windows-only backup probe green on Linux, both as
  predicted.

- [USER+CODE] A TOO-LONG MENU no longer runs past the window and shifts the
  document. Reported as "not necessarily a bug"; it was one. Every popover's
  height cap was a viewport fraction assuming the panel starts just below the
  toolbar, so a trigger further down put the panel's end past the window — and
  an absolutely positioned descendant EXTENDS its scroll container's scrollable
  area, so the studio body silently became scrollable under it. Measured at a
  520px-tall window: Styles ran 34px past the bottom and `.studio-body`
  scrollHeight went 463 -> 498. `Popover` now measures the room under its
  trigger on open (and on resize) and publishes `--popover-space`; panels bound
  themselves by it, with a 160px floor. After: the panel ends 9px inside the
  window and scrollHeight is 463 again. At 900px nothing changes — the measured
  space (743) loses to the designed 650px cap.
- [CODE] A panel with its own scrolling body subtracts `--popover-frame` (2px,
  the surface's border) from that value. Without it the panel is exactly two
  pixels too tall for the border-box holding it, and the surface grows a SECOND
  scrollbar beside the body's own — measured before the fix.
- [CODE] REPORTED BUG, fixed: a popover opened from the collapsed toolbar's More
  panel painted OVER the panel. Below 900px the style popovers pin to a fixed
  slot under the toolbar (`top: 102px`) — which is exactly where the open More
  panel sits. Inside an open panel they now use anchored placement, with the
  trigger set `position: static` so the surface resolves against the PANEL: the
  panel wraps to two rows at ~430px, and anchoring to the button would have left
  a first-row popover covering the second row. Forced right-aligned, which
  cannot overflow — the panel is pinned 12px from the edge and these surfaces
  are at most `100vw - 24px` wide. Measured at 900px (panel 159–209, popover
  213) and 430px with a wrapped panel (panel 159–247, popover 251).
- [USER] SMALL-CAPS HEADING WOBBLE is font overshoot plus pixel quantization at
  the rendered size, not a layout defect. Measured in LM Roman Caps 10: flat
  small caps have a cap height of 515.6/1000 em, round ones 531.3 — a 3%
  overshoot every serious typeface has. At a 16pt heading that is 8.25 device px
  of ink, which the rasterizer resolves to 8 or 9 whole pixels per glyph. The
  PDF is unaffected. The document now sets `text-rendering: geometricPrecision`
  (paint hint only; measured NO change to painted advances — the heading is
  84.125px either way), so whether it improves the appearance is UNCONFIRMED and
  needs the user's eyes; the QA pane cannot screenshot. The remaining lever is
  snapping each painted baseline to a whole device pixel on screen, which trades
  the documented DOM/PDF baseline agreement and has not been done.
- [USER] Returning to a document tab also restores the SCROLL OFFSET, not just
  the caret. `useRestoredScroll` holds it host-side beside the caret; opening a
  document resets both.
- [CODE] Two non-obvious constraints in that hook, both hit while building it:
  the offset cannot be applied on the first commit (the engine paints after
  layout, so the scroller has no scrollable height yet and the assignment
  silently clamps to 0 — it retries per render until the content is tall
  enough), and it cannot be read from a PASSIVE cleanup (a detached element
  reports `scrollTop` 0). A layout cleanup reading the element captured at mount
  is correct. A scroll listener was tried first and abandoned: it adds a handler
  on a hot path, and scroll events DO NOT FIRE AT ALL in the QA browser pane,
  which made the whole feature unverifiable there.
- [USER] Masthead menu panels (Sessions, Job) anchor to their OWN trigger's right
  edge instead of their group's left edge. The group anchoring existed to align
  the paired Resume/Job and AI provider/Options menus under one another; both
  pairs are gone, and with the surviving controls at the right of the bar a
  380px left-anchored panel ran past the window and was left pressed against the
  edge by the viewport clamp. Measured at 1280px: the Job panel's right edge now
  meets its trigger's, 132px clear of the window.
- [CODE] The clamp had to change with it. A `position: absolute` box offset by
  `right` has an AUTO `left`, which absorbs a `margin-left` and moves nothing —
  the old nudge was silently dead under right anchoring (measured: margin
  applied, rect unchanged). It uses `margin-right` now, and handles left
  overflow, which is the direction a right-anchored panel overflows. Verified at
  420px: the Job panel lands at left 8 instead of -19.7.
- [USER] A document page ALWAYS has a caret. Opening a document puts it at the
  first line and takes focus, and so does arriving at the page for the first
  time; RETURNING to the Resume or Cover letter tab resumes the caret you left
  there.
- [CODE] The first-visit rule was the missing half, reported from the running
  app: the Cover letter tab painted with NO focus and no caret, because its
  blank letter is `useState` initial data rather than a load, so no open path
  ever ran for it. A mount with no stored caret now starts at the document
  start, and a stored caret whose field is gone falls back there instead of
  leaving the page caretless. Re-homing on every tab switch was rejected: it discards your place, and
  the resume's "start" is the NAME field, where one stray keystroke edits the
  most conspicuous line in the document. A tailored AI result does not take
  focus — it lands while you are reading the review.
- [CODE] The studio tabs UNMOUNT the editor, so a returning caret cannot live in
  the editor. `TypesetEditor` gained `initialCaret`/`onCaretExit` (a
  `TypesetCaret` = field key + VALUE index, which survives the repaint) and the
  host holds one per document. `focusDocumentStart()` is the open-time entry
  point; it records the request and forces a paint instead of placing
  immediately, because a host calls it one tick BEFORE the new data is painted —
  placing then would place the caret in the outgoing document. Neither may
  return early from the restore effect, which also reopens the commit gate.
- [CODE] An open never steals focus from a text field outside the editor. The
  workspace load resolves whenever the server answers, which can land while the
  user is typing the job description; buttons and the page background are fair
  game, an input/textarea/select is not, and the caret is still placed so the
  next Tab lands there. Verified live both ways.
- [CODE] No open site has to remember any of this: App wraps `seed`/`seedData`
  before they reach `useWorkspaceResume`, and `useCoverLetterEditor` routes its
  user-initiated loads through one `openDocument`. The tailored-result path
  still calls `seedData` directly, which is the whole distinction.
- [TOOL] Live QA in a FRESH tab (an HMR session that hot-swaps hooks reports
  hook-order and dep-size errors and an App crash that the error boundary
  recovers — artifacts, not defects; a reloaded tab has a clean console): boot
  load focused the resume at `name`/0; a caret at `contact|1`/4 survived a
  round trip through another tab; the guided starter opened focused at `[Date]`;
  Blank opened with the title input focused left focus there and still placed
  the caret; typing and undo still commit. One test artifact worth knowing:
  the caret is recorded on `selectionchange`, which is ASYNC, so placing a
  selection and unmounting in the same tick loses it.
- [USER] The caret LEANS with italic text. It is sheared by the active face's
  own `post.italicAngle` (Carlito -7°, Source Sans 3 -11°, Source Serif 4 and
  Arimo -12°, Latin Modern -14.036°, Tinos -16.333°) about the baseline it
  already reports, so its position at the insertion point is unchanged and only
  its slope moves. Arming italic with a collapsed caret leans it before the
  first character is typed, and a caret placed inside existing italic text leans
  from the text it sits in.
- [CODE] That angle is the ONE font fact `fontRegistry.ts` writes by hand:
  `metrics.gen.ts` does not carry it, regenerating it needs the pinned Python
  toolchain, and the browser cannot report it. `font-assets.mjs` therefore reads
  `post.italicAngle` out of each shipped sfnt sibling and fails on any drift; a
  `FaceAsset` union makes the italic flag and the angle inseparable. Negative-
  tested by declaring a wrong angle.
- [CODE] `sameCaretGeometry` compared position only, so the first cut painted no
  slant at all: a family's upright and italic faces share vertical metrics, so
  arming italic produced an identical box and the memoized upright geometry was
  kept. It compares slope and baseline offset now.
- [USER] Font menu order is recognition first — Tinos (Times New Roman), Carlito
  (Calibri), Arimo (Arial), then Source Serif 4, Source Sans 3, Latin Modern.
  The families a posting or a career office names by name lead; the house faces
  follow. Order is presentation only; the persisted ids did not move.
- [USER] A NEW cover letter now starts in Carlito, not Source Serif 4 — a cover
  letter is business correspondence and Calibri is what business correspondence
  is written in, with metrics that survive a reader opening it in Word. The
  resume default stays Latin Modern. Existing letters are unaffected: the style
  is persisted per browser (`rolefit:coverLetterStyle.v1`) and only an absent
  key falls back to the default.
- [TOOL] `cover-letter-file-v1.mjs` asserted a soft wrap as the fixed pair
  `[" ", ""]`, which is a property of the DEFAULT FAMILY'S ADVANCES — the
  fixture wrapped in Source Serif and fits one line in Carlito. It now asserts
  the separator SHAPE over however many lines the family produces.
- [TOOL] Adding font families is BLOCKED on this machine: no Python is
  installed, and `scripts/generate_font_assets.py` needs Python 3.9+ with
  fonttools 4.60.2 / brotli 1.2.0 plus network access to the digest-pinned
  sources. The natural next candidates are Gelasio (Georgia metrics) and Caladea
  (Cambria metrics), both open and metric-compatible with faces resumes are
  asked for. UNCONFIRMED whether either ships usable italic/caps lookups.
- [TOOL] Verified: engine, editor, and Typeset checks green; RoleFit offline
  suite 46/47 with the two already-recorded reds (`vertical-parity.mjs` fixture
  divergence, `workspace-backup-probes.mjs` Windows `EPERM: symlink`). Live QA
  on the running dev server read the caret's computed transform: upright when
  italic is off, `skewX(-7deg)` on a Carlito cover letter, `skewX(-14.036deg)`
  on a Latin Modern resume both armed and inside existing italic text; menu
  order and the Carlito cover-letter default confirmed; console clean. No
  screenshot: the QA pane was not displayed, so it composites no frames.
- [CODE] AUDIT of the cover-letter workspace slice found three real defects, all
  now fixed and locked by evals:
  1. `variant` is a LABEL the server slugs; `fileName` is a name it only
     validates. The client sent the ACTIVE FILE NAME as `variant`, so "Update
     Growth" re-slugged it and wrote
     `cover-letter-cover-letter-growth-cover.cover` — a mangled duplicate instead
     of an update. Silent: it returned 200 and listed the new file.
  2. The Open menu's saved list called the workspace loaders directly, discarding
     unsaved edits with NO confirm, while Blank/Starter/file-picker all asked and
     the resume's equivalents both call `confirmReplaceEditor`. Now routed through
     `openSaved`/`restoreSaved`.
  3. `activeCoverFileName` survived Blank, Starter, and an uploaded `.cover`, so
     Save still offered "Update <that letter>" and would have overwritten an
     unrelated saved letter with the new document. All three reset it now.
- [CODE] Audit cleanups: `formatHistoryDate` was copied into App and the cover
  toolbar (now `src/lib/historyDate.ts`); `ExportMenu` returned an empty wrapper
  when idle, consuming a flex gap in the action bar, and now returns null.
- [CODE] A11y REGRESSION from the shared Open menu, now fixed: every saved-row
  action rendered as a bare "Open"/"Restore", so a screen-reader button list read
  as identical controls. The `ResumeMenu` it replaced carried
  `title="Load <file>"` / `"Restore <name> from <date>"`, so context was LOST in
  the rewrite. Each row action now has an aria-label naming its document, and
  `SettingsStage`'s "Check providers" (one per blocked stage) names its stage.
  UNVERIFIED LIVE: the populated saved list still has no data in this workspace,
  so only the static expression is confirmed.
- [USER] Menu rows carry a description only when the title is not enough, so
  `description` is optional on both menu action types. Downloads whose title names
  the format (.resume, .cover, PDF) have none; ".txt — content only, no
  formatting" keeps one because it must be told apart from .cover.
- [CODE] The bulk at the bottom of the resume Save menu was `workspaceStatus`
  holding a permanent instructional sentence ("Local workspace ready. Save a base
  resume to use it automatically on startup.") — 48px of in-product manual, which
  `ui-principles.md` already forbids, restating what that menu's own "Save as
  default base" row says at the point of action. `useWorkspaceResume` no longer
  sets it; real save feedback and errors still flow through the same status.
  Resume Save measured 388px -> 297px.
- [USER] The cover letter's PDF export now opens the SAME rename prompt as the
  resume — a PDF is the file you send, so its name is worth confirming for both.
  `downloadPdf` takes an optional base name and `ExportMenu` (dialog only since
  its trigger moved into Save) is mounted in the cover toolbar too.
- [USER] Cover letters now have NAMED VARIANTS and version history, the same as
  base resumes. This needed new storage, not just UI: `server/coverLetterWorkspace.ts`
  stores `cover-letter*.cover` beside `base-resume*.resume`, with
  `/api/workspace/cover-letter`, `/cover-letter/select`, and `/cover-letter/restore`,
  and its snapshot fields ride along on `GET /api/workspace` so one fetch seeds
  both editors. Supersedes the 2026-07-25 note that cover letters are never
  written to the workspace.
- [CODE] That module is a SIBLING of `workspace.ts`, not a generalization of it:
  it imports the storage primitives (lock, atomic write, trash stamping, listing)
  and reimplements only the parts that differ — one extension instead of four, no
  plain-text import path, no bundled-starter fallback. Parameterizing the
  battle-tested base-resume path for a simpler document would have complicated it
  for both.
- [CODE] `workspace.ts` imports `coverLetterWorkspace.ts` and vice versa. The
  cover module therefore reads NO top-level binding from `workspace.ts` during
  evaluation — an earlier cut held `jobWorkspaceDir` in a module-level const,
  which is a TDZ ReferenceError at import time depending on load order. Both
  import orders are now proven to resolve at runtime, not just to typecheck.
- [CODE] Save is one shared `DocumentSaveMenu` for both documents: update the
  active workspace copy, save a named variant, then the downloads. PDF moved in as
  a download row, so both bars are Open/Save/Polish. `ExportMenu` kept the rename
  dialog and status but lost its trigger — it is controlled by `promptOpen` now,
  because the dialog cannot live inside a popover that closes when it opens.
- [TOOL] The new routes are proven by an HTTP round-trip probe
  (`server/__evals__/cover-letter-workspace-probes.mjs`): save → archive on
  overwrite → select → restore, plus traversal keys, a resume payload rejected by
  the cover validator, and an oversized body. They could NOT be verified in the
  running app: port 5181 is the Electron companion's server process, started
  before these changes, so it serves the old routes. A client reload picks up the
  UI but not the server — restart the companion to exercise variants end to end.
- [USER] The Starter button is GONE from both action bars; starting a document and
  reopening a saved one are the same decision, so both live in Open. Resume and
  cover letter now share ONE `DocumentOpenMenu`, grown from the cover letter's
  menu shape: a heading, the start actions (bundled starter / blank / choose a
  file), then the documents already saved in the workspace. `ResumeMenu.tsx` is
  deleted along with 169 lines of its bespoke CSS. Both bars are now
  Open/Save/PDF/Polish.
- [CODE] `DocumentOpenMenu` takes declarative `actions` and `saved.groups`; an
  action resolving `false` keeps the menu OPEN, which preserves the cover
  letter's behavior of not dismissing your choice when you cancel the
  "Replace cover letter?" confirm.
- [CODE] SUPERSEDED the same day by the cover-letter workspace store above. The
  saved list was briefly empty for cover letters because they were download-only;
  `saveCoverFile` now remains as the "take a file away" download beside the
  workspace save.
- [CODE] `activeBaseResumeLabel` is derived once in App; the Open menu's
  description and the Save menu's "update this base" row both name it, and it was
  being recomputed inline at each call site.
- [USER] All preferences live in ONE Settings dialog, opened from the foot of the
  studio tab rail. Its three sections are AI stages, About you, and Guidance,
  with Reset and Done in the dialog footer. The masthead's "AI provider and
  model" and "Options" menus are DELETED (`AiMenu.tsx`, `PolishMenu.tsx`),
  leaving Sessions, Job target, and Apply. A
  modal with a section nav was chosen over a taller anchored popover because five
  provider blocks plus demographics plus four free-text fields do not fit the
  NavMenu pattern.
- [CODE] `src/config/aiStages.ts` is the single declaration of a configurable AI
  stage. `StageId`, the persisted key triples, the settings seeder, the Copy
  settings control, and the Settings dialog all derive from it. This was several
  hand-maintained lists, and the failure mode is silent: the cover-letter and Q&A
  flows were BOTH hardcoded to `stages.tailor` while looking configurable. Both now
  have their own provider/model/effort.
- [CODE] Cover/answers INHERIT Tailor's config when they have none of their own, so
  an install predating the split keeps the provider it was already using. That
  inheritance lives in the new pure `src/lib/stageSettings.ts` seeder, NOT in
  `normalizeSettings`. Putting it there first was a real regression caught by
  `workspace-backup-contract-eval`: that contract accepts a restored settings bag
  only if it round-trips through `normalizeSettings` unchanged, so an additive
  migration rejects every backup written before the key existed. `normalizeSettings`
  may repair and remove; it must never add. The seeder is a pure module purely so
  `stage-settings-eval.mjs` can cover the inheritance without React.
- [CODE] `buildCandidateFactsContext` gates education POSITIVELY (on a known level
  producing a line) rather than on `!== "unspecified"`. Stricter than the
  citizenship gate, and it cannot crash on an absent level the way the first cut
  did — an undefined level entered the block and dereferenced `facts.major`.
- [CODE+USER] Custom instructions are per stage over a shared default: a stage
  with non-blank override text sends it, otherwise it sends the shared box. The
  polish pipeline's `commonBody` no longer carries `customInstructions` — Tailor
  and Review are separate requests, so a shared string sent Review the Tailor
  guidance. An emptied override is DELETED from storage rather than saved as "",
  so blank and absent cannot diverge.
- [USER] Settings > About you adds education level and field of study to the
  candidate facts. `buildCandidateFactsContext` no longer returns early when
  citizenship is unspecified: citizenship gates the work-authorization lines,
  education level gates the field of study, and the two are independent opt-ins.
  Every field still emits nothing until declared, which matters because that
  string becomes the keyword-grounding allowlist — an unset default must never let
  an undeclared citizenship, clearance, or DEGREE become groundable resume wording.
- [USER] The resume Polish action ASKS which stages to run (Tailor and review /
  Tailor only / Review only) and remembers the pick; Settings holds the same value
  as an editable default. `polishStages` stays the one owner, so the chooser SETS
  it and the run starts on the NEXT render. That two-step is required, not
  stylistic: `polishStages` is in the pipeline's input fingerprint and the
  fingerprint effect aborts any in-flight run when it changes, so starting the run
  in the same tick as the setState aborts the run it just started.
- [CODE] The Polish trigger now gates on inputs only (`polishInputsReady`) and each
  stage row gates on its own provider, because one trigger cannot be gated by a
  choice the user has not made yet. `buildPolishContext` requires an editable
  Tailor scope for every selection including Review-only, so the input gate is
  unchanged.
- [USER] Cover letter matches the resume: its action bar says Polish (not Tailor),
  the "Plain correspondence document" context label is gone, and the page header
  is flat and the same fill as the resume header. Two separate causes —
  `.studio-card--flush` kept a 10px radius that only ever CLIPPED content, which
  the Cover letter page's `overflow: hidden` turned into rounded top corners the
  Resume page never showed; and `.cover-letter-tab__toolbar` overrode the primary
  row to `--card-elev`, a shade lighter than the shared `--card`.
- [USER] Settings shows NO runtime diagnostics. The local-server address,
  workspace path, and provider counts belong to RoleFit Companion — they describe
  the machine the companion runs, not a browser preference. The per-stage
  readiness list went with them: it restated each stage row, which already shows a
  blocked provider beside the control that fixes it. `workspacePath` is off the
  `useWorkspaceResume` surface again.
- [USER] That left "Advanced" holding only a reset button, and a nav entry leading
  to a near-empty panel is worse than no entry. Reset is now pinned at the FOOT OF
  THE SECTION RAIL — an action rather than a section, reachable from whichever
  section is open, and the same shape as Settings sitting at the foot of the
  studio rail that opens the dialog. The nav is exactly the three real preference
  groups. No copy was lost: the confirm dialog already carried the full "what this
  clears" explanation. A full-width dialog footer was tried first and read as a
  detached bar under the content; it also cost the panel 51px of height. The
  autosave note ("Changes save as you make them") moved to the dialog header,
  where it answers the missing-Save-button question without a bar of its own.
- [USER] Copy pass over the settings surfaces. Fixed: "Legally authorized to work
  in U.S." (missing article), "Nothing here reaches the model until you set it"
  (no singular antecedent), "A stage with its own instructions in AI stages"
  (location phrase mid-sentence), "Polish runs" (reads as a verb) -> "Default
  Polish stages", and a Reset section whose intro and hint restated each other.
  The per-stage toggle is now "Add instructions" / "Edit instructions" instead of
  two different phrasings both ending in "for this stage".
- [USER] The first cut of Settings > AI stages was bulky and sloppy. Measured:
  each stage was a bordered card INSIDE another bordered card at 317px tall, five
  of them in a 625px panel (2.85x scroll), each with an always-open instruction
  textarea for an optional override. Card-in-card is explicitly rejected by the
  Drafting Desk and I introduced it. Rebuilt as frameless hairline-separated rows
  with the override disclosed: 139px per stage, 1.39x scroll, zero bordered
  descendants. `ProviderSection.tsx` and `MenuSection.tsx` are replaced by
  `SettingsStage.tsx`, and their popover-era CSS (147 lines sized for a 380px
  menu, not an 860px dialog) is deleted.
- [CODE] A collapsed-but-set instruction override renders a two-line clamped
  preview. Guidance that is actually being sent to a provider must never be
  invisible; the disclose label also switches from "Add instructions" to
  "Edit instructions".
- [USER] Stage copy is shorter and free of internal jargon — "Owns the fit score,
  gaps, and verdict" became "Audits your draft like a recruiter and scores the
  fit", and the awkward "Instructions for job distill" interpolation is gone. The
  cover stage is titled "Cover letter", not "Cover letter tailor".
- [CODE] Settings' reset clears stored preferences and reseeds in-memory state
  from defaults behind a danger confirm. The debounced auto-save then rewrites the
  defaults, so the storage key returns immediately — that is fine because
  `hasStoredSettings()` is only consulted at boot by `browserPrefsSync`. Documents
  and tracked applications are untouched.
- [TOOL] `requestAnimationFrame` NEVER FIRES in the QA browser pane when the pane
  is not displayed (proven: a scheduled callback had not run across two tool
  calls). `useModalFocus` and `Popover` both place initial focus in a rAF, so
  initial-focus and focus-restore behavior is UNVERIFIABLE there and reads as
  "focus stayed on body". Modal stacking and hit-testing still verify normally —
  the reset confirm was measured painting above the Settings dialog and
  hit-testable. Do not report a rAF-driven focus contract as verified from that
  pane.
- [TOOL] `client-workflow-guards.mjs` counts its own assertions now (93) instead
  of printing a hand-maintained total that had already drifted.
- [TOOL] RoleFit offline suite is 45/47. The two reds are unrelated and both
  pre-existing: `vertical-parity.mjs` (recorded fixture divergence) and
  `workspace-backup-probes.mjs`, which fails on this machine with
  `EPERM: symlink` — Windows needs elevation or Developer Mode for `fs.symlink`,
  and the probe dies in a temp directory before touching product code.
- [USER] Selected-paragraph alignment is ONE trigger with a labelled menu, not
  four buttons. `AlignmentControl` shows the active alignment on the trigger, so
  the collapsed control still reports state. It reclaims ~97px of a 48px row and
  therefore survives three stages further down the responsive ladder. Opening it
  moves focus off the document exactly as the link editor does; that is safe
  because `commandTarget()` falls back to the last recorded selection.
- [USER] RoleFit's formatting-row menus are ICON-ONLY at every width. The host
  seam inverted: `data-toolbar-labels` now takes `"icon"` (RoleFit sets it on both
  editor toolbars) and the old `"text"` label-first bands — including the
  1190.01–1210px interlock and the 900px structure-label exception — are deleted.
  Typeset never sets the attribute and keeps its labels-until-1210px default, so
  its documented desktop appearance is unchanged. Header/Section keep their icons
  now; the seam previously hid them.
- [CODE] The formatting row was CLIPPED, not scrolled, between 1041 and 1080px of
  container width: measured 33px of overflow at 1041 with `studio-body`'s
  `overflow-x: hidden` swallowing it, so Page silently lost its right edge. The
  band existed because the default label collapse fired at 1210 while the More
  overlay only engaged at 1040, and RoleFit's label-first seam kept Header and
  Section wide in between.
- [CODE] The disclosure ladder is now four measured stages on container width —
  style menus at 920, selection typography at 740, alignment at 520, then clear
  formatting + spell check at 460 (which also tightens group spacing). Each
  threshold is the intrinsic width of the set still inline above it, so no width
  leaves a control half-painted. Clear formatting and spell check gain duplicate
  mounts in the overlay rather than being dropped; `LinkControl` deliberately does
  NOT get one, because its `open` state is host-controlled and two mounts would
  both open. Measured with a per-descendant right-edge sweep: RoleFit resume and
  cover letter fit 1140→355px and Typeset fits 1440→355px (formatting row) and
  →365px (primary row), against a documented 400px floor.
- [CODE] `.toolbar-button--icon:has(.toolbar-button__trailing)` un-squares a
  label-less button that still carries a disclosure chevron; the 32px icon box
  crushed the alignment trigger's two glyphs. `.font-family-control` is 112px
  (was 128px); its menu is still content-sized, so no name truncates further.
- [CODE] The clear-formatting tooltip printed `⌘\\`. A JSX attribute string does
  not process escapes, so the shortcut is now an expression constant.
- [TOOL] Verified `@typeset/editor` checks (typecheck + 3 evals), both app
  production builds, and live browser QA on RoleFit resume/cover letter and
  Typeset: all four ladder stages move the right controls into the overlay, the
  overlay stays inside the toolbar and wraps at the narrow edge, an icon-only
  Spacing trigger still opens its popover, and applying Center from the alignment
  menu moved the paragraph and undid in one step with the trigger label following.
  RoleFit's offline suite is 44/46: `vertical-parity.mjs` remains the already
  recorded fixture divergence, and `workspace-backup-probes.mjs` fails on this
  machine with `EPERM: symlink` (Windows needs elevation or Developer Mode for
  `fs.symlink`) — an environment limitation, not a code regression.
- [USER] The hyperlink overlay is driven by the CARET and SELECTION, not by hover:
  it shows when the caret is inside a hyperlink or hyperlinked text is selected.
  The "Detected" badge is gone. Hover was wrong for an editor — it fires while
  reading rather than acting, no keyboard user can reach it, and it competes with
  selection dragging for the pointer.
- [CODE] ROOT CAUSE of the reported caret bug: `autoLinkSuppress` stored a
  SNAPSHOT of the field value, and `renderData` composed fresh data with it, so the
  repaint after every keystroke inside a URL painted pre-edit text — one character
  short. `displayIndexToCaret` then clamped the restore to the end of that shorter
  text, so the caret landed one back. That moved it off the word's trailing edge,
  which cleared the deferral and linked the URL mid-typing, and the next space then
  landed INSIDE the URL: typing `example.com` left the caret before the `m`, and the
  following space produced `example.co m` linked as `example.co`. State now holds a
  display RANGE and `suppressedAutoLinkValue` derives the paint from the current
  value every render, so the paint can never lag the data. Reproduced in the
  browser and proven offline before and after; the offline eval sweeps every prefix
  of `"example.com "` and asserts the paint's display equals the current value.
  The bug needed a repaint between keystrokes, so it appeared at human typing speed
  and NOT under machine-speed synthetic typing.
- [CODE] Link state is not inherited like character formatting. `applyEdit`
  inherited `linkHref` and `linkSuppressed` from the character to the left, so
  typing after a link swallowed the rest of the sentence into it and `<nolink>`
  leaked into everything typed after a de-linked URL, permanently killing
  auto-linking there. Both are now inherited only when the insertion point is
  strictly inside one run.
- [CODE] `expandToLinkRun` expanded from the selection's own bounds, so a selection
  touching two links returned a range labelled with the first href but reaching into
  the second — Remove and Apply then rewrote the neighbouring link's text. It now
  expands only across one href's contiguous run; a crossing selection resolves to
  the first link. Removing BOTH links from one crossing selection would need a
  multi-run command and is not implemented.
- [CODE] `trailingLinkWordAt` deferred explicit links too, so a real hyperlink
  visibly lost its anchor whenever the caret rested at its end. Only automatic links
  are deferred.
- [CODE] `automaticLinkHref` linked bare filenames: `resume.pdf` became
  `https://resume.pdf`, which a resume triggers constantly. The existing code-suffix
  denylist is now a general file-suffix denylist. It stays a denylist of extensions
  rather than an allowlist of TLDs because a real public-suffix list is too large to
  bundle, and denying an extension only costs a link the user can still add
  explicitly while allowing one silently ships a broken destination. Suffixes that
  are also TLDs people type bare (io, co, dev, app) are deliberately excluded.
- [CODE] The cover letter never received `onRequestLinkEditor`, so the menu's
  "Edit link"/"Add link" and the card's Edit were silent no-ops — a regression from
  giving it the context menu while its link-popover state stayed private to its
  toolbar. The state is lifted to `CoverLetterTab`.
- [CODE] Editor overlays are wrapper-relative siblings inside `.typeset-editor`,
  not viewport-fixed portals. The card was `position: fixed` on a one-shot rect and
  detached from its link on scroll (measured: link moved 150px, card moved 0). Scroll
  events are paint-gated and could not be observed at all in the QA pane, so a
  scroll listener was unverifiable; wrapper-relative geometry needs none.
- [TOOL] A hook returning a fresh object each render, consumed by an effect that
  writes state, is an infinite render loop ("Maximum update depth exceeded"). Found
  in the first cut of the selection-driven card. Destructure the hook's stable
  callbacks and make every repeatable state write identity-stable.
- [TOOL] An adversarial multi-agent audit of the link/caret pipeline independently
  confirmed the root cause from three directions and surfaced further defects that
  are CONFIRMED BUT NOT YET FIXED: PDF link annotations are emitted per run so
  interior spaces of a multi-word link are unclickable while the DOM paints one
  continuous anchor; a justified line that stretches past the 1.75x space-join bound
  splits a linked phrase into one anchor and one underline per word; the engine
  auto-links the raw field VALUE while the editor auto-links the ligature-transformed
  DISPLAY string; the engine auto-links name/heading/entry-head/contact fields per
  WHOLE FIELD while the editor works per word; `End`/`Shift+End` cannot reach a
  field's authored trailing spaces; the replay queue stalls when a drained intent
  commits nothing; and RoleFit's right-click menu resolves `position: fixed` against
  the editor scroller rather than the viewport.
- [USER] Resume and Cover letter now use matched document action bars above the
  formatting toolbar. Resume owns Starter, Open, Save, PDF, and Polish there;
  Cover letter owns Starter, Open, Save, PDF, optional Restore source, and Tailor.
  The masthead no longer owns Resume or Polish, and Cover letter no longer shows
  Copy.
- [CODE] `DocumentActionMenu` is the shared RoleFit disclosure shell. Resume Open
  carries base variants, Recent history, and file upload without the old
  Save/Reload/Remove cluster. Resume Save separates updating the active base,
  saving a named `base-resume-<variant>.resume`, and downloading `.resume`.
  Cover Save separates `.cover` from a plain-text copy. The workspace snapshot
  now exposes the bundled starter independently of the active saved base so the
  Starter action never needs to overwrite or disguise that base.
- [CODE] RoleFit injects `DocumentStructureControls` through the shared
  `FormattingToolbar.documentStructureTools` seam, placing Header and Section
  immediately before Spacing. At narrow widths that same order moves into More;
  standalone Typeset keeps its existing DocumentToolbar placement.
- [TOOL] Verified `@typeset/editor` checks, RoleFit production build, focused
  workspace persistence/lifecycle probes, and all desktop contract probes. Live
  browser QA at 1440, 1280, 1000, and 820px confirmed the action order, Open/Save
  surfaces, both starters, responsive disclosure, absent Cover Copy, and a clean
  console. The RoleFit offline suite remains 45/46 because the already-recorded
  `vertical-parity.mjs` fixture divergence is still red and unrelated.

## 2026-07-24

- [USER] Before requested pushes, review and update affected README and
  documentation; commit compact, privacy-safe continuity with the behavior
  slice. Version changes also update canonical/user-facing versions and require
  a triggered, successfully completed matching release/publish workflow before
  the versioned change is complete.
- [TOOL] Local `main` was fast-forwarded to `origin/main` at `58fcf3f`
  (`Harden AI workflows and refresh application tracker`) before the current
  cover-letter work began.
- [USER] Cover letters are moving out of Materials into a dedicated editor page.
  The workflow starts from the user's own written letter and tailors it against
  the job description and truthful candidate evidence; it does not generate a
  new letter from nothing.
- [USER] Cover-letter presentation is a plain correspondence document: one text
  column and paragraphs, without resume sections, rules, columns, or bullets.
- [USER] The cover-letter page uses the same document and formatting toolbar
  family as the resume editor, but it must not expose resume-specific structure,
  heading, entry-indent, or resume-spacing settings.
- [CODE] The portable editable cover-letter format is `.cover`, with magic
  `typeset-cover-letter` and schema version 1. `.resume` remains resume-only,
  while `.rolefit-backup` remains the product-level workspace backup format.
- [CODE] `@typeset/engine` owns the shared measurement, line breaking,
  pagination, font, DOM/PDF painting, and strict portable-file primitives.
  Cover-letter paragraph composition is a separate engine adapter. RoleFit owns
  job/provider orchestration, source-letter intake, tailoring, and review UX.
- [CODE] `FormattingToolbar.documentStyleTools` is the narrow host seam for a
  non-resume document grammar. RoleFit replaces the default resume style menus
  with a focused line-height popover plus the shared page-margin popover; the
  shared history, zoom, selection formatting, alignment, link, and spell-check
  controls remain unchanged for both document types.
- [USER] Direct editing uses word-processor behavior across both document
  layouts: Tab inserts four preserved spaces (Shift+Tab remains a focus escape),
  copy/paste retains supported inline formatting, mixed font-family selections
  leave the family control blank, and Ctrl/Cmd +/-/0 controls document zoom.
- [USER] Mixed font-family and font-size selections leave both toolbar controls
  blank. Custom typed inline sizes clamp to 1–200 pt without changing the
  curated preset dropdown. Selection highlighting spans the full engine-line
  height determined by its largest inline run.
- [USER] The cover-letter page always presents an editor. With no uploaded,
  restored, or authored base, it starts as a clean blank paragraph; opening a
  source remains optional.
- [CODE] Empty engine paragraphs paint a DOM-only zero-width caret target that
  selection mapping and clipboard handling exclude from document content, so a
  blank cover letter remains immediately editable.
- [USER] Fresh starter resumes, New, and Reset use the canonical Jake-derived
  defaults, including the 10.8 pt start indent and 5.4 pt end indent implied by
  Jake's 0.15 in list plus 0.97-text-width entry rows.
- [USER] The bundled RoleFit starter is the serialized canonical starter, so
  its title, subtitle, and skill-label marks already match Reset text
  formatting instead of changing appearance the first time Reset is used.
- [USER] A collapsed editor caret follows the active next-typing family, face,
  and size and remains visible while toolbar settings own focus. The engine
  wraps otherwise-unbreakable oversized tokens at measured grapheme boundaries
  instead of allowing them to overflow the page; inline font, size, and mark
  boundaries within the token do not create early line breaks. A grapheme that
  cannot fit the current remainder moves intact to the next line, preventing
  single-character formatting runs from oscillating as the user types.
- [USER] Committing a font-family or font-size selection returns keyboard focus
  from the toolbar control to the saved document caret or text range.
- [CODE] Mixed families and sizes remain independent runs on one line. All runs
  share one engine baseline; the DOM painter measures the browser's real CSS
  baseline per bundled face, and pagination expands calibrated line junctions
  for oversized inline ink so adjacent lines cannot collide.
- [ASSUMPTION] A separate AI review pass is not required for the first
  cover-letter editor slice. The product keeps the pre-tailoring source
  recoverable and presents deterministic human-review checks; this decision may
  be revisited with quality evidence.
- [USER] The editor follows word-processor behavior (Word, Google Docs, Pages)
  wherever the two models disagree. Vertical placement therefore depends on the
  fonts and sizes on a line, never on which glyphs were typed: `VLine` carries
  its role-size ink footprint plus `riseOverflow`/`dropOverflow` derived from the
  new `faceExtent`, and pagination adds only that overflow to a calibrated
  junction. Previously the page-top inset and the junction expansion read typed
  ink, so typing a taller letter at a larger inline size moved the line. All-
  nominal rows keep their calibrated distances exactly; `inkExtent` stays only
  for the TeX-calibrated entry title/subtitle strut.
- [CODE] A cleared section heading no longer opens extra space. Its injected
  space measured as zero nominal ink against a full-height row, which added the
  whole heading footprint to both adjacent junctions.
- [CODE+USER] Underline and link rules now come from `underlineSpans` plus a
  face-derived `underlineRule(style)`, superseding the 2026-07-11 per-content
  TeX `\underline` depth. That depth made the rule step between two links in one
  paragraph, and because the DOM painter measures merged style spans while the
  PDF emitter walks single runs, an underlined phrase drew one continuous rule on
  screen and one broken rule per word in the exported PDF.
- [CODE] Enter in a prose paragraph always starts a new paragraph, including from
  an empty one; bullet and skills rows keep the non-empty-only rule. Cover-letter
  authors could not open a blank line between blocks.
- [CODE] Cover-letter New restores the blank document's saved fingerprint, so a
  fresh blank letter is not reported as unsaved.
- [CODE] Bold/italic/underline with a collapsed caret arm the next-typing format.
  Only the toolbar buttons did; the keyboard shortcut and the browser's
  `formatBold`/`formatItalic`/`formatUnderline` intents reached a commit that
  returned early on a collapsed selection. All three now share one path.
- [CODE] Selection rectangles are bounded by each line's painted text. The line
  block spans the whole sheet and a browser stretches mid-selection fragment
  rects to their containing block, so Select All highlighted the page margins
  (measured: 0→815 px across an 816 px sheet). A selected empty paragraph keeps a
  short stub instead of vanishing from the highlight.
- [CODE] Selections that cross field boundaries are editable. `readSelection`
  returns null unless both endpoints map to one field, so Select All silently
  disabled delete, typing, formatting, and the whole toolbar. The new
  `multiFieldSelection.ts` resolves the covered fields and their display ranges,
  and a `batch` reducer action plus `applyFieldEdits` lands the whole change as
  one undo step. Cross-field deletion removes emptied prose paragraphs and
  bullet rows, joins the boundary remainders inside one list, keeps at least one
  row per covered list, and never removes a name, contact, heading, entry-head,
  or skills slot — those belong to the structure controls. Link commands stay
  single-field.
- [CODE] Cross-field resolution reads only document order plus the range's two
  endpoints; it no longer asks `Selection.containsNode` per span. A DOM selection
  is one contiguous range, so the fields it touches are a contiguous slice, and
  the endpoint-only form behaves the same whichever way an engine shapes a
  select-all range (Blink puts the boundaries in the first/last text nodes, Gecko
  can put them on the editing host with child offsets). An endpoint that resolves
  to no field means "from the start"/"to the end". Multiple ranges (Gecko-only)
  span first-start to last-end. A single covered field is allowed, so a
  one-paragraph Select All whose endpoints do not resolve still edits.
- [CODE+USER] Painted lines end with the separator their break stood for (a space
  inside one field, a newline between fields), marked `data-tsds` and rendered
  contentEditable=false inside the font-size-0 line box, so it is invisible and
  zero-width. Without it the browser's word iterator ran the last word of a line
  into the first word of the next: a double-click on the last word of a paragraph
  selected across the break ("gammaDelta"). `lineSeparators` lives in `layout.ts`
  (React-free, testable); caret placement, line-edge movement, and the selection
  rectangle exclude the span.
- [CODE] A range boundary that names no field is resolved by DOCUMENT POSITION,
  not by assuming the document's first or last field. A triple-click ends on a
  line container, so the old assumption made a one-paragraph selection report —
  and copy — the whole document.
- [CODE] Cross-field copy writes plain text from the model, one covered slice per
  field joined by newlines. The DOM-derived path lost paragraph breaks and could
  leak the caret placeholder; the model path also keeps an authored hard break's
  real newline, which the layout separator deliberately does not distinguish.
- [USER] Linking and pasting must work on a multi-paragraph selection. A
  cross-field selection now links every covered range in place, with the link
  popover's text field read-only (`linkTextEditable: false`) because one string
  cannot rewrite multi-paragraph text; remove-link clears them all. Paste replaces
  the selection inside the same batched edit (one undo step), and cut — previously
  a silent no-op across fields — writes the model's text and deletes.
- [CODE] KNOWN GAP: pasting text that contains blank lines inserts hard breaks in
  one paragraph rather than creating paragraphs, so a pasted multi-paragraph
  letter arrives as a single paragraph. `parseCoverLetterText` splits paragraphs
  only on the Open/load path. Fixing it needs a reducer action that replaces one
  paragraph with several, plus a decision for the resume host (pasting into a
  bullet list). Not attempted in this slice.
- [TOOL] The in-app browser driver cannot produce `insertParagraph`, Backspace's
  `deleteContentBackward`, or native Select All (CDP key events carry no editing
  command), so those paths were exercised by dispatching the app's own
  `beforeinput` intent and setting the range directly. Typing, real toolbar
  clicks, marks, and geometry read back normally.
- [USER] Cross-field Select All was confirmed fixed in Firefox by the
  endpoint-only resolution. Gecko puts a select-all range's boundaries on the
  editing host, which no endpoint-based key lookup can name, so `readSelection`
  now falls back to the covered-field resolution and treats a ONE-field selection
  as single-field. Without that, Firefox lost every command needing one run of
  text — the reported symptom was a dead link control on a fully selected
  single-paragraph letter, working in Blink and not in Gecko.
- [CODE] Wrapped continuation lines are editable again. A line break consumes the
  interword glue (or the authored newline) into the break, so that display
  character has no DOM character in either line; both caret mappings in
  `domSelection.ts` desynchronized there. `caretToDisplayIndex` returned null for
  any caret on a continuation line — no typing, no editing, and queued keystrokes
  such as a second space were dropped — and `displayIndexToCaret` resolved a
  restored caret to the end of the line above, so the next character landed in
  the previous word (typing past the margin produced "rightg" instead of "marg").
  A caret AT a break belongs to the end of the broken line; past it, to the start
  of the next. Emergency mid-token breaks and same-line style boundaries consume
  nothing, and the crossing is resolved for blank-line spans too — an authored
  hard break paints a blank line that consumed its own display character, so
  skipping it desynchronized every caret after it.
- [TOOL] `apps/role-fit-ai/src/typeset/__evals__/vertical-parity.mjs` is RED and
  was already red before this work: bullet, summary, and skills columns subtract
  `entryEndIndentPt` (5.4 default), which Jake's source applied only to entry
  head rows, so one truth line reflows by a word. Setting `entryEndIndentPt: 0`
  makes all 20 lines match within ±1.5bp. UNCONFIRMED whether the body columns or
  the fixture should change; the decision reflows every existing resume.
- [USER] The document font list gains the three families resumes are most often
  asked for, as their redistributable metric-compatible equivalents: Tinos
  (Times New Roman), Arimo (Arial), and Carlito (Calibri). The originals are not
  redistributable; these keep the originals' per-character advance widths, so a
  document holds its line and page count when opened in a word processor that
  only has the original. The menu shows each font's real name with its metric twin
  beside it — never the trademark as the font's own name — and previews each row
  in its own face. Verified against the published originals: Tinos and Arimo match
  Times New Roman and Arial with ZERO deviation on the sampled repertoire.
- [CODE] `lib/fontFamilies.ts` is the single list of family ids. The persisted
  style enum, `FONT_FAMILY_OPTIONS`, both `<font=…>` tag automata (engine
  measurement and the editor's display map), `clearInlineOverride`,
  `effectiveFieldFont`, and the engine face registry all derive from it. They were
  eight independent hardcoded copies; the tag automata are regex strings, so a
  missed copy TYPECHECKS and then fails at runtime with the tag painted as
  literal text. `typeset-editing.mjs` now sweeps every family through a
  value→display→value round trip, which is the only mechanical guard on that.
- [CODE] The three new families are drawn on a 2048-unit em, so `metrics.gen.ts`'s
  integer 1000ths cannot represent every advance exactly. The residue is per glyph
  and bounded — `pdf-font-parity` measured 0.1166bp worst case over a 61-character
  run at 10bp, and each painted segment carries an explicit engine width so it
  never accumulates past one segment. The eval now allows 0.005bp/glyph for a
  finer design grid and holds every 1000-unit family to bit-exact parity
  (measured 0.0000bp), so a real shaping divergence still fails. Rescaling their
  outlines to 1000/em was rejected: it would trade an invisible engine-vs-render
  difference for a visible break in the metric compatibility that is the reason
  to ship them.
- [CODE] None of the three ships a usable `smcp` lookup (Carlito's `c2sc` has one
  substitution), so their caps faces carry SYNTHESISED small capitals: uniformly
  scaled capitals baked into the shipped font's cmap. Uniform scaling is not an
  approximation of a different design — Latin Modern's own caps face, a genuine
  TeX design, measures 0.7513 height and 0.7522 advance against its capitals. The
  ratio floors at 0.80 (the median real small-cap height of the three bundled
  families) and rises with a face's x-height, because Arial-metric Arimo's
  x-height would otherwise reach past its own small caps. Synthesis lives in the
  ASSET, not in a layout branch, so the browser, the PDF embedder, and the
  committed metrics agree by construction.
- [CODE] `boldDisplay` aliases `bold` for the three static families. Latin Modern
  and the Source families ship a real display optical size (LM Roman 12,
  `opsz: 24`); a single-design static has none, so both roles share one asset,
  one metrics record, and one `@font-face`.
- [CODE] A new editor eval (`styles/__evals__/font-assets.mjs`) cross-checks the
  registry against the stylesheet and the disk: every face declared exactly once,
  loading its own asset at the right weight/style, with both a webfont and a PDF
  sibling present. That failure mode is silent and severe — an unmatched
  `cssFamily` makes the browser substitute a system font, so text paints at
  advances the engine never measured and every caret position is wrong while it
  still looks like text. Both directions were negative-tested.
- [USER] Every editor host gets the right-click menu. It was gated on
  `structureEditing`, so the cover letter had no menu at all — only the browser's
  native one. That flag now gates only the structural group; clipboard, emphasis,
  clear-formatting, link, and history commands are always present.
- [CODE] The toolbar and the right-click menu now drive one command surface and
  read enabled state from one `InlineFormatState`. The menu had its own
  single-field-only implementations, so it silently kept the pre-cross-field
  behaviour: on a multi-paragraph selection its Cut, Copy, Bold, and link items
  were all disabled. Verified in-browser: a cross-paragraph Cut from the menu
  merged the two paragraphs correctly and undid in one step.
- [USER] Hovering a link shows a card with the destination plus open, copy, edit,
  and remove. Acting on it selects that link's run first and then runs the
  ordinary command, so there is no second link path. Remove works on an
  auto-detected bare URL too — it marks the run `<nolink>`, keeping the text and
  dropping the link.
- [CODE] The font menu is sized to its content. At the toolbar's width the fixed
  128px menu collapsed the name column to nothing, so a row read only
  "Times New Roman" with no font name, and "Source Serif 4" truncated.
- [TOOL] CareerOneStop, MIT CAPD, and Harvard FAS guidance was reviewed for
  concise, specific, active, evidence-based application writing that preserves
  the candidate's own voice. The durable links and resulting prompt policy are
  recorded in `apps/role-fit-ai/docs/engineering/ai-server.md`.
