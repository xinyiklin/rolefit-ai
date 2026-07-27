# Product

## Register

product

## Users

One job seeker (the project owner) tailoring a resume to a specific job
description in a desktop browser (Chrome, ~1440px) during focused
application-prep sessions. The browser is the product surface. A required
device-local Electron companion starts and keeps the loopback server available, shows
the complete five-provider setup catalog, encrypts supported API keys locally,
offers official installation guidance for missing CLIs and provider-owned
external-terminal sign-in, manages portable workspace backups and extension
pairing, and opens RoleFit in the default browser. It is not a second Drafting
Desk and does not own resume editing,
tracker state, or workspace files. The user knows the resume content
intimately; the tool's job is to speed up tailoring, reviewing, and exporting
while detecting and surfacing potentially unsupported claims for human review.
Local-first, single-user; no RoleFit accounts, hosted backend, cloud credential
service, database, or synchronization. Native macOS and Windows distribution
keeps a fail-closed signed-release pipeline and a separate, explicitly unsigned
preview channel while project-owned signing identities are unavailable.
Preview downloads are checksum-covered GitHub prereleases and must disclose
the expected Gatekeeper or SmartScreen warning. The browser remains the only
working product surface. The public site is a static product/download page,
never a hosted copy of the workbench.

## Product Purpose

RoleFit AI turns a base resume, a candidate-authored cover letter, and a pasted
job description into honest, tailored application materials. Resume proposals
remain constrained by server-side grounding and anti-fabrication checks, with a
recruiter-style review for fit scoring and gap analysis. The cover-letter
workflow revises the user's own writing in a dedicated plain-paragraph editor,
preserves a restorable source, and never creates a letter from the job and
resume alone. Both editors share deterministic typesetting and PDF export;
`.resume` and `.cover` are their separate reloadable formats. The product also
includes application-question drafts and a lightweight application pipeline
tracker. A versioned `.rolefit-backup` file
ports the saved local workspace and allowlisted RoleFit preferences between
devices without creating an account or synchronization service. An original resume (text) is converted
once into the structured model, which is the source of truth thereafter (and can
be saved/reloaded as a `.resume` file). Success = a one-page,
interview-defensible resume exported in minutes after every AI proposal has been
reviewed against source evidence.

Provider setup is explicit: the companion offers Claude Code, Codex, and
Antigravity CLIs plus OpenAI and Claude APIs, while the browser shows only
providers the user added. A configured provider that becomes unavailable stays
visible but disabled with reconnect guidance; a never-added provider is absent.
Because Antigravity 1.1.x has no non-interactive auth-status command, an added,
installed Antigravity CLI is request-eligible as **Ready to verify** while its
auth state remains unknown; the first real provider request verifies the
provider-owned session or reports sign-in recovery guidance.
With none configured, editing, tracking, and export remain available while AI
actions stop with a direct instruction to add a provider. RoleFit never chooses
a paid replacement silently.

The companion defaults to local port `5181` and may persist another available
port after explicit confirmation and restart. Browser-local state is scoped by
origin, so a different port has separate draft/preferences storage. Workspace
and provider data keep their operating-system-local locations, and extension
imports follow the companion's resolved numeric localhost port through a
generated extension runtime config. A port-changing restart tells the user to
reload the unpacked extension once; there is no live native synchronization or
localhost scanning. Health identifies a compatible server as
companion-launched or standalone without treating that public response as proof
of ownership; only the current private utility-process handle proves that this
companion started it. Startup may connect to or gracefully stop a standalone
development server, use or gracefully restart a previous companion service on
macOS/Linux, or persist another available port. RoleFit never stops an
unidentified listener, never force-kills a compatible listener, and does not
offer process termination on Windows where an equivalent graceful signal is
unavailable.

## Brand Personality

Calm, dense, trustworthy. A compact desktop-first job-prep workspace that
disappears into the task. Quiet competence, not salesmanship.

## Anti-references

- Marketing landing-page patterns inside the Drafting Desk, oversized in-app
  heroes, and gradient-heavy working surfaces. The separate public product page
  follows its own calm editorial contract.
- SaaS dashboard clichés (hero metrics, identical card grids).
- Sales-style or hype copy; in-product manuals and multi-sentence help essays.
- Fake loading states, shimmer, decorative motion.
- Nested card-in-card containers.

## Design Principles

1. Honesty is the product: never imply the AI can safely supply missing facts;
   ground proposals in provided evidence and surface gaps or placeholders for
   human review instead of hiding them.
2. Preserve the compact masthead + full-width studio workflow: masthead menus
   (Sessions, Job target) plus the global Apply action, the Settings dialog at
   the foot of the studio rail; tabbed
   outputs below (Resume with a consistent Open/Save/Polish
   document action bar and a post-polish review rail, Cover letter with the
   matching Open/Save/Polish action bar, its plain editor and
   deterministic checklist, Materials, the
   Applications tracker, Analytics) and the header Fit
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
8. Keep provider setup local and least-privileged: API keys are write-only from
   the companion renderer, encrypted through Electron `safeStorage`, and never
   enter browser storage or HTTP. CLI authentication stays provider-owned;
   RoleFit never asks for provider passwords, MFA values, or OAuth codes.
9. Make portability explicit and recoverable: the companion's Workspace section
   owns Back up and Restore. A backup includes only validated app-managed
   resumes, history, tracker data, saved PDFs, and mirrored allowlisted
   browser preferences. It excludes provider setup, API keys, CLI sessions,
   arbitrary workspace files, and unsaved recovery drafts. Restore refuses to
   run while live RoleFit browser tabs are detected, validates a complete
   staging workspace before replacement, and keeps the previous saved
   workspace as a local safety copy; the browser adopts restored preferences
   on its next load.

## Accessibility & Inclusion

WCAG AA contrast for text (recently audited; `--ink-faint` darkened to pass).
Keyboard access for all changed controls (APG tabs nav, focus-visible rings,
24px minimum icon hit targets). aria-live for async preview/export status.
Desktop is primary; content wraps rather than clips at narrow widths. At 720px
and below, precise Resume authoring yields to a focused width notice, but
navigation, Cover letter, Materials, Applications, and Analytics remain available.
