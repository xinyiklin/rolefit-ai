# Change Request — Application stage menu groups

Raised by: Delivery Lead · Assessed by: Product Partner · Decided by: the user · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `tracker-stage-menu-groups-20260904` |
| Change request | CR001 |
| Date | 2026-09-04 |
| Product Brief in force | v1 (approved 2026-09-04) |
| Delivery Plan in force | — |
| Trigger | user-facing behavior and destructive data-loss risk |

## Discovery

The current shared transition policy permits only forward moves:
`not_applying → not_applying`; `applied → applied/interviewing/offer/rejected/withdrawn`;
`interviewing → interviewing/offer/rejected/withdrawn`; `offer → offer/rejected/withdrawn`;
and terminal `rejected`/`withdrawn` states. It is applied by the row menu, the
browser update path, and the server reconciliation guard.

`Skipped` (`not_applying`) is not merely an inactive stage. It is a job-only
decision: its sanitizer removes application documents and its document route
rejects document saves. Moving a submitted record to Skipped through the normal
stage action would therefore either silently remove saved resume/cover/attachment
references or violate the job-only record contract. Reactivating a Skipped record
also needs a rule for `appliedAt` and its absent application-document state.

Evidence: `src/lib/applicationStatusTransitions.ts`,
`src/hooks/useApplications.ts`, `server/applications/reconcile.ts`,
`src/lib/notApplyingApplication.ts`, and `server/applications/schema.ts`.

## Affected Acceptance Criteria

| # | Criterion | Effect |
| :--- | :--- | :--- |
| 1 | Active and Inactive stage groups | Needs an explicit treatment for Skipped within Inactive. |
| 2 | Active to Inactive move | Cannot safely include Skipped without a document/data decision. |
| 3 | Inactive to Active move | Cannot safely include Skipped without a new application-date/document rule. |
| 5 | Correct persistence | The server must enforce the same resolved policy as the UI. |

## Why The Approved Approach Is Insufficient

The approved brief requires cross-lifecycle movement but does not settle whether
the special job-only Skipped decision participates. This is not a visual menu
choice: it determines whether saved application documents can be removed or a
job-only record becomes a submitted application. The existing policy rejects all
such moves precisely to avoid rewriting application history.

## Options

### Option A — Reopen terminal applications, keep Skipped job-only (recommended)

- **What it does:** Group Active as Applied, Interviewing, and Offer; group
  Inactive as Rejected and Withdrawn in the quick stage menu. Permit movement
  between those groups in either direction, while retaining Skipped as its
  existing job-only workflow rather than a quick-stage destination/source.
- **User-visible effect:** Rejected or Withdrawn applications can be reopened
  to an active application stage, and active applications can be closed as
  Rejected or Withdrawn. Skipped remains a deliberate job-only decision and
  continues to require a new application attempt when reconsidered.
- **Cost / risk:** Does not turn an existing Skipped record into an application.

### Option B — Treat Skipped as a reversible quick stage

- **What it does:** Include Skipped with Inactive and permit moves to and from
  it in the row menu.
- **User-visible effect:** A user can convert a submitted application to a
  job-only Skipped record, or convert a Skipped decision into an active
  application from the menu.
- **Cost / risk:** Requires a new explicit document-retention/deletion policy,
  application-date rules, confirmation UX, and broader migration/regression
  coverage. It changes the meaning of the existing job-only decision.

### Option C — Preserve current transitions, group only existing choices

- **What it does:** Add headings to the existing forward-only options without
  permitting cross-lifecycle reactivation.
- **User-visible effect:** Improves scanning but does not solve the requested
  ability to move records in both directions.
- **Cost / risk:** Leaves the principal requested workflow unavailable.

## Tradeoffs

| Option | Buys | Costs |
| :--- | :--- | :--- |
| A | Reversible application lifecycle without document loss | Skipped remains a separate decision type |
| B | Every inactive label is selectable in both directions | New destructive-data and migration semantics |
| C | Minimal UI change | Does not meet the requested outcome |

## Delivery Lead Recommendation

Choose Option A. It fully enables the meaningful application lifecycle move
(active ↔ rejected/withdrawn), preserves saved documents and local history, and
keeps the existing explicit boundary between a job-only decision and an
application attempt. The menu can still show the current Skipped state as a
non-transitioning job-only status if needed for clear context.

## Product Partner Assessment

Option A preserves the user’s stated ability to move applications between active
and inactive stages while avoiding an unannounced destructive conversion of a
submitted application. It requires revising the brief to define the Inactive
quick-stage group as Rejected and Withdrawn, with Skipped deliberately retained
outside that reversible application-stage workflow.

## Decision Required From The User

> **Decision needed:** Should the context menu use **Option A** (recommended:
> reversible Applied/Interviewing/Offer ↔ Rejected/Withdrawn, while Skipped
> remains job-only) or **Option B** (also make Skipped reversible, which requires
> new document and date semantics)?

After the decision: update the Product Brief, bump it to v2, mark v1
superseded, and request approval of the exact revised brief before planning.

## User Decision

**Option B selected on 2026-09-04.** A user may mark an applied application as
Skipped later, and may subsequently move a Skipped record to an active stage.
