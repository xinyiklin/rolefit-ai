# Product Brief — Application stage menu groups

Owner: Product Partner · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `tracker-stage-menu-groups-20260904` |
| Version | v1 |
| Status | superseded |
| Date | 2026-09-04 |
| Supersedes | — |

> This v1 brief is superseded by Product Brief v2 after CR001 Option B. Its prior
> approval no longer authorizes implementation. Approving an exact version means: *this version accurately describes the
> problem, intended workflow, requirements, constraints, non-goals, and
> acceptance criteria.* It approves no technical design.

## Problem

In the Applications page’s row context menu, a user cannot move an application
between Active and Inactive stages in both directions, and the available stages
are not organized by that lifecycle distinction. This makes status updates
harder to scan and prevents reconsidering an inactive record.

## Desired Outcome

The application row context menu lets users change an application to a stage in
either lifecycle group and presents the choices under clear Active and Inactive
headings.

## Primary Workflow

1. A user opens the context menu for an application on the Applications page.
2. They see its available stage choices organized into Active and Inactive
   groups.
3. They choose a stage in the other group, such as moving an active record to
   an inactive stage or reactivating an inactive record.
4. The application updates to the chosen stage and remains correctly presented
   in the tracker.

## Required Behavior

- The row context menu groups stage choices into labelled Active and Inactive
  sections.
- Users can move a record from an active stage to an inactive stage.
- Users can move a record from an inactive stage to an active stage.
- The current stage is recognisable and cannot be selected as a no-op.
- A completed stage change updates the tracker’s visible status and lifecycle
  placement without requiring a page reload.

## Constraints

- Preserve application data integrity, including the existing rules for stage
  dates, saved documents, and job-only records.
- Keep the existing local-first persistence and privacy posture.
- Preserve accessible context-menu behavior: keyboard operation, focus handling,
  and a non-colour indication of stage state.
- Do not add a dependency or change the portable document formats.

## Existing Behavior To Preserve

- The context menu continues to expose its existing non-stage actions.
- Existing tracker filters, search, inspector, detail view, and calendar remain
  consistent with the application’s selected stage.
- The menu does not create a second application record or silently alter its
  saved job/documents.

## Non-Goals

- Adding, removing, renaming, or reordering tracker stages.
- Bulk changes to multiple applications.
- Editing application details or documents from the context menu.
- Changing AI stages, AI provider settings, or any AI workflow.

## Acceptance Criteria

1. The Applications page row context menu visibly divides selectable stages into
   labelled Active and Inactive groups.
2. From an active stage, a user can select an inactive stage and the tracker
   reflects the new stage immediately.
3. From an inactive stage, a user can select an active stage and the tracker
   reflects the new stage immediately.
4. The current stage is clearly identified and unavailable as a redundant
   selection.
5. A stage change remains correct after the record is read again from local
   workspace storage, and tracker surfaces remain consistent with it.
6. The menu continues to work with keyboard and preserves focus behavior after a
   selection or dismissal.

## Examples And Edge Cases

- An Active record can be moved to Rejected, Withdrawn, or the existing
  job-only inactive stage where that is allowed by the application contract.
- An Inactive record can be reactivated to an Active stage without creating a
  duplicate record.
- When all selectable alternatives fall in one group, the empty group remains
  understandable rather than producing a confusing blank menu.
- A failed local save leaves the current stage visible and reports the existing
  recoverable failure state.

## Approved Assumptions

- “Context menu” means the per-row action menu on the Applications tracker page
  — source: user clarification.
- “Stages” means tracker application-status stages, not Settings > AI stages
  — source: user clarification.
- Both cross-lifecycle directions are intended for the stages the existing
  application data contract safely permits — source: user wording; the exact
  persistence implications require repository investigation.

## Open User Decisions

- None.
