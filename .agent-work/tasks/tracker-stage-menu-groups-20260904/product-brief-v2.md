# Product Brief — Application stage menu groups

Owner: Product Partner · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `tracker-stage-menu-groups-20260904` |
| Version | v2 |
| Status | approved |
| Date | 2026-09-04 |
| Supersedes | Product Brief v1 |

> Approving this exact version means: *this version accurately describes the
> problem, intended workflow, requirements, constraints, non-goals, and
> acceptance criteria.* It approves no technical design.

## Problem

The Applications page row context menu cannot move a record between Active and
Inactive stages in both directions, and it does not organize choices by that
lifecycle distinction. A user who applies and later decides to skip the role,
or who initially skips it and later decides to apply, cannot express that
change on the same tracker record.

## Desired Outcome

The application row context menu presents stages under Active and Inactive
headings and lets the user move the same record in either direction, including
to and from Skipped, without silently losing its saved application history.

## Primary Workflow

1. A user opens a record’s context menu on the Applications page.
2. The menu shows selectable stages in labelled Active and Inactive groups.
3. They select a stage in the other group, including Skipped when appropriate.
4. The tracker immediately reflects the new stage while retaining the record’s
   existing history and saved materials.
5. They may later select a stage in the opposite group on that same record.

## Required Behavior

- The row context menu groups stages as Active (Applied, Interviewing, Offer)
  and Inactive (Skipped, Rejected, Withdrawn).
- Users can move a record from any active stage to any inactive stage and from
  any inactive stage to any active stage.
- Switching an applied record to Skipped preserves its existing application
  date, saved documents, attachments, and other application history; it is an
  inactive stage, not a destructive conversion to a different record type.
- A Skipped record that has never been applied remains a job-only record; when
  it moves to Applied, it receives an application date and remains the same
  tracker record without inventing documents.
- The current stage is recognisable and unavailable as a no-op selection.
- A completed stage change updates tracker placement without a page reload.

## Constraints

- Preserve application data integrity and never silently delete saved
  documents, attachments, dates, or history because of a stage change.
- Preserve the distinct user-initiated Skip & save job flow for a never-applied,
  job-only record.
- Keep local-first persistence and privacy posture.
- Preserve accessible context-menu keyboard operation, focus handling, and
  non-colour status indications.
- No dependency or portable document-format change.

## Existing Behavior To Preserve

- The context menu continues to expose its existing non-stage actions.
- Existing tracker filters, search, inspector, detail view, calendar, and
  activity/date presentation remain consistent with the selected stage.
- Stage changes update one existing record rather than creating a duplicate.
- A job-only Skipped record continues to reject new application-document saves
  until the user changes it to an active application stage.

## Non-Goals

- Adding, removing, renaming, or reordering tracker stages.
- Bulk changes to multiple applications.
- Editing application details or documents from the context menu.
- Changing AI stages, AI provider settings, or AI workflows.

## Acceptance Criteria

1. The Applications row context menu visibly divides selectable stages into
   labelled Active and Inactive groups.
2. A user can move a record from any active stage to an inactive stage,
   including Skipped, and the tracker updates immediately without deleting the
   record’s prior application data.
3. A user can move a record from any inactive stage to an active stage and the
   tracker updates immediately without creating a duplicate record; a
   never-applied Skipped record receives an application date when moved to
   Applied.
4. The current stage is clearly identified and cannot be redundantly selected.
5. A cross-group stage change remains correct after local workspace persistence
   and all tracker surfaces continue to reflect it consistently.
6. The menu continues to work with keyboard controls and restores focus after a
   selection or dismissal.
7. The existing Skip & save job flow remains a job-only workflow, while a
   formerly applied record marked Skipped retains its application artifacts and
   remains viewable as historical material.

## Examples And Edge Cases

- A user applies, later selects Skipped, then later selects Applied on the same
  record; the prior documents and application date remain intact.
- A user skips a newly prepared job, then selects Applied from its row menu; it
  becomes an application record with an application date but no invented
  documents.
- Rejected and Withdrawn records can be reactivated without a new record.
- A group with no selectable alternatives remains understandable rather than
  producing unexplained blank space.
- A failed local save leaves the current persisted stage visible and uses the
  existing recoverable error path.

## Approved Assumptions

- “Context menu” means the per-row action menu on the Applications tracker page
  — source: user clarification.
- “Stages” means tracker application-status stages, not Settings > AI stages
  — source: user clarification.
- A stage selection is a non-destructive lifecycle update; it does not itself
  submit an application or generate documents — source: CR001 Option B decision.

## Open User Decisions

- None.
