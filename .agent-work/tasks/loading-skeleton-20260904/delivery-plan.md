# Delivery Plan — Applications and Analytics loading skeletons

Owner: Delivery Lead · Workflow: product-delivery 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | loading-skeleton-20260904 |
| Version | v1 |
| Status | approved |
| Date | 2026-09-04 |
| Implements Product Brief | loading-skeleton-20260904 v1, approved 2026-09-04 |
| Repository | /Users/kevinmacbook/Desktop/2026 Job Prep/Projects/role-fit-ai |
| Branch | main |
| Inspected commit | 04d73e2e3b2a73ec53e3987ab8dd92c8a659cb4b |

Approving this exact version authorizes its technical approach, phases, tradeoffs, risk treatment, and verification strategy for implementation within the approved brief.

## Current state

- `src/App.tsx:187` owns the existing lazy imports and preloading for TrackerTab and AnalyticsTab. Their Suspense fallbacks at lines 3141 and 3192 contain only loading text.
- `src/hooks/useApplications.ts:244` owns records and initial readiness. `isLoading` starts true and settles in the initial request's finally block; `hasLoadedApplications` distinguishes an authoritative snapshot from failure. Refresh has a separate in-flight owner and must not become initial loading.
- `src/sections/tabs/TrackerTab.tsx:595` displays a loading paragraph alongside the ordinary controls/table/calendar. Empty records can therefore produce premature empty-state content. Refresh feedback and errors already belong to this component.
- `src/sections/tabs/AnalyticsTab.tsx:18` immediately derives totals from the applications array and currently receives no loading/error state. Before the first snapshot, it displays zero totals and empty guidance.
- `src/styles/application-pages.css` owns the page frame, toolbar, tracker/table/inspector, figures strip, reporting grid, and responsive breakpoints. `src/styles/index.css` imports it. Existing tokens and layouts remain the visual authority.
- Existing offline probes include application analytics and tracker inspector/layout checks. `offline-evals.test.mjs` discovers owner probes automatically. These checks are not evidence of real browser behavior.
- The initial worktree had no application changes; only this task's local artifacts were untracked.

## Technical design and data flow

1. Add an eagerly imported RoleFit section module, `src/sections/PageLoadingSkeleton.tsx`, with explicit Applications and Analytics compositions and a small private decorative shape primitive. Applications accepts the existing table/calendar view value so both initial chunk and data loading match the selected surface. Keep this module independent of the lazy page modules, application data, and shared packages.
2. Add scoped `src/styles/page-loading.css`, imported next to application-pages styles. Reuse the current workspace frame and structural layout classes where safe. Shapes use neutral theme tokens, restrained opacity pulse, no shimmer, no width/height animation, and no animation delay on ready content. Reduced-motion disables the animation. Decorative shapes are aria-hidden and cannot receive focus; one meaningful loading status remains outside the aria-busy decorative region.
3. In App, use those compositions as the two Suspense fallbacks and during the genuine initial data wait (`isApplicationsLoading` with no available records). Retain the existing lazy import/preload mechanism. Keep all navigation and masthead controls outside these boundaries. Do not change the loading hook or introduce another readiness state machine.
4. Preserve already available records during any refresh or concurrent update. Once initial loading settles, render the existing tracker, including its empty/error handling. Remove its superseded initial-loading paragraph/prop if no longer used. Gate Analytics before deriving a zero-data display during pending initial loading. For a settled initial failure without an authoritative snapshot, show the existing application-load error in the established alert style and an action to open Applications for its existing refresh recovery. With an authoritative snapshot, keep analytics visible even if a later operation fails.
5. Preserve filters, selected view, and record selection in their current owners. Do not introduce loading timers, fake row data, storage writes, or a global loading framework. An app-wide overlay was rejected because only these two page boundaries need this behavior and the existing shell must remain usable.

## Acceptance criteria mapping

| Brief criterion | Implementation | Verification |
| :--- | :--- | :--- |
| 1: Applications chunk load | Eager Applications skeleton as Suspense fallback; shell unchanged | Review boundary wiring; delayed-chunk browser scenario if authorized |
| 2: Applications initial data load | App uses the same skeleton while initial data is pending and records unavailable | Pending/settled branch check; delayed-data browser scenario if authorized |
| 3: Analytics pending state | Analytics skeleton covers its chunk and initial data boundary | Review that pending renders no derived totals; delayed-data scenario if authorized |
| 4: Success, empty, failure settle | No timer; tracker resumes existing error/empty handling; Analytics failure provides existing recovery destination | Check success, empty, initial failure, and retry cases; browser exercise if authorized |
| 5: Populated refresh | Initial-only condition excludes available records; existing refresh owner unchanged | Review refresh/concurrent-write paths; populated-refresh browser scenario if authorized |
| 6: Motion, themes, narrow layout | Scoped opacity animation, neutral tokens, reduced-motion override, responsive table/calendar/report structures | Build/style inspection; desktop/narrow, light/dark, reduced-motion browser check if authorized |
| 7: Accessibility | One status, hidden decorative shapes, no fake controls, persistent navigation | Inspect rendered markup semantics; keyboard/navigation browser exercise if authorized |

## Effects and compatibility

Affected owners are App, the new loading section/styles, and the narrow TrackerTab/Analytics error-presentation seams as needed. Data continues to flow from useApplications through App. No schema, serialization, API, persistence, migration, dependency, provider, version, shared engine/editor, Typeset, or deployment changes.

## Implementation phases

1. Build both skeleton compositions and scoped motion/responsive CSS. Review the stage diff for layout reuse, accessibility, and scope.
2. Wire chunk/data boundaries and settled-failure behavior. Review initial pending, populated refresh, empty, failure, and retry paths together.
3. Clarify the real-loading pulse exception in RoleFit DESIGN.md; add the loading behavior to its product contract and a bounded root continuity receipt referencing this task. Run checks, inspect the complete diff, record implementation evidence, and obtain independent verification.

## Verification and assignments

- Delivery Lead implements directly. Product Partner owns the alignment review. One fresh Verifier inspects the complete change after self-verification; a second is not indicated for this app-local presentation change unless findings reveal wider risk.
- Use pinned Node 24.18.0. Run `fnm exec --using 24.18.0 npm run check --workspace apps/role-fit-ai` from the root for browser/server/landing builds, desktop checks, and offline probes. Run `git diff --check` and inspect the complete diff. Report blocked checks honestly; do not alter product behavior to accommodate sandbox failures.
- Add a focused regression probe only if it meaningfully exercises pending/settled behavior with the existing harness; avoid tests that merely copy markup or CSS implementation. Existing analytics and tracker probes continue to guard their owners.
- Browser QA has material value here: placeholder sizing, transition to content, reduced motion, and narrow layouts are visible risks. Under the repository's flag-first policy it is optional and requires the user's opt-in. Recommend one bounded pass using synthetic data and delayed responses, with one correction/confirmation pass if needed. Reuse a running canonical app where suitable; do not start a server before authorization. If not authorized, record browser criteria as unverified, never passed from source inspection.
- Load the React best-practices and craft-floor guidance before implementation, and verification-before-completion before claiming success. No tests or browser checks have been run during planning.

## Risks and treatment

| Risk | Treatment |
| :--- | :--- |
| Endless loading after failure | Use finite initial pending state, not absence of records or hasLoaded alone |
| Misleading zero totals after initial failure | Surface load error and Applications recovery destination |
| Content/selection lost during refresh | Keep populated content mounted; leave data/refresh ownership unchanged |
| Skeleton delays its own fallback | Keep eager module free of lazy page imports |
| Layout shift, theme contrast, excess motion | Reuse layout/tokens, stop at readiness, reduced-motion override; flag browser verification |
| Private data in QA artifacts | Synthetic fixtures only; no workspace/provider contents in reports |

## Rollout and rollback

Local working-tree change only. No commit, push, or release is authorized. Rollback removes this task's explicit source/style changes while preserving unrelated work and user data.

## User decisions and deferred work

- User approved this exact Delivery Plan v1 with “approve” on 2026-09-04 following its presentation.
- Browser QA was not opted into and remains explicitly unverified.
- Deferred per the brief: other pages, dialogs, previews, editors, AI progress, Typeset, companion, landing page, fetch optimization, and tracker redesign.
