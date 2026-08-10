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

RoleFit AI can turn a prepared job posting, a base resume, and a
candidate-authored cover letter or base variant into honest, tailored
application materials. Prepare is the first/default page and the sole job-intake
surface: the paired browser extension is primary, with URL fetch and pasted text
as deliberate fallbacks. Its complete editable brief exposes tracked job facts,
one role context, responsibilities, required and preferred qualifications,
technical keywords, seniority and domain signals, benefits, and extraction
gaps. Resume proposals remain constrained by server-side
grounding and anti-fabrication checks. Normal Resume Polish is one provider
operation that stages a proposal for human decisions; oversized documents
prioritize material, job-relevant fields and disclose the fields outside that
pass. It does not automatically run a second assessment over edits the user may
never accept.

**Accepting a proposal works the same way for both documents.** What is being
decided differs and stays different — the resume proposes individual edits, the
letter proposes one replacement — but the act does not. Each document's rail
shows the changed words marked rather than two blocks to compare by eye, and
each commits from one bar in the same place: what is left to decide, then accept
beside discard. The resume can take all remaining edits, or decline them all, in
one move, and every settled edit offers Undo — accepting is never a door that
only another Polish can reopen. The letter opens on a Changes view of what
accepting would rewrite, with the full proposed letter one click away.

The cover letter is **one Polish click**. RoleFit resolves the date, candidate
name, role, company, greeting, and sign-off itself, sends the whole candidate
evidence corpus with the source letter, and lets the model choose which
experiences and honest-context notes this particular posting warrants. Bracketed
text in a base variant is a drafting instruction, never candidate evidence.
Grounding, placeholder rejection, and a single silent repair pass all run on the
server. A valid result becomes a whole-letter proposal beside the unchanged
editor; only **Accept proposal** replaces the live document and creates the exact
one-click Restore baseline. **Discard proposal** performs no document mutation. A
later resume edit keeps that already-validated proposal reviewable, but warns
that it was checked against the earlier resume before the user accepts it. A
changed source letter, job, personal evidence, or polishing instruction still
requires Polish again before acceptance. A letter that still fails after repair
is discarded with the current one kept,
and bounded typed validation issues identify the rejected claim and recovery
without exposing provider output, repair instructions, or internal evidence ids.
An unfinished Guidance prompt never counts as evidence, and spelled-out
durations receive the same grounding check as digit forms.

The letter asks a question only when a fact genuinely cannot be resolved — a
missing company, role title, or candidate name, or a template that names a
private fact such as a referral. A hiring manager's name, a reason for interest,
which experience to lead with, and tone are never questions: an authored
greeting supplies a recipient and the company hiring team is always a correct
fallback. Both editors share
deterministic typesetting and PDF export, and the same recovery and naming
behavior: unsaved edits go to a per-tab recovery draft either page can restore,
including a cover letter changed only by title or style. Workspace adoption
never deletes a live sibling tab's draft and notifies that tab that the saved
workspace changed. A document is named
`Name_Company_Resume` / `Name_Company_Cover_Letter` so
one role's materials read as one application. Selecting a saved variant changes
the document content, not that application output name, and both editor
sublabels show the same `Role at Company` target.
`.resume` and `.cover` are their separate reloadable formats. Resume always
owns a real structured editor document: without a saved or opened source it is
a clean blank page with an editable header anchor, not an empty-state substitute.
That blank remains valid for editing and strict `.resume` save, but does not
qualify for PDF export, Polish, or Apply until it contains meaningful evidence.
The product also includes application-question drafts and a lightweight application pipeline
tracker. Prepare gives Resume and Cover Letter matching material cards, each
with its own named-variant selector and Include toggle. Resume starts included
and Cover Letter starts excluded. Starting Polish for a document turns on that
document's Include toggle without changing the sibling material; an enabled
automatic proposal does the same when it starts. Apply creates the tracked
application once the job is prepared and stores only included, ready materials;
it also supports a tracker-only application with both cards excluded. On a
later re-Apply, an excluded slot is left untouched so a
previously saved artifact is never deleted or replaced implicitly. The resume
and cover letter keep independent
saved/unsaved states and an explicit "Update application" action in their own
Save menus that rewrites only that document. Regenerating or editing a document
never rewrites a stored one. An application keeps one space-efficient
representation of each document:
editable `.resume`/`.cover` source for documents saved from RoleFit, or the PDF
when the user explicitly uploads one. Its Documents tab previews or downloads
either form and accepts additional PDF files the posting asked for. Tracker
text and analytics projections never count as a saved document and cannot
reload or overwrite the strict source.
Opening a stored application restores its validated posting and documents into
the current session, lands on Prepare, and preserves the dirty-document
replacement guard.
A versioned `.rolefit-backup` file
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
With none configured, editing, tracking, export, and deterministic URL/paste
preparation remain available while provider-backed improvement, Fit Assessment,
and Polish stop with a direct instruction to add a provider. RoleFit never
chooses a paid replacement silently.

The companion defaults to local port `5181` and may persist another available
port after explicit confirmation and restart. Browser-local recovery and view
state are scoped by origin, while canonical stage, candidate, and selected-resume
preferences follow the unchanged workspace across ports. Workspace and provider
data keep their operating-system-local locations. The extension
owns one saved numeric localhost port in versioned browser storage; its runtime
config is only the validated first-install seed. The companion shows and copies
the active port, and a user saves that value in the popup's inline Settings
view after an app port change. The extension does not scan localhost, use a
locator, open a second listener, or require a reload. Health identifies a compatible server as
companion-launched or standalone without treating that public response as proof
of ownership; only the current private utility-process handle proves that this
companion started it. Startup may connect to or gracefully stop a standalone
development server, use or gracefully restart a previous companion service on
macOS/Linux, or persist another available port. RoleFit never stops an
unidentified listener, never force-kills a compatible listener, and does not
offer process termination on Windows where an equivalent graceful signal is
unavailable.

## Fit Assessment User Contract

Fit Assessment is a reusable advisory screening of the captured posting against
the exact selected resume and candidate-authored context. The first assessment
normally runs after Prepare, and the user may reassess at any time afterward.
Each result describes demonstrated fit in the selected resume at the time of
that run; it does not predict hiring, rewrite the resume, or substitute for the
user's judgment. Its four verdicts mean:

- **Strong:** explicit evidence covers most main responsibilities and core
  qualifications with no major material gap.
- **Reasonable:** explicit evidence covers most main responsibilities, with one
  or two material core gaps and a credible path to perform the role.
- **Stretch:** relevant overlap exists, but several important gaps remain or
  the core experience is mainly transferable rather than direct.
- **Limited:** the supplied resume shows little direct evidence for the role's
  main responsibilities and core qualifications.

Before choosing a verdict, Fit Assessment separates main responsibilities and
core qualifications from preferred items, logistics, benefits, and application-
form or administrative text. The verdict and bounded findings prioritize the
most decision-critical evidence rather than whichever excerpt appears first.
Evidence-source boundaries remain explicit: academic, personal, volunteer, or
open-source work does not satisfy an explicitly professional, paid, commercial,
or production requirement unless the posting accepts that source. Experience
categories are never summed, and role or project counts never imply duration.
A posting with no substantive responsibilities or qualifications yields Limited
instead of a fit inferred from its title or application form. At the Limited/
Stretch boundary only, meaningful direct evidence for supporting core work stays
Stretch when the role-defining specialization is unshown; that rule never raises
a case to Reasonable or Strong. Before returning,
the provider must re-check that every finding is copied exactly from its source;
the server still rejects the entire result when any anchor is unusable.

Prepare shows the verdict, fixed summary, selected resume, last-assessed time,
resolved provider/model/reasoning attribution, rubric version, and at most three
direct matches and three not-shown gaps. Each match keeps the exact posting
excerpt beside the exact resume or About you evidence that supports it. A Check
or Blocked eligibility result keeps its exact posting condition, and Blocked
also keeps the exact conflicting About you fact. Missing evidence is a gap, not
proof that the candidate is incapable. Strong, Reasonable, and Stretch require
at least one direct match; unusable or internally contradictory output fails
closed. The result has no numeric score, confidence, visible
requirement ledger, recommendation, or analytics role, and it never silently
derives tracker priority. Unusable provider output becomes unavailable rather
than a guessed result; the deterministic local job brief remains editable and
manual Polish remains available.

Settings > About you may add optional candidate-declared education and
scheduling facts: a 4.0-scale GPA attached to a declared education level, plus
an earliest start of immediately, one to four weeks' notice, or a specific
date. Citizenship, U.S. work authorization, and sponsorship are three
independent declarations; each defaults to Not specified, and citizenship
never implies either employment answer or clearance eligibility. It may also
add experience evidence by source: professional employment,
internships, freelance/contract work, research, academic projects, personal
projects, open source, volunteer work, or military/public service. Each source
may declare duration, number of roles/projects, recency, and a short factual
scope. These are global facts, not user-authored fit labels: Fit Assessment
decides relevance per posting, does not sum overlapping categories, and never
treats a project count as elapsed time.
When a posting explicitly requires professional, industry, commercial,
production, or paid experience, other sources do not satisfy that requirement
unless the posting says they may.

Eligibility is separate from fit and never changes the verdict. **Clear** means
no stated employment-eligibility condition needs attention. **Check** means the
posting states a work-authorization, sponsorship/visa, clearance, or legal-work
condition the candidate should confirm. **Blocked** requires both an explicit
posting condition and an explicit conflicting candidate-context fact. Education,
skills, and experience are fit evidence, not eligibility. Only Blocked stops an
otherwise eligible automatic Polish run; Check may proceed because Polish is a
reviewable proposal, not a submission.

Fit Assessment defaults on and owns provider, model, and reasoning settings
independently from Job analysis. Its first run shares Prepare's Job analysis
dispatch only when both stages resolve to the same request configuration;
otherwise Prepare commits Job analysis and starts a separate assessment-only
request. That first assessment remains part of the same Prepare transaction:
Stop, input replacement, and unload protection cover it, and Apply does not
become ready until its one-use automation decision settles. **Reassess fit**
always starts a new assessment without repeating Job
analysis, using the retained captured posting, current selected resume and
candidate context, and the Fit Assessment stage's selected provider, model,
reasoning effort, and rubric. Changing the selected resume also reruns only Fit
Assessment. Editing the displayed prepared brief does not silently change the
screened posting. A changed posting, authoritative resume, candidate context,
provider/model/reasoning setting, or prompt version makes the displayed result
out of date. Beginning, failing, cancelling, or disabling a later assessment
never erases the latest completed result. Prepare retains that timestamped
result as a clearly labeled previous preparation and lists which input groups changed — job posting, resume
content, About you, or assessment setup — without presenting its verdict as
current. A successful reassessment supersedes that displayed result. Application
records retain the latest completed assessment snapshot rather than a versioned
assessment ledger. Apply saves that snapshot even when later input changes make
it historical or the resume artifact is excluded; re-Apply preserves the stored
snapshot when the current session has no newer completed assessment. The bundled
starter and short stubs are not applicant resumes. A blank document becomes an
applicant-authored resume once it has substantive dirty content.

Resume and Cover Letter automatic Polish controls remain independent from each
other. The first Fit Assessment launched by each successful Prepare is the only
assessment that may trigger either configured automatic Polish action. Reassess
fit, assessment retries, resume-change assessments, and restored history remain
advisory and never start another automatic Polish. Both switches default off;
Resume defaults to Reasonable or better and Cover Letter to Strong only. Manual
Polish is available for every verdict, eligibility state, and unavailable result.
The provider, grounding, request, and provenance implementation is specified in the
[Fit Assessment technical contract](server/ai/README.md#fit-assessment-technical-contract).

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
2. Preserve the compact masthead + full-width studio workflow: the masthead
   carries the brand plus the global Apply action. Read-only Sessions is
   ambient awareness immediately above Settings in the bottom studio-rail
   utilities group, outside `OUTPUT_TABS` and the APG tablist. Expanded it
   reads Sessions + count; collapsed it becomes an icon + compact count/working
   state, and its popover opens rightward within the viewport. The rail starts
   with a PREPARE group containing Prepare, followed by DRAFT and TRACK groups.
   Prepare is the first/default and sole job-intake surface; tabbed
   workspaces continue with Resume and its consistent Open/Save document chrome,
   Cover letter with the matching document chrome, and one always-present
   workflow-rail hierarchy for both documents. Each document's primary **Polish**
   action sits beside that rail's disclosure control — in the rail header while
   it is open, and on the document's edge while it is collapsed.
   Polish is the one name for starting a run, in either document and on the
   Prepare cards that launch the same runs. Resume's Polish creates one grounded
   proposal from either the document or Prepare; there is no stage selector or
   second menu in the document header. Cover letter
   stages a whole-document proposal for explicit acceptance. The document rails
   remember their disclosure separately while their orchestration remains
   document-specific. The remaining workspaces are Materials, the Applications
   tracker, and Analytics. The engine-painted page remains the sole editor; the
   resume proposal review navigates back to exact fields, and the editor itself remains the live
   preview. Saved-application PDF preview is a tracker detail, not a second live
   editing/compile surface. Changes refine this workflow, never reshape it.
3. Density with calm: restrained contrast, compact spacing, short labels,
   icons for repeated controls; one true card only for repeated items.
4. Recovery-friendly: inline, localized, user-safe errors near the affected
   workflow; never raw provider errors, stack traces, or resume text in chrome.
5. Restraint over systems: no global toast/banner/loading frameworks; reuse
   the per-surface CSS classes in `src/styles/`, shared editor primitives from
   `@typeset/editor`, and each owner's tokens rather than forking controls.
6. Make workflow state truthful: Prepare publishes its deterministic brief
   immediately, then Job analysis and optional Fit Assessment settle independently.
   Resume Polish has one request and three distinct settled outcomes: Proposal,
   No changes, and Withheld. Withheld edits never receive success treatment;
   failure and cancellation identify the cause without changing the resume.
7. Preserve product boundaries: RoleFit owns job/AI/tracker orchestration and
   host chrome; shared document editing, formatting, layout, files, and PDF
   remain package-owned and consistent with standalone Typeset.
8. Keep provider setup local and least-privileged: API keys are write-only from
   the companion renderer, encrypted through Electron `safeStorage`, and never
   enter browser storage or HTTP. CLI authentication stays provider-owned;
   RoleFit never asks for provider passwords, MFA values, or OAuth codes.
9. Make portability explicit and recoverable: the companion's Workspace section
   owns Back up and Restore. A backup includes only validated app-managed
   resumes, history, tracker data, saved PDFs, and allowlisted workspace
   preferences. It excludes provider setup, API keys, CLI sessions,
   arbitrary workspace files, and unsaved recovery drafts. Restore refuses to
   run while live RoleFit browser tabs are detected, validates a complete
   staging workspace before replacement, and keeps the previous saved
   workspace as a local safety copy; every browser attached to that workspace
   adopts restored preferences on its next load.
10. Keep application readiness singular: the masthead and Prepare page expose
    the same Apply command and blocker model. The current job must be prepared
    and preparation for selected work must be idle. Resume and Cover Letter
    each have an Include toggle; only included material must be ready, and both
    may be excluded. Resume defaults on and Cover Letter defaults off. Starting
    Polish for one document, manually or through its enabled automatic proposal,
    includes that document and leaves the other Include choice unchanged. A
    later re-Apply must preserve any previously saved artifact for an excluded
    slot.
    Fit Assessment follows the [user contract](#fit-assessment-user-contract): one
    compact advisory in the Application rail, no hidden score or replacement
    for human review. The bundled starter is sample content and never counts as
    a ready applicant resume.
11. Preserve safe extension intake: a claimed extension posting requests
    AI-backed Job analysis and stops on Prepare; it never implicitly starts
    resume Polish. A failed analysis leaves the deterministic brief editable and
    manual Polish available. Every preparation resolves which resume it speaks
    for exactly once, before the provider request: it waits for the local
    workspace to finish loading, keeps a real current document (including an
    explicitly uploaded resume), and otherwise
    adopts the sole saved variant or a meaningful unique winner while the editor
    is clean and not application-owned; that selection is not tailoring. A tie or
    incomplete comparison keeps the current selection. Candidate bytes, option
    metadata, and the live candidate revision form one resolution snapshot, so
    overwriting a saved variant under the same filename forces a fresh read. Do
    not add persisted variant metadata or another document schema for this
    decision. Stop, source replacement, application restore, and unmount cancel
    that resolution before it can adopt a document or start Fit Assessment.
12. Keep the complete prepared job correctable without another AI run. Along
    with role, company, location, type, source, work authorization,
    compensation, and one role context, expose responsibilities,
    required and preferred qualifications, technical keywords, seniority and
    domain signals, benefits, and extraction gaps. Preserve
    the captured posting separately, persist the complete corrected brief on
    Apply, and restore both without feeding benefits into resume tailoring.
13. Keep Polish automation independent and reversible. Follow the
    [Fit Assessment user contract](#fit-assessment-user-contract); Resume and Cover
    Letter automation remain independent from the advisory and from each other,
    and manual Polish is always available.
14. Present one Polish workflow for both documents. Resume and Cover Letter
    progress through the same named sequence — Ready to Polish, Polishing and
    validating, Proposal ready, then Reviewing proposal — while keeping their
    proposal units distinct: a resume proposes individual edits and a cover
    letter proposes one complete replacement. Each Polish request instructs the
    model to silently audit evidence, claims, identifiers, and output shape
    before returning its proposal. The configured reasoning effort controls both
    provider reasoning and the breadth of that internal audit; audit notes never
    reach the user. Role Fit stays separate: it judges whether the application
    is worth pursuing, not whether the finished document is sound.

## Accessibility & Inclusion

WCAG AA contrast for text (recently audited; `--ink-faint` darkened to pass).
Keyboard access for all changed controls (APG tabs nav, focus-visible rings,
24px minimum icon hit targets). aria-live for async preview/export status.
Desktop is primary; content wraps rather than clips at narrow widths. At 720px
and below, precise Resume authoring yields to a focused width notice, but
Prepare, navigation, Cover letter, Materials, Applications, and Analytics remain
available.
