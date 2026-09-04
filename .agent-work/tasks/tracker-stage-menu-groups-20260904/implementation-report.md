# Implementation Report — Application stage menu groups

Owner: Delivery Lead · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `tracker-stage-menu-groups-20260904` |
| Date | 2026-09-04 |
| Product Brief | v2 (approved 2026-09-04) |
| Delivery Plan | v1 (approved 2026-09-04) |
| Repository / branch | `/Users/kevinmacbook/Desktop/2026 Job Prep/Projects/role-fit-ai` / `main` |
| Commit range | `2b567a0a67a27e23fbf5b78d865ee551f35b1f14..working tree` |

## Implemented Scope

The Applications tracker row context menu now renders all canonical stages in
Active and Inactive groups. It disables the checked current stage, allows every
cross-group move, and keeps Arrow-key navigation on enabled options. A record
that has previously been applied retains its application date, document
artifacts, attachments, and submission history when later marked Skipped. A
Skipped record with no application date remains job-only until moved to an
active stage, at which point the same record gains an application date without
inventing documents.

## Significant Files And Components Changed

| Path | Change |
| :--- | :--- |
| `src/lib/applicationStatusTransitions.ts` | Allows canonical status changes in either direction. |
| `src/lib/applicationDisplay.ts` | Owns tracker menu groups and the job-only Skipped predicate. |
| `src/hooks/useApplications.ts` / `server/applications/schema.ts` | Preserves former-application fields through Skipped persistence. |
| `src/sections/tabs/TrackerTab.tsx` / `src/sections/tracker/TrackerRowMenu.tsx` | Renders grouped stage actions and excludes disabled current items from keyboard traversal. |
| `src/sections/ApplicationModal.tsx` / `src/sections/application/ApplicationDocumentsTab.tsx` | Keeps prior artifacts visible but locked while an application is Skipped. |
| `src/lib/applicationAnalytics.ts` / `src/sections/tracker/TrackerCalendarView.tsx` | Retains an existing submission event after a later skip. |
| Product/design/scoped-hook guidance and focused evaluators | Records the revised lifecycle contract and covers it. |

## Implementation Coverage By Acceptance Criterion

| # | Criterion | Implementation status | Implementer evidence |
| :--- | :--- | :--- | :--- |
| 1 | Labelled groups | implemented | `TRACKER_STAGE_MENU_GROUPS` consumed by `TrackerTab` |
| 2 | Active to Inactive | implemented | reversible validator, mutation, and sanitizer regression |
| 3 | Inactive to Active | implemented | mutation assigns missing application date; transition regression |
| 4 | Current stage unavailable | implemented | disabled checked menu item and enabled-only Arrow traversal |
| 5 | Persisted consistency | implemented | server sanitizer/reconciliation and full gate |
| 6 | Keyboard/focus behavior | implemented and browser-verified | isolated browser pass confirmed disabled-current stage and enabled-only Arrow traversal |
| 7 | Job-only vs historical Skipped material | implemented | predicate, document surface, schema, and evaluator coverage |

## Implementer Self-Verification

| Check | Command or observation | Result | Evidence |
| :--- | :--- | :--- | :--- |
| Focused lifecycle regressions | transition/display/analytics/documents/saved-surface evaluators and sanitizer probe | passed | all six commands exited 0 |
| Full RoleFit gate | `fnm exec --using 24.18.0 npm run check --workspace apps/role-fit-ai` | passed | production + landing builds, desktop checks, and 106 offline evaluations passed |
| UI mechanical check | Impeccable detector over four changed UI targets | passed | JSON result `[]` |
| Diff hygiene | `git diff --check` | passed | exit 0 |
| Browser visual/keyboard QA | isolated interactive pass | passed | synthetic application completed Applied → Skipped → Applied; grouping, disabled-current stage, Arrow traversal, and original application-date retention were observed |

## Deviations From The Approved Plan

None. CR001 Option B was incorporated into Product Brief v2 before plan approval.

## Known Limitations

- The Application Detail stage selector intentionally retains its existing
  forward-only options; the approved scope is the tracker row context menu.
- Status history remains a current-state model; a reactivated record does not
  add a separate historical timeline event.

## Explicitly Deferred

- Bulk stage changes.
- A status-history/audit-log feature.
- New document writes while an application is currently Skipped.

## Verification Handoff

| Field | Value |
| :--- | :--- |
| Independent review status | completed; supplemental browser evidence closes the keyboard/focus gap |
| Waiver reason | none |
