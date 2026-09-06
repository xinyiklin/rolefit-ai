# Alignment Review — Applications and Analytics loading skeletons

Owner: Product Partner · Workflow: `product-delivery` 1.3.0

| Field | Value |
| :--- | :--- |
| Task id | `loading-skeleton-20260904` |
| Date | 2026-09-04 |
| Product Brief reviewed | v1, approved 2026-09-04 |
| Delivery Plan reviewed | v1, awaiting approval |

## Result

**Aligned — recommend approval.**

## Missing Or Weakened Acceptance Criteria

None. The plan maps all seven criteria to implementation and verification. It covers both initial chunk and initial data waits, preserves populated refreshes, removes placeholders on settlement, and accounts for reduced motion, themes, responsive layout, navigation, and accessible status.

The optional browser checks do not waive visual or interaction criteria. If the user does not authorize them, those results remain unverified, as the plan explicitly states. Builds and source inspection must not be reported as proof of rendered layout or keyboard behavior.

## New User-Facing Decisions

None requiring a product decision. Analytics currently derives totals immediately and has no loading/error input (`AnalyticsTab.tsx:18`). Presenting the existing application-load error with a route to Applications recovery is a bounded implementation of criterion 4, not a new recovery workflow. The plan confines this to an initial failure without an authoritative snapshot and retains existing analytics after subsequent failures when a snapshot is available.

## Unnecessary Scope

None. The two page-specific skeletons, boundary wiring, obsolete loading-paragraph cleanup, bounded Analytics failure presentation, and owning documentation changes support the approved criteria. Other pages, dialogs, previews, editors, AI workflows, shared packages, storage, providers, and dependencies remain outside scope.

## Overlooked Constraints, Non-Goals, Or Preserved Behavior

None. The plan retains the existing loading owner and lazy-loading mechanism, adds no artificial wait or fake records, preserves navigation and populated views, uses existing theme/layout conventions, and narrows the design-guidance update to real loading pulses while retaining the shimmer prohibition.

Current code supports the proposed state distinction: `useApplications.ts:246` initializes pending loading, its initial request clears pending in `finally`, and `hasLoadedApplications` changes on an authoritative snapshot. Tracker already displays application errors and owns refresh recovery. This supports a finite pending state followed by content, empty, or failure handling without using missing records as a permanent loading signal.

## Recommendation

Approve Delivery Plan `loading-skeleton-20260904` v1. It delivers the approved Applications and Analytics loading behavior without extending the work into other product surfaces or data lifecycles. Recommend the optional bounded browser pass because placeholder geometry, transitions, themes, and reduced motion are directly visible outcomes.

Present the complete Delivery Plan and request exact v1 approval before implementation. Browser QA remains a separate optional opt-in under repository policy; record its authorization or unverified status explicitly.
