# Product

## Register

product

## Users

One job seeker (the project owner) tailoring a resume to a specific job
description on a desktop browser (Chrome, ~1440px) during focused
application-prep sessions. They know the resume content intimately; the tool's
job is to speed up tailoring, reviewing, and exporting while detecting and
surfacing potentially unsupported claims for human review. Local-first,
single-user; no accounts, no hosted RoleFit service.

## Product Purpose

RoleFit AI turns a base resume plus a pasted job description into an honest,
tailored resume: AI proposals constrained by server-side grounding and
anti-fabrication checks, a recruiter-style review with fit scoring and gap
analysis, application-question drafts, one owned typeset editor that is both the
WYSIWYG preview and the PDF export, a re-loadable `.resume` save file, and a
lightweight application pipeline tracker. An original resume (text) is converted
once into the structured model, which is the source of truth thereafter (and can
be saved/reloaded as a `.resume` file). Success = a one-page,
interview-defensible resume exported in minutes after every AI proposal has been
reviewed against source evidence.

## Brand Personality

Calm, dense, trustworthy. A compact desktop-first job-prep workspace that
disappears into the task. Quiet competence, not salesmanship.

## Anti-references

- Marketing landing pages, oversized heroes, gradient-heavy surfaces.
- SaaS dashboard clichés (hero metrics, identical card grids).
- Sales-style or hype copy; in-product manuals and multi-sentence help essays.
- Fake loading states, shimmer, decorative motion.
- Nested card-in-card containers.

## Design Principles

1. Honesty is the product: never imply the AI can safely supply missing facts;
   ground proposals in provided evidence and surface gaps or placeholders for
   human review instead of hiding them.
2. Preserve the navbar-inputs + full-width studio workflow: masthead menus
   (Resume source, Job target, AI, Options) plus the Polish action on top;
   tabbed outputs below (Resume with a post-polish review rail, Materials with
   the plan rail, the Applications tracker, Analytics) and the header Fit
   popover. The engine-painted page remains the sole editor, the review rail
   navigates back to exact fields, and the editor itself remains the live
   preview. Saved-application PDF preview is a tracker detail, not a second live
   editing/compile surface. Changes refine this workflow, never reshape it.
3. Density with calm: restrained contrast, compact spacing, short labels,
   icons for repeated controls; one true card only for repeated items.
4. Recovery-friendly: inline, localized, user-safe errors near the affected
   workflow; never raw provider errors, stack traces, or resume text in chrome.
5. Restraint over systems: no global toast/banner/loading frameworks; reuse
   the per-surface CSS classes in `src/styles/`, shared editor primitives from
   `@typeset/editor`, and each owner's tokens rather than forking controls.
6. Make workflow state truthful: Distill, Tailor, and Review show their exact
   ordered step, stop after failure/user cancellation, identify the cause, and
   never present a deterministic brief as a successful AI run.
7. Preserve product boundaries: RoleFit owns job/AI/tracker orchestration and
   host chrome; shared document editing, formatting, layout, files, and PDF
   remain package-owned and consistent with standalone Typeset.

## Accessibility & Inclusion

WCAG AA contrast for text (recently audited; `--ink-faint` darkened to pass).
Keyboard access for all changed controls (APG tabs nav, focus-visible rings,
24px minimum icon hit targets). aria-live for async preview/export status.
Desktop is primary; content wraps rather than clips at narrow widths. At 720px
and below, precise Resume authoring yields to a focused width notice, but
navigation, Materials, Applications, and Analytics remain available.
