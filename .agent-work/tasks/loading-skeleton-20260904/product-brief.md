# Product Brief — Loading placeholders for Applications and Analytics

Owner: Product Partner · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `loading-skeleton-20260904` |
| Version | v1 |
| Status | approved |
| Date | 2026-09-04 |
| Supersedes | — |

Approving this exact version means it accurately describes the problem, workflow, requirements, constraints, non-goals, and acceptance criteria. It approves no technical design.

## Problem

When opening Applications, the user wants a visible placeholder instead of an apparently empty page while content loads. The current Applications and Analytics page-loading fallbacks are text-only; Applications also waits for saved application data.

## Desired Outcome

Applications and Analytics feel visibly in progress during genuine initial loading, with placeholders that suggest the upcoming page structure and resolve to actual content, an honest empty state, or the existing failure state.

## Primary Workflow

1. Open RoleFit and select Applications or Analytics before that page or its initial saved-application data is ready.
2. See a restrained animated placeholder in the page area while the masthead and navigation remain available.
3. See the actual selected view as soon as it becomes ready, including its genuine empty or failure state when applicable.
4. Refresh an already populated view without replacing its visible records or analytics with a full-page placeholder.

## Required Behavior

- Cover initial page loading and initial saved-application data loading on Applications and Analytics.
- Applications placeholders resemble its current working surface: controls and a register/calendar area with its supporting inspector where applicable. Analytics placeholders resemble its figures and reporting layout.
- Use a subtle animated pulse only while content is genuinely pending. Honor reduced-motion preferences with a static placeholder.
- Distinguish loading from a workspace with no applications, a search with no matches, and a load failure.
- Keep existing loaded content available during refresh and remove initial placeholders promptly when loading settles; add no artificial wait.
- Provide an accessible loading status without announcing every decorative placeholder or creating focusable fake controls.

## Constraints

- Stay within RoleFit's existing paper tones, tokens, restrained visual hierarchy, themes, and responsive layout.
- The user's animation request permits a state-driven loading pulse; retain the existing prohibition on fake loading, shimmer, and decorative motion. Update owning design guidance to make this distinction explicit.
- Preserve local-only data handling, existing data ownership, and persistence behavior.

## Existing Behavior To Preserve

- Navigation and its keyboard behavior; selected tracker view, search, lifecycle filters, pagination, and record selection.
- Existing application actions, refresh feedback, error messages, and recovery actions.
- Actual empty-state guidance and Analytics results once data loading finishes.
- The real blank resume editor and existing AI-operation progress indicators.

## Non-Goals

- A blanket loading overlay on every interaction or every RoleFit page.
- Typeset, the companion, landing page, editor loading, dialogs, document previews, and AI workflow progress redesign.
- New analytics, tracker layout redesign, data fetching optimization, or changes to storage, schemas, providers, and dependencies.

## Acceptance Criteria

1. With Applications page loading delayed, selecting Applications displays a structured placeholder in its content area instead of only a loading sentence or an empty area; the masthead and navigation stay visible.
2. With initial saved-application data delayed after Applications becomes available, its placeholder remains until the load settles; it does not claim there are no saved applications during that wait.
3. Analytics shows a structured placeholder during initial page or saved-application data loading, without displaying misleading empty or zero-data results before that load settles.
4. When initial loading succeeds, fails, or returns no records, the placeholder disappears and the corresponding real content, existing failure feedback, or genuine empty state is visible. No minimum display duration delays ready content.
5. Refreshing a populated Applications or Analytics view keeps its existing content visible and preserves its current selection and controls while the refresh is pending.
6. Placeholders animate subtly during pending loading, remain static with reduced motion enabled, and fit the existing light/dark themes and supported narrow layouts without introducing horizontal overflow.
7. Assistive technology receives a meaningful loading status; decorative placeholder shapes are not separately announced or keyboard-focusable, and navigation remains usable during loading.

## Examples And Edge Cases

- Slow initial data response: placeholders continue after the page itself becomes available.
- Empty workspace: placeholders resolve to the real empty state, never permanent animation.
- Request failure: existing error feedback becomes visible after pending loading ends.
- Warm navigation or fast response: content appears immediately when ready, with no forced animation period.
- Refresh with existing records: retain the visible records and existing refresh feedback.
- Switch away while loading: navigation works normally and the selected destination owns the visible page.

## Approved Assumptions

- The user explicitly delegates the choice of Applications-only versus wider loading coverage — source: current user request. This brief recommends Applications plus Analytics, the two existing page-level loading surfaces; exact scope awaits approval of v1.

## Open User Decisions

- None. The user approved this exact v1 with “approve” on 2026-09-04, following its presentation. Delivery Plan approval remains separate.
