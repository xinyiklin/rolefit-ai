# RoleFit AI Agent Guide

Applies to `apps/role-fit-ai/`. Follow the repository root `AGENTS.md` first.
RoleFit AI is the local-first resume-tailoring host over shared
`@typeset/engine` and `@typeset/editor` packages. It adds a loopback Node
server, AI workflow, local workspace/tracker, and browser extension; it does not
own a second resume model, editor, layout engine, or PDF implementation.

## Guidance map

- `README.md` — product setup, providers, extension, workspace, and app layout.
- `PRODUCT.md` — RoleFit behavior, workflow, and trust contract; its
  `#fit-assessment-user-contract` section owns verdict and eligibility behavior.
- `DESIGN.md` — Drafting Desk visual system, assessment-layer separation, and
  host/shared styling boundary.
- `docs/engineering/ui-principles.md` — host UI and responsive behavior.
- `docs/engineering/ai-server.md` — broad AI/server request and trust boundaries.
- `server/ai/README.md` — canonical Fit Assessment prompt, grounding, request,
  response, provider, and provenance behavior.
- `docs/engineering/testing.md` — RoleFit-focused verification.
- `docs/engineering/desktop-architecture-plan.md` — companion trust boundary,
  local settings, provider registry, and lifecycle phases.
- `docs/engineering/distribution-cloud-plan.md` — native artifact matrix,
  signing/release contract, and deferred hosted work.
- root `docs/{architecture,development,git-workflow}.md` — monorepo ownership,
  commands, and repository workflow.
- `src/AGENTS.md` — client orchestration and shared-package integration.
- `src/hooks/AGENTS.md` — cohesive workflow/state hooks.
- `src/sections/AGENTS.md` — RoleFit UI composition and reusable host controls.
- `server/AGENTS.md` — local server, workspace, job preparation, applications, and
  extension route boundaries.
- `server/ai/AGENTS.md` — provider, prompt, sanitizer, review, and eval rules.
- `extension/AGENTS.md` — MV3 popup and local bridge contract.
- root/package guides — shared engine/editor behavior. Read those before
  changing a package or shared control.

## Product and safety invariants

- Resume/job data and provider credentials are sensitive. Never print or log
  raw resumes, job descriptions, prompts, provider bodies, API keys, or broad
  environments without explicit local-debug authorization.
- Managed API keys are write-only from the companion renderer, encrypted with
  Electron `safeStorage`, persisted only as encrypted bytes beneath Electron
  `userData`, and delivered only in memory to a companion-owned server. Never
  put them in browser storage, HTTP, argv, environment variables, status
  responses, or logs. `.env` remains an explicit standalone/headless fallback.
- The browser lists only providers explicitly added through the companion.
  Configured-but-unready providers remain visible with reconnect guidance; a
  missing provider must never trigger a silent fallback to a paid provider.
- Provider readiness must not overclaim authentication. Antigravity 1.1.x has
  no non-interactive auth-status command, so an installed/configured manual
  provider may be request-eligible as ready-to-verify while `authState` remains
  unknown; the first actual provider request verifies the session or fails with
  recovery guidance.
- Never invent employers, dates, metrics, education, tools, experience, or
  outcomes. Missing facts become gaps or bracketed prompts for human evidence.
- Fit Assessment changes must preserve the user contract in `PRODUCT.md`, the
  technical contract in `server/ai/README.md`, and the executable
  `FIT_ASSESSMENT_RULES` in `server/ai/fitAssessment.ts`. Do not add numeric scoring,
  hidden requirement bookkeeping, a server-derived fallback verdict, tracker
  priority inference, or a second assessment path.
- Normal Resume Polish is one proposal request, never Tailor followed by Review.
  It uses flat server-owned target IDs and returns Proposal, No changes, or
  Withheld. Mutation fields validate strictly; malformed optional feedback is
  dropped locally without invalidating safe edits. Identity, contact,
  education, standard-entry role/employer/subtitle/date fields, and omitted
  sections and Skills category labels stay locked; only bullets and actual
  Skills lists are proposal targets. The live resume
  changes only through explicit Accept all, Accept, or edited acceptance, and
  Undo on a settled row restores exactly the text that row replaced. Skill
  list category substitutions and job-only skill insertions fail independently.
  When all editable targets do
  not fit the prompt budget, material and job-relevant targets win without
  prefix-order bias; only sent targets may be changed, and the rail states the
  omitted count quietly.
- **Polish is one provider request per document proposal.** Both documents use
  the shared Ready to Polish, Polishing and validating, Proposal ready, and
  Reviewing proposal vocabulary. Before returning its JSON proposal, the model
  silently audits evidence, claims, identifiers, and output shape. The selected
  reasoning effort controls provider reasoning and the breadth of that internal
  audit; no audit notes are exposed as a separate workflow.
- Prepare publishes its deterministic local brief before provider work. A Job
  analysis or Fit Assessment failure leaves that brief editable and manual Polish
  available; invalid Fit Assessment output never invalidates valid Job analysis.
  Fit Assessment owns an independent provider/model/reasoning configuration;
  Prepare may combine it with Job analysis only when both resolved request
  configurations match exactly, otherwise it dispatches assessment-only after
  committing the brief.
  Resume Polish failure or Withheld leaves the document unchanged.
- URL and paste preparation remain enabled without a ready Job analysis
  provider. They commit the deterministic brief and explain that connecting a
  provider can improve it; Fit Assessment remains unavailable when its own
  provider cannot run, and Polish retains its existing provider gate.
- Duplicate checks gate the pipeline before and after Job analysis. Stop means no
  downstream request; Continue is acknowledged for that job target.
- Keep the server loopback-only by default. `HOST=0.0.0.0` exposes an
  unauthenticated local tool to the LAN and is never acceptable on an untrusted
  or public network.
- Keep personal artifacts inside the host-supplied runtime workspace. Source
  development uses ignored `workspace/`, with resume variants in `resumes/`
  and cover-letter variants in `cover-letters/`; never commit its contents
  except the instructional README. Packaged runs use
  `app.getPath("userData")/workspace/` outside the application bundle.

## App ownership

RoleFit owns:

- `server.ts` and `server/`: local HTTP/Vite composition, provider calls, safe
  job preparation, workspace/application persistence, and extension routes;
- `src/hooks/`: RoleFit workflow state and effects;
- `src/sections/`: Apply-only masthead, read-only Sessions/Settings studio-rail
  utilities, first/default Prepare intake, studio navigation and tabs, tracker,
  materials, proposal rails, reusable AI workflow progress,
  dialogs, and host
  composition;
- `src/sections/editor/RoleFitEditorOverlay.tsx`: the section-scope and review
  overlay injected into the shared editor;
- `src/lib/` and `src/resume/`: RoleFit-only job, workflow, evidence, and
  deterministic mechanical analysis helpers;
- `extension/`: a vanilla MV3 client of the local extension API.
- `desktop/`: the compact five-provider manager, encrypted API-key vault,
  provider-owned CLI setup, private owned-server credential bridge, and local
  server lifecycle. It never owns the Drafting Desk or personal workspace.
- `landing/`: the isolated static product/download site. It may read public
  GitHub release metadata but never bundles the Drafting Desk, calls loopback,
  detects an installation, or receives local data.

RoleFit consumes, but does not fork:

- `@typeset/engine`: canonical resume model, constrained cover-letter adapter,
  strict `.resume`/`.cover` codecs, layout, fonts, DOM/print, and PDF;
- `@typeset/editor`: document/history/style hooks, direct editor, toolbars,
  popovers, and shared editor styles.

If behavior belongs to both apps, evaluate the package contract using root
`docs/architecture.md`. If it carries RoleFit provider, tracker, job, review,
or workspace state, keep it here and expose the smallest host seam instead.

## Maintainability and reuse

- Keep `App.tsx` as composition. New workflow state belongs in a focused hook;
  deterministic transforms belong in `src/lib/` or `src/resume/`; reusable
  presentation belongs in a focused section component.
- One hook owns one cohesive async/state lifecycle. Do not split ownership of
  the same progress, abort, retry, or persistence state between App and a hook.
- Prepare is the sole job-intake surface. Extension progress/delivery must
  select it before updating visible intake state; URL and pasted-text fallbacks
  remain there, never in masthead chrome or a second menu. Keep its complete
  brief editable: tracked job facts through one role context, responsibilities,
  required and preferred qualifications, technical keywords, seniority and
  domain signals, benefits, plus deterministic extraction gaps.
- Prepare is state-shaped: before preparation, one centered Source panel exposes
  one URL-or-paste method at a time and no empty downstream scaffolds; afterward,
  the editable brief leads beside one Application rail containing both material
  choices, readiness, the saved-application summary, and Apply.
- Resume and Cover Letter use one material-card contract on Prepare: Include
  toggle, variant selector, readiness, and document-specific actions. Resume
  defaults included and Cover Letter defaults excluded; starting Polish for a
  document, manually or through its enabled automatic proposal, turns on only
  that document's Include toggle. Do not label either card optional.
- Masthead and Prepare Apply controls share one handler and readiness model.
  Require the current prepared job and readiness only for included materials,
  while allowing either or both to be excluded. Re-Apply must not delete or
  replace a previously saved artifact whose card is excluded.
- The Apply download prompt covers every included, exportable material, not the
  resume alone. Resume and cover letter stay two separate PDFs — ATS uploads are
  per-document and a merged file breaks resume parsing. Each document owns one
  row carrying its own checkbox and its own editable name; the letter's name is
  seeded from the resume's through `swapDocumentTitleKind`, so the pair matches
  by default and never stacks a second kind suffix, and stays independently
  editable. Downloads run sequentially. A failed export never undoes the applied
  state or the other download; because Apply has already navigated away from
  each editor's status surface, the export helpers report success back and the
  Apply status names which PDF failed. Apply is synchronously single-flight from
  duplicate resolution through a direct commit and again through every selected
  post-commit export; the pre-commit naming prompt remains interactive.
- Extension intake requests AI-backed Job analysis and stops on Prepare. Its
  local brief remains usable when that request fails, and it never implicitly
  launches Polish.
- **Which resume a preparation speaks for has exactly ONE owner**
  (`usePreparedResume` over the pure rules in `lib/preparedResume.ts`). It runs
  once per preparation, after the deterministic local job analysis and before
  the combined provider request, and it is the sole source for Fit Assessment, the
  editor's loaded document, Prepare's recommendation note, and automatic
  proposals. Do not add a second selector: a pre-fit picker plus a post-Prepare
  ranking effect is what made Fit Assessment describe one resume while the editor
  held another. Its terminal states are: a real current document is
  authoritative; exactly one saved variant is adopted; several variants rank and
  a meaningful unique winner is adopted; otherwise no resume resolves. Ranking
  uses the LOCAL brief (the ranker weights section headings the raw posting does
  not have) while the provider still receives the raw posting. **"The workspace
  is still loading" is never "no resume"** — resolution awaits hydration rather
  than sampling a boolean an extension import can observe mid-flight.
  Candidate reads and the ordered option metadata form one snapshot; retry once
  if that snapshot changes, then retain the current document rather than mixing
  generations. A successful adoption returns the guarded loader's committed
  document receipt, while a blocked/failed adoption clears its recommendation.
  Adoption still goes through the guarded workspace loader only while the editor
  is clean and not application-owned; an explicit manual variant choice
  synchronously preempts it; while an included variant is resolving or loading,
  preparation remains busy and Apply or another Polish action cannot start. A
  clean explicit upload is authoritative and never replaced automatically.
  Stop, source-input replacement, application restore, and component cleanup
  invalidate both the outer preparation and this resolver before adoption or
  Fit `running` can publish. Every terminal preparation path that entered Fit
  `running` must settle it to ready, unavailable, or disabled. A
  tie or incomplete comparison returns no recommendation and keeps the current
  selection. Cover letters keep their own ranking effect and the same safety
  rules. Do not add persisted variant metadata or another schema for either
  choice.
- Proposal decisions are keyed by outcome plus each target's id, original text,
  proposed text, and reason. A mismatched key derives an empty decision map
  without setting state during render; the first decision initializes the new
  key. A complete proposal payload forms its identity, so reused target ids
  cannot carry decisions into a new response.
- The document's ORIGIN (saved / uploaded / application / starter / blank) is
  explicit state. The bundled starter is sample content that passes every length
  test, so it never satisfies resume readiness, Fit Assessment, or an automatic
  proposal, and Prepare names it ("Starter template") instead of claiming there
  is no document. Saving it as a base resume is what makes it the applicant's.
- Combined Prepare and reassessment must use the same retained posting and
  exact exported rules block, while Job analysis and Fit Assessment sanitize in
  both directions. Assessment data remains in the shared Fit Assessment contract;
  Resume/Cover automation labels, ordering, and thresholds remain client-only
  in `autoPolishPolicy.ts`. Reassessment remains preparation-owned, always
  dispatches when requested, and stays available even when no resume resolved.
- Reuse `AiWorkflowProgress` for retryable AI operations and existing
  dialog/menu primitives for repeated interactions. Do not build parallel
  progress cards, modal shells, provider selectors, or status vocabularies.
- Keep host components declarative: values/callbacks in, UI out. Network,
  storage, and cross-tab effects stay in hooks or server modules.
- Keep client and server request types/conventions aligned. Validate unknown
  data at boundaries and preserve user-safe classified errors.
- Prefer small explicit interfaces over mode-heavy components. Extract only a
  stable responsibility, real duplication, a useful test seam, or volatile
  platform/provider behavior.
- Prompt wording is executable behavior. Prompt, grounding, sanitizer, or
  review-contract changes require adversarial probes and must not be treated as
  docs-only edits.

## Working method

Before editing:

1. Read root and app continuity plus the nearest scoped guide.
2. Read the affected product/design or engineering contract.
3. Trace callers, state owner, request/response shape, persistence, and shared
   package consumers.
4. Define fail/stop/retry behavior for any async workflow change.
5. Inspect the dirty tree and preserve unrelated work.

Pause before changing provider defaults, editable schema, API-key handling,
public exposure, destructive storage behavior, deploy shape, paid dependencies,
or remote writes.

## Commands and verification

Run from the repository root:

```bash
npm run dev:rolefit
npm run build:rolefit:landing
npm run build:rolefit
npm run build:rolefit:desktop
npm run make:rolefit:desktop
npm run test:rolefit:desktop:packaged
npm run check --workspace apps/role-fit-ai
npm test --workspace apps/role-fit-ai
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
```

Standalone source development defaults to canonical port 5181. The installed
product is launched through the companion, which may persist another
numeric-loopback port. The materialized extension runtime config is only the
validated first-install seed; the extension's versioned `chrome.storage.local`
record owns the current port and saved storage wins. The companion shows and
copies the active numeric port so the user can save it in the popup's Settings
view after an app port change, with no extension reload. Reuse a compatible
bound listener rather than starting a second server.

- Client/type changes: RoleFit build, plus focused evals.
- Server/AI changes: server TypeScript gate, affected route/eval, and full app
  check when the contract is shared.
- Fit Assessment prompt, grounding, sanitizer, request, or lifecycle changes:
  `fit-assessment-probes.mjs`, `fit-assessment-consistency-contracts.mjs`,
  `ai-job-analysis-request-eval.mjs`, `fit-assessment-lifecycle.mjs`,
  `job-intake-entry-points.mjs`, and the full offline suite. Run the live
  synthetic consistency matrix only when provider behavior is in scope and the
  user authorizes provider calls.
- Shared engine/editor changes: follow root impact matrix and verify both apps.
- Material UI changes: follow RoleFit's flag-first visual-QA policy and report
  whether browser QA ran.
- Docs-only changes: verify local links, paths, commands, and stale references;
  runtime builds are not required unless the audit uncovers a code mismatch.

Update root continuity for cross-workspace decisions and the app ledger only
for RoleFit-specific operational detail. Do not duplicate the same receipt.

## Git

Follow root `docs/git-workflow.md`. Work locally unless the user asks for git
actions. Never stage `.env`, generated outputs/fonts, resumes/PDFs, or private
workspace data. Stage exact paths in this frequently dirty worktree.
