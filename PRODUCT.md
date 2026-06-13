# Product

## Register

product

## Users

One job seeker (the project owner) tailoring a resume to a specific job
description on a desktop browser (Chrome, ~1440px) during focused
application-prep sessions. They know the resume content intimately; the tool's
job is to speed up tailoring, reviewing, and exporting without ever inventing
facts. Local-first, single-user; no accounts, no SaaS.

## Product Purpose

Role-Fit AI turns a base resume plus a pasted job description into an honest,
tailored resume: AI polish that never fabricates experience, a recruiter-style
review with fit scoring and gap analysis, application-question drafts, a
structured WYSIWYG resume editor with compiled LaTeX/PDF preview, multi-format
export (PDF, DOCX, .tex, Overleaf), and a lightweight application pipeline
tracker. Success = a one-page, interview-defensible resume exported in minutes
with full confidence nothing was invented.

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

1. Honesty is the product: never imply the AI invented or could invent facts;
   surface gaps and placeholders for human review instead of hiding them.
2. Preserve the navbar-inputs + full-width studio workflow: masthead menus
   (Resume source, Job target, AI, Options) plus the Polish action on top;
   tabbed outputs below (Resume with the review rail, Materials with the
   plan rail, the Applications tracker, Analytics) and the header Fit
   popover. Changes refine it, never reshape it.
3. Density with calm: restrained contrast, compact spacing, short labels,
   icons for repeated controls; one true card only for repeated items.
4. Recovery-friendly: inline, localized, user-safe errors near the affected
   workflow; never raw provider errors, stack traces, or resume text in chrome.
5. Restraint over systems: no global toast/banner/loading frameworks; reuse
   `src/ui.tsx` primitives and `src/styles/tokens.css` tokens.

## Accessibility & Inclusion

WCAG AA contrast for text (recently audited; `--ink-faint` darkened to pass).
Keyboard access for all changed controls (APG tabs nav, focus-visible rings,
24px minimum icon hit targets). aria-live for async status (compile preview).
Desktop is primary; content wraps rather than clips at narrow widths.
