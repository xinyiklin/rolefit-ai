# Delivery Plan — Application stage menu groups

Owner: Delivery Lead · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `tracker-stage-menu-groups-20260904` |
| Version | v1 |
| Status | approved |
| Date | 2026-09-04 |
| Implements Product Brief | `tracker-stage-menu-groups-20260904` v2 (approved 2026-09-04) |
| Supersedes | — |

> Approving this exact version means: *this version and its technical approach,
> phases, tradeoffs, risk treatment, and verification strategy are approved for
> execution.* It authorizes implementation within this scope only.

## Repository State Inspected

| Field | Value |
| :--- | :--- |
| Repository | `/Users/kevinmacbook/Desktop/2026 Job Prep/Projects/role-fit-ai` |
| Branch | `main` |
| Commit | `2b567a0a67a27e23fbf5b78d865ee551f35b1f14` |

## Current-State Findings

- `src/sections/tabs/TrackerTab.tsx` builds the row menu from the current
  status’s forward-only options under one `Move to stage` heading.
- `src/lib/applicationStatusTransitions.ts` is the shared transition policy:
  it prevents active-to-Skipped and every inactive-to-active move.
- `src/hooks/useApplications.ts` and
  `server/applications/reconcile.ts` both enforce that policy before saving.
- `src/lib/applicationDisplay.ts` already owns the Active group
  (Applied/Interviewing/Offer) and Inactive group
  (Skipped/Rejected/Withdrawn) used by tracker filtering.
- `not_applying` presently means a job-only record. The sanitizer omits its
  artifacts and application date; the modal’s save path invokes
  `withoutSubmittedApplicationArtifacts`; document controls and application
  analytics treat every Skipped record as never submitted.
- Current evaluators explicitly assert those forward-only and job-only rules:
  `src/lib/__evals__/application-status-transitions.mjs`,
  `server/applications/__evals__/sanitize-applications.mjs`,
  `src/lib/__evals__/application-analytics-eval.mjs`, and
  `src/sections/__evals__/saved-application-surface.mjs`.

## Proposed Technical Design

Make application-stage transitions reversible while distinguishing a never-applied
Skipped job from a formerly applied record currently marked Skipped:

1. Keep the existing status vocabulary and `ACTIVITY_STATUS_GROUPS` as the
   single grouping source. Add a tracker-menu-specific grouped option helper
   rather than duplicating lists in the component.
2. Relax the shared transition validator to allow every canonical stage change;
   retain client and server validation so malformed statuses, stale revisions,
   and concurrent writes still fail closed.
3. Make the status mutation non-destructive. Entering Skipped sets its decision
   date but preserves an existing `appliedAt`, document artifacts, attachments,
   and application fields. Leaving Skipped clears its decision-only metadata;
   moving a never-applied record to any active stage assigns an application
   date. It does not create documents or submit anything externally.
4. Treat `status === "not_applying" && !appliedAt` as the job-only condition.
   Preserve that flow’s document-write restrictions, while allowing an already
   stored artifact on a formerly applied Skipped record to remain visible and
   downloadable. Do not introduce a new stored field or migration.
5. Preserve historical submission evidence in calendar/analytics whenever an
   `appliedAt` exists, including a formerly applied record now marked Skipped.
6. Render two menu sections—Active and Inactive—from the shared grouping. Show
   the current stage checked and disabled. Extend the reusable menu primitive’s
   disabled/focus handling so Arrow navigation never targets a disabled item.

Rejected alternative: changing every existing detail-form stage selector to a
fully reversible control. The brief names the tracker row context menu; keeping
the detail form’s current scoped selector avoids unrequested workflow expansion
while the shared persistence layer safely accepts the context-menu updates.

## Acceptance-Criteria Mapping

| # | Acceptance criterion | Implementation | Verification |
| :--- | :--- | :--- |
| 1 | Labelled Active/Inactive menu groups | Grouped helper + TrackerTab headers | Focused source/evaluator assertions; browser check if approved |
| 2 | Active → any Inactive, preserve data | Reversible policy, non-destructive status mutation, sanitizer | Transition and sanitizer regressions |
| 3 | Inactive → any Active, same record/date | Status mutation assigns missing `appliedAt`; reconciler accepts it | Transition, persistence, and application-display regressions |
| 4 | Current stage visible and no-op unavailable | Menu-item `disabled` support and check indicator | Focused menu source assertion; browser keyboard check if approved |
| 5 | Persistence and tracker consistency | Client/server shared policy; job-only distinction; analytics/calendar updates | Sanitizer, display, analytics, and full RoleFit gate |
| 6 | Keyboard/focus behavior | Disabled-item-safe menu keyboard traversal | Focused source assertion; browser keyboard check if approved |
| 7 | Skip flow stays job-only; formerly applied history viewable | Modal/sanitizer/document-tab split based on prior `appliedAt` | Document, saved-surface, and persistence regressions |

## Affected Components And Data Flows

- `src/lib/applicationStatusTransitions.ts` — canonical status transition policy.
- `src/lib/applicationDisplay.ts` — shared Active/Inactive menu grouping and
  the formerly-applied-Skipped predicate.
- `src/hooks/useApplications.ts` — optimistic status mutation and queued local
  persistence.
- `server/applications/reconcile.ts` and `server/applications/schema.ts` —
  authoritative validation and artifact/date preservation.
- `src/sections/tabs/TrackerTab.tsx` and
  `src/sections/tracker/TrackerRowMenu.tsx` — grouped, disabled current-stage
  context menu and keyboard traversal.
- `src/sections/ApplicationModal.tsx`,
  `src/sections/application/ApplicationDocumentsTab.tsx`, and
  `src/lib/applicationDocuments.ts` — preserve/view historical documents without
  allowing a never-applied job-only record to become a document-write target.
- `src/lib/applicationAnalytics.ts` and
  `src/sections/tracker/TrackerCalendarView.tsx` — retain a historical
  submission event when its application date exists.

## Schema, Serialization, API, Persistence, Migration

- No schema version, new field, API endpoint, or migration.
- Existing job-only Skipped records have no `appliedAt` and remain job-only.
- A formerly applied record marked Skipped retains its already-valid
  `appliedAt` and artifacts. The sanitizer will preserve them instead of
  stripping them solely because the current status is Skipped.
- Existing concurrent-write revisions, strict status validation, and document
  route restrictions remain in place.

## UI And Interaction Changes

- The existing `Move to stage` menu becomes two labelled groups: Active and
  Inactive.
- Each group renders its stable status order with its dot and label. The current
  stage retains the checkmark but is disabled.
- The menu’s first enabled action receives opening focus, and Arrow navigation
  skips disabled stage items; Escape/outside-click focus restoration remains
  unchanged.
- No new modal, button, dependency, or visual language is introduced.

## Compatibility Behavior

- Older workspace records without an application date remain unchanged.
- A pre-existing Skipped job is not silently turned into an application.
- A stale client remains subject to the server’s canonical-status and
  revision-conflict checks. The server permits the new valid stage transitions
  only after the new code is running.

## Implementation Phases

1. **Domain policy and persistence** — implement reversible canonical-status
   validation, non-destructive status mutation, and the formerly-applied
   Skipped sanitizer distinction; add deterministic transition/persistence
   coverage.
2. **Tracker menu** — render the shared Active/Inactive groups and harden the
   disabled-item keyboard contract; add focused menu assertions.
3. **Historical record surfaces** — preserve former submissions/documents in
   modal/document/analytics/calendar consumers; update their focused tests.
4. **Review and verification** — inspect each phase diff, run focused checks,
   run the final RoleFit gate, detector, and independent review.

## Proposed Specialist Assignments

None; implemented directly. The persistence, shared status policy, and UI must
move together, so splitting ownership would create unnecessary coordination risk.

## Testing And Verification

- Focused deterministic regressions for transition legality/menu grouping,
  status mutation, sanitization/reconciliation, document job-only behavior,
  display/analytics/calendar behavior, and saved-application source contracts.
- `fnm exec --using 24.18.0 npm run check --workspace apps/role-fit-ai` as the
  final application gate, including production/landing/desktop builds and
  offline evaluations.
- `node /Users/kevinmacbook/.agents/skills/impeccable/scripts/detect.mjs --json`
  over the changed UI targets after implementation.
- Delivery Lead complete-diff review before an independent Verifier reviews the
  exact result and evidence. One independent review is mandatory and has not
  been waived.
- Browser QA is not started automatically. The changed menu has layout and
  keyboard/focus risk; the user must choose whether to authorize a focused
  browser pass. Recommendation: run it after automated checks.

## Risks

| Risk | Kind | Treatment |
| :--- | :--- | :--- |
| Status change erases documents or application date | data loss | Preserve fields in mutation and sanitizer; test both former-application and job-only Skipped records |
| Client and server disagree on legal stage changes | regression | Keep one shared transition helper imported by both; test server reconciliation |
| Current checked menu action is keyboard-reachable | accessibility | Add disabled semantics and skip disabled buttons in Arrow navigation |
| Historical submissions disappear from reporting | regression | Base analytics/calendar submission evidence on `appliedAt`, not current status |
| Scope expands into a second stage editor | scope | Restrict UI work to the row context menu; leave detail-form options unchanged |

## Rollout And Rollback

Not applicable; local-first application change. Rollback restores the prior
transition policy, while records written with preserved dates/artifacts remain
valid under the existing schema.

## Decisions Requiring The User

- Whether to run the focused browser visual and keyboard pass after automated
  verification. Recommended: run it, because the context-menu grouping and
  focus path change.

## Explicitly Deferred

- Bulk stage changes.
- A status-history timeline or audit log.
- Reworking the Application Detail stage selector.
- New document creation or document upload while a record is currently Skipped.
