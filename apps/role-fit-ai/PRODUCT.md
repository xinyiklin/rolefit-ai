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

## Content and evidence warning policy

**Content checks are advisory (2026-09-18).**
Content and evidence checks inform the user; they do not decide what the user
may accept. This applies throughout RoleFit: resume tailoring/Polish,
cover-letter generation/Polish, application answers, candidate role descriptions,
Fit Assessment, and review feedback. Job analysis is structured JD extraction: it
allows concise summaries and paraphrases, with basic response validation and no
post-extraction fact checks, source matching, wording replacement, or evidence
review warnings. The prompt still requires fidelity to the supplied posting.

Keep checks for unsupported claims, missing evidence, attribution, metrics,
content quality, and ATS terminology. Shortness, style, wording, and
target-description concerns are advisory when the output is
otherwise usable. Preserve the output and show a compact warning beside the
affected suggestion or finding **before acceptance**, such as **Not supported by provided evidence**, with a short
reason where useful. A failed check means review is needed, not proof of falsity.
Existing Accept, Edit, and Reject controls remain available; evidence warnings
alone must not disable applying edits, saving, copying, exporting, or continuing.
Do not require added evidence, dismissal, another step, or confirmation.
Acceptance records the user's choice, never system verification.

Keep generation instructions factual and grounded in supplied information. An
uncertain excerpt or unknown source reference may be retained as unconfirmed
feedback, but must not be linked to an unrelated source or presented as verified
support. Disable only invalid source navigation/highlighting, not use or
acceptance. An invalid mutation target is different: it cannot safely authorize an
edit. Unsafe markup, unusable response structures, unauthorized changes, invalid
edit targets, and stale responses applied to the wrong document retain their
technical protections. Missing required operation inputs and provider failures
remain distinct from content judgments. Empty or unrenderable documents may
remain unavailable for an operation, and missing evidence must not gate otherwise
usable documents. Resume Polish edits with unresolved template placeholders are
withheld, and Apply includes a cover letter only when it has at least 40
authored words and no unresolved template slots.

Reuse existing checks, result types, review components, and decision controls,
adding small optional warning fields only where needed. Do not add a policy
engine, evidence ledger, approval workflow, confidence score, review dashboard,
or extra AI analysis stage beyond the opt-in Resume Polish review below.
Provider defaults, local privacy, Fit's rubric, and portable document schemas
remain unchanged. ATS terminology improvements are a separate workstream
governed by this same policy.

**Opt-in Resume Polish review (2026-10-07, user-directed).** With Settings >
Guidance > **Review edits before showing them** on (default off), Resume Polish
reviews its own sanitized edits with the same provider, model, and effort and
holds back the ones it judges low-impact or likely incorrect. This is the one
place a content judgment changes what the user first sees: held-back edits are
not deleted but listed, collapsed, with their reason, warnings, and a Restore
action that returns them to the proposal as ordinary rows. Kept edits keep their
warnings, and review verifies nothing. A review failure shows the full
unreviewed proposal with a note. Cover-letter Polish has no review.

Warnings stay attached to the output they describe. Editing labels retained
concerns as referring to earlier wording; acceptance does not clear uncertainty.
Saved Fit receipts retain optional warning metadata. Historical prepared-job
warning metadata remains readable but is not displayed or used in drafting; new
extractions produce none. Older records remain readable without inventing
verification; older app versions may reject new warning-bearing records, so downgrade compatibility is not guaranteed.
Known uncertainty from accepted Resume text also accompanies Cover and answer
requests and results instead of becoming independently verified evidence.

### Application Answers

The exact employer question remains attached to every revision. Refinement
instructions never replace it; new questions and edited question revisions are
explicit. The answer uses the edited Prepare brief, captured posting, current
selected resume, whole Profile, and explicit clarifications. Generated or saved
answers are editing context, never independent evidence. Missing necessary
personal facts produce a focused follow-up outside the answer instead of an
invented story or drafting placeholder. Ordinary answers are concise; detailed
employer statements may be longer.

Only explicit hard employer word, character or sentence rules control normal
Copy answer and Save answer availability. Defaults, style and all evidence
warnings remain advisory. Counts describe the exact plain text copied and
saved, using normalized line endings and UTF-16 character length including
spaces. The workflow makes at most one formatting repair. An unresolved draft
remains editable and can be preserved through Save draft; it never appears
ready. Ambiguous multiple-field limits require separate questions rather than
claiming compliance with an unknown scope.

Visible Save and the response context menu save the selected exact revision;
repeated saves do not duplicate it, and newer saved revisions preserve older
ones. Show Saved only after persistence succeeds. Failed/conflicting saves keep
the draft and explain recovery. Saved answers survive restart and backup/restore;
legacy answers keep unknown provenance. Unsaved conversation remains across tab
navigation, but is not a durable transcript. The model menu shares Application
Answers settings; changes affect future requests and preserve historical
configuration. Generation and saving never rerun Prepare or generate documents.

Facts added with **Add a detail** belong to their question. Each saved revision
keeps them as the user's own statements, separate from the answer text.
Reopening a saved answer restores that revision's facts under a collapsed
**Your facts** list, and refinements send them again as explicit user facts to
the selected Answers provider. Generated, edited or saved answer text, the
model's follow-up questions, refinement instructions and the refinement chips
never become facts; Add a detail is the default only when a follow-up has no
draft text. Facts stay with their question's id: an Applications-modal edit,
even of the question text, keeps them, and they never reach another question
or application. Answers saved before facts were kept reopen without them. A
tracker holding saved facts cannot be opened by an older RoleFit build.

## Product Purpose

Applications and Analytics show structured loading placeholders while their
page code or initial saved-application data is pending. The placeholders pulse
quietly, remain static for reduced motion, and disappear as soon as loading
settles. Navigation stays available; refreshes preserve existing content. Empty
states appear only after loading settles, and an initial load failure exposes
recovery instead of leaving an indefinite placeholder or zero-data analytics.

RoleFit AI can turn a prepared job posting, a base resume, and a
candidate-authored cover letter or base variant into honest, tailored
application materials. Prepare is the first/default page and the sole job-intake
surface: the paired browser extension is primary, with URL fetch and pasted text
as deliberate fallbacks. Its complete editable brief exposes tracked job facts,
one role context, responsibilities, required and preferred qualifications,
technical keywords, seniority and domain signals, benefits, and extraction
gaps. Resume proposals are checked for grounding and fabrication concerns.
Otherwise usable suggestions retain detected concerns as warnings. Normal Resume Polish is one provider
operation that stages a proposal for human decisions; oversized documents
prioritize material, job-relevant fields and disclose the fields outside that
pass. By default it does not run a second assessment over edits the user may
never accept; the opt-in review described in the warning policy is the one
exception, a keep-or-hold-back pass inside the same Polish run. "Proposed improvements" is a bounded editorial summary of the
changes, without candidate-evidence checks or the generic unsupported-summary
warning. Proposed resume text and cited suggestions keep their own checks.

Settings > Guidance owns **Bold keywords in bullets**, on by default. Turned
off, a bullet Resume Polish rewrites arrives unbolded: the prompt forbids
bolding a bullet and the sanitizer strips `<b>` from the proposal regardless.
Only bold is affected — italic and underline are untouched — and a difference
that is only bold is then not an edit at all. On the default setting that same
difference is an ordinary proposal, because removing bold is a real change when
bold is allowed. Either way the preference governs only what Polish writes: a
bullet Polish does not rewrite keeps its marks. Summary text is a bullet target
and follows the same rule; skill lists are outside the preference, and entry
titles are never Polish targets at all.

Beside it, **Review edits before showing them** (off by default) adds the opt-in
review: Polish then makes two requests to the Resume Polish provider, a
generation and, when it proposed any edit, a keep-or-hold-back review, which
roughly doubles its time and usage. Progress stays "Polishing and validating"; Stop cancels both. A result
whose every edit was held back reads as no worthwhile changes, with the
held-back list still there to restore from. The review's usage is recorded as
its own Resume Polish review row.

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
experiences and Profile notes this particular posting warrants. Bracketed
text in a base variant is a drafting instruction, never candidate evidence.
Grounding, placeholder, and quality checks run on the server and produce
warnings alongside usable text. Only technically unusable output receives a
single repair attempt. A usable result becomes a whole-letter proposal beside the unchanged editor; only **Accept proposal**
replaces the live document and creates the exact
one-click Restore baseline. **Discard proposal** performs no document mutation. A
later resume edit keeps that existing proposal reviewable, but warns
that it was checked against the earlier resume before the user accepts it. A
changed source letter, job, personal evidence, or polishing instruction still
requires Polish again before acceptance. A letter still technically unusable
after repair returns bounded issues and leaves the current document untouched.
Content concerns never trigger a repair or prevent acceptance. Accepted warnings
remain visible after editing, labelled as referring to the earlier wording; only
evidence concerns about that wording carry into the next Polish, while length
and phrasing notes are recomputed for each draft. The model's own "check before
sending" notes appear with the draft, labelled as the model's notes rather than
RoleFit evidence checks;
Restore remains available only while the editor retains its exact baseline. Neither warnings nor errors expose repair instructions or internal evidence ids.
An unfinished Profile evidence prompt never counts as evidence, and spelled-out
durations receive the same grounding check as digit forms.

The prepared role and company remain necessary operation inputs. A missing
candidate name or private template fact, such as a referral, is advisory;
optional fields stay editable without gating Polish. An authored greeting
supplies the recipient, with the company hiring team as the fallback. A reason
for interest, which experience to lead with, and tone do not introduce another
question or approval step.
Both editors share deterministic typesetting and PDF export, and the same
recovery and naming behavior: meaningful unsaved edits go to a 24-hour, per-tab recovery entry,
including a cover letter changed only by title or style. Only a reload or
restored instance of that same tab may offer **Recovery draft available**; a
fresh tab never adopts another session's entry, and a browser-extension import
starts a new preparation without showing the prior prompt or deleting its
recovery entry. Expiry and dismissal remove only RoleFit recovery keys, never
the rest of browser storage. Workspace adoption never deletes a live sibling
tab's draft and notifies that tab that the saved workspace changed. A document
is named
`Name_Company_Resume` / `Name_Company_Cover_Letter` so
one role's materials read as one application. Selecting a saved variant changes
the document content, not that application output name, and both editor
sublabels show the same `Role at Company` target.
`.resume` and `.cover` are their separate reloadable formats. Resume Open accepts
only `.resume`; Cover Letter Open accepts only `.cover`. Other source formats may
be typed or pasted into a blank document, but are never treated as reloadable
files. Resume always
owns a real structured editor document: without a saved or opened source it is
a clean blank page with an editable header anchor, not an empty-state substitute.
That blank remains valid for editing and strict `.resume` save, but does not
qualify for PDF export, Polish, or Apply until it contains meaningful document
content. Resume readiness uses renderable content rather than minimum word
counts; cover-letter Apply readiness also requires 40 authored words and no
unresolved template slots. Empty-document and unrenderable-content protections
remain independent of evidence verification.
The product also includes session-local application-question drafts and a
lightweight application pipeline tracker. Answers is an application-specific
conversation: paste the exact employer question, receive one concise draft,
edit or refine it, then copy or explicitly save the chosen question/answer
revision. Generation alone creates no tracker record. First Save creates a
Draft without an application date; later saves update that same record, and
Apply or Skip transitions the same ID while retaining its answers. Drafts do
not contribute to submission metrics or calendar events. Prepare gives Resume and Cover Letter matching material cards, each
with its own named-variant selector and Include toggle. Resume starts included
and Cover Letter starts excluded. Starting Polish for a document turns on that
document's Include toggle without changing the sibling material; an enabled
automatic proposal does the same when it starts. A fresh Apply creates one
tracked application; opening a stored application exposes Update application, which
preserves its identity, original application date, and current stage. Job
matching never chooses between those write paths. Each path stores only
included, ready materials and supports a tracker-only commit with both cards
excluded. On a later update, an excluded slot is left untouched so a
previously saved artifact is never deleted or replaced implicitly. The resume
and cover letter keep independent
saved/unsaved states and an explicit "Update application" action in their own
Save menus that rewrites only that document. Regenerating or editing a document
never rewrites a stored one. An application keeps one space-efficient
representation of each document:
editable `.resume`/`.cover` source for documents saved from RoleFit, or the PDF
when the user explicitly uploads one. Its Documents tab groups the immutable
job posting, resume, and cover letter as primary artifacts, previews or downloads
the portable document forms, and accepts additional PDF files the posting asked
for. Job-posting and PDF viewers share zoom controls and keyboard shortcuts. Tracker
text and analytics projections never count as a saved document and cannot
reload or overwrite the strict source.
Once Apply confirms the strict editable source for an included document, that
exact editor revision is durable and no longer triggers a close-tab warning.
Later edits reactivate protection, and a failed or still-pending source save
keeps it active. Post-save PDF export is recoverable from the document menu and
does not keep an already-saved application unload-guarded. A dirty document the
user excluded from Apply also releases after the application commits and its
exact recovery write succeeds; a later edit warns only until its replacement
recovery write succeeds.
Duplicate matching is advisory and relational. Before AI work, an exact prior
application or Skipped decision can be opened or continued as a new preparation;
high/possible matches ask whether to link or keep the records separate. A Keep
separate decision persists on both eventual records
so the same pair is not suggested again. Continuing new work preserves every attempt and links the
eventual new record to the matching posting group. It never overwrites or merges
the prior application. Destructive merge remains a separate confirmed tracker
cleanup action. The tracker keeps related decisions and attempts as independent
rows, marks each with the posting-group size, and lists the other histories in
the selected record inspector and Application Detail. The inspector is a
read-only summary aligned with Application Detail: stage and governing date,
key dates, the posting's own ID read from the saved posting text or a saved
link, Source provenance, categorical Fit verdict and rationale, always-
present Job activity, and the saved job posting/resume/cover/additional-document
packet. Field edits open Application Detail or Prepare; the row menu retains
quick stage movement. Mark as unrelated detaches
one record atomically without deleting either history. Tracker search defaults
to visible application identity — company, role/title, and posting ID — and
orders active-query table results by exact company, company prefix, posting ID,
company substring, then role/title relevance before the selected column sort.
Descriptions and notes are excluded; Table and Calendar share the same field
contract. The desktop search, lifecycle filter, and Table/Calendar controls
share one height and top alignment. Table pagination remains present for empty
result sets so the table workspace and inspector rail retain stable vertical
bounds. Merge accidental duplicate
keeps the current record only after a destructive confirmation. A Skipped
decision uses its decision date for tracker chronology and appears in All,
Inactive, and Skipped filters, but it never contributes to submitted counts,
submitted-month history, follow-up hygiene, or calendar submission events.
Prepare also offers a quiet **Skip & save job** action beneath Apply for fresh
work. It saves the posting as **Skipped**, with an
optional reason and short note, without recording an application date or sent
documents or additional application uploads. This job-only decision does not
require a resume, cover letter, Fit
Assessment, provider, or Apply readiness. Encountering the same posting again
can update that decision's date, reason, note, and job snapshot while preserving
its id and creation date. Opening the saved decision later is update-only:
**Save job updates** refreshes job facts but preserves the original decision,
and reconsidering the role creates a separate linked application attempt.
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
runs after Prepare when automatic assessment is on (the default); otherwise the
user starts it with **Assess fit**. The user may reassess at any time afterward.
Each result describes demonstrated fit in the selected resume at the time of
that run; it does not predict hiring, rewrite the resume, or substitute for the
user's judgment. Its four verdicts mean:

- **Strong:** explicit evidence covers most main responsibilities and core
  qualifications with no major material gap.
- **Reasonable:** explicit evidence covers most main responsibilities, with one
  or two material core gaps and a credible path to perform the role.
- **Stretch:** relevant overlap exists, but several important gaps remain or
  the core experience is mainly transferable rather than direct.
- **Limited:** the supplied evidence shows little relevant foundation for the
  role's main work and core qualifications, directly or through meaningful
  transferable experience. Generic skills or interest alone are insufficient.

Before choosing a verdict, Fit Assessment separates main responsibilities and
core qualifications from preferred items, logistics, benefits, and application-
form or administrative text. The verdict and bounded findings prioritize the
most decision-critical evidence rather than whichever excerpt appears first.
Evidence-source boundaries remain explicit: academic, personal, volunteer, or
open-source work does not satisfy an explicitly professional, paid, commercial,
requirement unless the posting accepts that source. Production describes deployment,
so a real personal production deployment can satisfy a source-neutral deployment requirement. Experience
categories are never summed, and role or project counts never imply duration.
A posting with no substantive responsibilities or qualifications yields Insufficient job information
instead of a fit inferred from its title or application form. At the Limited/
Stretch boundary only, meaningful direct evidence for supporting core work stays
Stretch when the role-defining specialization is unshown. Meaningful transferable
core experience can also support Stretch; lacking a direct match alone does not
make it Limited. Neither allowance raises a case to Reasonable or Strong. Before returning,
the provider must re-check that every finding is copied exactly from its source.
The server retains otherwise usable findings with unconfirmed-source or
evidence warnings when those checks fail. It does not invent a located source
or silently rewrite the verdict or eligibility conclusion.

Prepare shows the verdict, summary, last-assessed time,
resolved provider/model/reasoning attribution, rubric version, and at most three
direct matches and three not-shown gaps. Findings retain their returned posting
and candidate excerpts; unlocated or missing references are labelled unconfirmed.
The prompt requires direct support for Strong/Reasonable and permits relevant
transferable evidence beside a gap for Stretch. A usable conclusion that lacks
that support remains visible with a warning, not a different server verdict.
Missing evidence is not proof of incapability. Source checks flag exact-excerpt
and explicit-conflict concerns without a hidden requirement ledger or scoring.
As an advisory assessment,
Fit leaves technology coverage and strength of experience to the model; genuine
citations do not guarantee an accurate judgment. Evidence concerns follow the
system-wide warning policy; unsafe operations and unusable response structures
remain blocking. The result has no numeric score, confidence, visible
requirement ledger, recommendation, or analytics role, and it never silently
controls tracker state or workflow. Technically unusable provider output becomes
unavailable rather than a guessed result; the deterministic local job brief
remains editable and manual Polish remains available.

Settings > Profile may add optional candidate-declared education and
scheduling facts: a 4.0-scale GPA attached to a declared education level, plus
an earliest start of immediately, one to four weeks' notice, or a specific
date. Citizenship, U.S. work authorization, and sponsorship are three
independent declarations; each defaults to Not specified, and citizenship
never implies either employment answer or clearance eligibility.
Settings > **Background** is one free-text field for experience beyond, or in more depth
than, the resume, organised by headings that name each role or project with its
type and dates (for example `## Slotwise (personal project, 2025–present)`). A
heading that uses the name shown on the resume links its text to that entry.
These are global facts, not user-authored fit labels: Fit Assessment decides
relevance per posting, does not sum overlapping entries, and never treats a
project count as elapsed time. When a posting explicitly requires professional,
industry, commercial, or paid experience, other sources do not satisfy that
requirement unless the posting says they may. Drafting preferences belong in
Guidance > Custom instructions, not in the Background.

Every stage that sends candidate context—Fit Assessment, Resume and cover-letter
Polish, application answers, and final review—receives the whole Background or
none of it. The Background shows a live count against one 12,000-character
limit (declared facts do not count); above it those stages decline with a
message naming the limit instead of sending a cut-down copy, and the saved text
is never shortened. Experience rows saved by earlier versions are converted
once into lines under `## Experience by type` at the end of the Background, with
every declared value kept.

A Background heading links the text beneath it to the one standard resume entry
whose title or subtitle it names (the employer, project, or role as written on
the resume), ignoring case, punctuation, and a trailing parenthesised type or
dates. A heading naming no entry, or several, stays unlinked. Every enclosing
heading must name the same entry or be a grouping heading such as `# Experience`
or one of the resume's section names; any other enclosing heading blocks links
beneath it; a grouping word never names an entry itself.

Settings > Background lists the open resume's standard entries (grouped by
resume section, each with its size or Add) and then Other notes — text above the
first heading and every note no entry owns, flagged only for a surprising
reason (two entries share the name, the heading sits under an unlinked heading,
or inside another entry's heading) — beside the selected note's editor. Every
note has a **Linked to** choice of the resume's entries or Not linked, so the
user links by choosing, not by typing a matching name. The choice is stored in
the heading text, because entry ids change on every open and the Background
serves every resume variant: choosing an entry rewrites only the heading's name
to one that links to it (its title, else its subtitle; an entry no name can
reach alone is offered disabled), keeping the heading's type and dates and the
note's text, and a note moved onto an entry with notes becomes its second note.
Not linked renames the note so it names no entry. On a linked note only **Type
and dates** and the notes are editable, and one line says Resume Polish uses
them for that entry; an unlinked note's heading is free text, but a name that
would link is not stored there — linking goes through Linked to. The entry's
current resume bullets sit folded beside its notes, and a Text view keeps the
whole Background editable as text. The stored Background stays one text:
editing a note rewrites only its lines, a new note is appended with the
entry's link name and the resume's dates, and removal asks once inline. A
rename, link change, or removal that would change how any other note links
(renaming `# Experience` would unlink every entry note beneath it) is refused
with a pointer to the Text view.
Without a real open resume the text field is the only view.
Profile rows list every whole heading linked to that entry, for example "From
Profile: Acme Corp (internship, 2024)", and every row on a standard entry
(experience, project, or any other dated entry) folds a collapsed **Show
evidence** section holding the entry's current bullets
and the linked Profile text the proposal was made from; reading a source is not
verification. Resume Polish may rewrite a linked entry's bullets from that text and
propose up to two new bullets at the end of the entry, and Profile-based rows
are labelled **Profile**. Accepting a new bullet inserts it; Undo removes exactly
that bullet. Another entry's linked text, and text above the first heading, are
never evidence for an experience or project entry; an edit that leans on them is
flagged before acceptance. Suggestions may quote the Profile and may point out a
Profile item that fits the posting but is not on the resume; they never edit.
Swapping resume content for Profile content, and removing or reordering whole
entries, is not part of Polish.

Polish may also propose cutting a project or experience bullet that does not
serve the posting, or reordering an entry's bullets to lead with the most
relevant evidence. It never removes an entry's last bullet, and never both
reorders an entry and cuts from it. The review groups rows as **Rewrite**,
**Add**, **Remove**, and **Reorder**; when more than one group is present, each
group has its own Accept and Discard beside the footer's Accept all / Discard
all. Undo restores a removed bullet in its original place and a reordered entry
in its original order.

Eligibility is separate from fit and never changes the verdict. **Clear** means
no stated employment-eligibility condition needs attention. **Check** means the
posting states a work-authorization, sponsorship/visa, clearance, or legal-work
condition the candidate should confirm. **Blocked** requires both an explicit
posting condition and an explicit conflicting candidate-context fact. Education,
skills, and experience are fit evidence, not eligibility. A returned Blocked
label without explicit conflicting posting and candidate facts located in the
supplied sources is downgraded to Check with a warning. A confirmed Blocked result stops automatic Polish; Check does not.
User-configured switches and verdict thresholds, provider readiness, and fresh
one-use preparation tokens also govern it. Neither eligibility uncertainty nor a
Blocked label disables manual actions.

Automatic Fit Assessment defaults on. Turning it off in Settings > Automation
stops only the automatic runs — after Prepare and after a selected-resume change —
and the automatic Polish that depends on them; **Assess fit** and **Reassess fit**
remain available. Fit Assessment owns provider, model, and reasoning settings
independently from Job analysis. Its first run shares Prepare's Job analysis
dispatch only when both stages resolve to the same request configuration;
otherwise Prepare commits Job analysis and starts a separate assessment-only
request. That first assessment remains part of the same Prepare transaction:
Stop, input replacement, and unload protection cover it, and Apply does not
become ready until its one-use automation decision settles. **Reassess fit**
always starts a new assessment without repeating Job
analysis, using the retained captured posting, current selected resume and
candidate context, and the Fit Assessment stage's selected provider, model,
reasoning effort, and rubric. With automatic assessment on, changing the
selected resume also reruns only Fit Assessment. Editing the displayed prepared
brief does not silently change the screened posting. A changed posting, authoritative resume, candidate context,
provider/model/reasoning setting, or prompt version makes the displayed result
out of date. Beginning, failing, or cancelling a later assessment never erases
the latest completed result. Prepare retains that timestamped
result as a clearly labeled previous preparation and lists which input groups changed — job posting, resume
content, Profile, or assessment setup — without presenting its verdict as
current. A successful reassessment supersedes that displayed result. Application
records retain the latest completed assessment snapshot rather than a versioned
assessment ledger. Apply saves that snapshot even when later input changes make
it historical or the resume artifact is excluded; a later update preserves the stored
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
   document-specific. The remaining workspaces are Answers, the Applications
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
   failure and cancellation identify the cause without changing the resume. The
   opt-in review keeps that one request and its outcomes; it only says when it
   held edits back or could not run.
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
    the same session-derived command and blocker model: Apply for fresh work,
    Update application for an explicitly restored submitted
    record, and Save job updates for an explicitly restored Skipped
    decision. The current job must be prepared and preparation for selected
    work must be idle. The tracker must finish its authoritative load, and new
    Apply or Skip actions refresh it before their final duplicate decision.
    Resume and Cover Letter
    each have an Include toggle; only included material must be ready, and both
    may be excluded. Resume defaults on and Cover Letter defaults off. Starting
    Polish for one document, manually or through its enabled automatic proposal,
    includes that document and leaves the other Include choice unchanged. A
    later update must preserve any previously saved artifact for an excluded
    slot.
    Skip & save job is a separate quiet rail action, never a masthead action. It
    requires only a completed prepared job and loaded tracker state; material,
    Fit, provider, and Apply blockers do not control that explicit decision.
    Fit Assessment follows the [user contract](#fit-assessment-user-contract): one
    compact advisory in the Application rail, no hidden score or replacement
    for human review. The bundled starter is sample content and never counts as
    a ready applicant resume.
    Application Detail uses Edit preparation for every stored record. It edits
    tracker facts and decision metadata,
    while prepared job data stays read-only and structured correction remains in
    Prepare. Its Overview, Prep, and Documents tabs keep saved facts,
    preparation notes/contacts/questions, and files distinct. Overview uses a
    wide working pane for editable status and timing controls followed by
    compact read-only Role & company, Job details, Compensation, and Job snapshot
    cards. Posting source remains visible as read-only provenance in Job details;
    structured corrections, including source, belong to Prepare. A 392px rail keeps Fit first and always shows Job activity directly below
    it, using an explicit empty state when no other saved record exists. Fit leads with a one-word categorical verdict
    and the summary in one two-column advisory block without repeating the assessed resume; it never uses a
    score, progress ring, confidence, or implied metric. Job snapshot is permanently expanded, shows no section count, and projects only the saved prepared brief into
    overview, responsibility, qualification, Benefits & policies, and signal groups; the
    immutable full source opens from Job snapshot or Documents in the same focus-managed,
    stacked viewer pattern as saved PDFs, where a bounded document panel keeps
    long text readable. A skipped record names its Skipped outcome,
    keeps its decision date in Key dates, and opens its reason and short decision
    note from the compact one-line `Skipped · reason` control in a headerless
    non-modal decision popover;
    general application notes remain independent data in Prep. Application
    Detail adopts newer tracker facts when its form is clean and pauses with an
    explicit reload choice when local and external field edits conflict.
    Update mode names the exact saved record persistently;
    a candidate source that appears materially different pauses before provider
    analysis and can proceed only as a new preparation. The Applications row
    menu groups Applied, Interviewing, and Offer as Active, and Skipped,
    Rejected, and Withdrawn as Inactive; users may move the same record between
    any of those stages. Moving an applied record to Skipped preserves its
    application date and saved materials. A Skipped record without an
    application date remains job-only and gains one only when moved to an
    active stage; stage changes never invent documents.
11. Preserve safe extension intake: a claimed extension posting requests
    AI-backed Job analysis and stops on Prepare; it never implicitly starts
    resume Polish. A failed analysis leaves the deterministic brief editable and
    manual Polish available. Every preparation resolves which resume it speaks
    for exactly once, before the provider request: it waits for the local
    workspace to finish loading, keeps a real current document (including an
    explicitly uploaded resume), and otherwise
    adopts the sole eligible saved variant or a meaningful unique winner while
    the editor is clean and not application-owned; that selection is not
    tailoring. A tie or incomplete comparison keeps the current selection.
    Candidate bytes, option metadata, the eligible set, and the live candidate
    revision form one resolution snapshot, so overwriting a saved variant under
    the same filename forces a fresh read. Stop, source replacement, application
    restore, and unmount cancel that resume resolution before it can adopt a
    document or start Fit Assessment. Cover Letter resolves once after the
    prepared brief is current: it waits for workspace startup, adopts the sole
    eligible letter or a meaningful unique winner, and preserves Prepare's
    output title. Body/style edits, application ownership, saves, manual
    selection, source replacement, and unmount cancel or preempt replacement.
    Settings > Automation **Prepare picks from** lists every saved resume and
    cover letter with a checkbox; the two lists are independent. Unchecked
    variants are never read, recommended, or adopted automatically, but still
    open by hand, and a manual choice wins. Newly saved variants start checked;
    a deleted or renamed variant drops out of the list without error, and a
    renamed one is eligible under its new name. With none checked, Prepare keeps
    the current document. Changing the lists while Prepare is choosing cancels
    that pick rather than adopting under the old lists. That eligibility list is
    the only persisted input; do not add other variant metadata or another
    document schema for this decision.
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
Prepare, navigation, Cover letter, Answers, Applications, and Analytics remain
available.

## Review final application

Prepare offers an optional **Review final application** action after readiness.
It reviews current included materials; pending proposals must be accepted first
to enter the review. Resume-only and cover-only applications are supported.
Excluded loaded resume evidence may support a letter, clearly labeled as evidence.
Missing source provenance is uncertainty, not verified support.

The action shows its independently configurable provider/model in Settings. It
copies Fit settings once at initialization and never runs automatically. Results
are bounded, source-linked, and session-only. Changes to materials, target, or
evidence mark relevant findings out of date; formatting preferences do not.
Failure and Stop retain incomplete/local findings and previous results. Findings
never change documents or block Apply. “No issues found in this review” is not a
guarantee of factual accuracy or application success.

Resume Polish retains Academic Projects as editable work while protecting degrees,
credential metadata, dates, and identity. All bounded targets compete for the prompt
budget; each selected entry is sent once with its target references, and omitted
counts are explicit. Legitimate role/project names such as Scrum Master or Degree
audit app remain editable. Optional Suggestions cite existing content
and the job and never reorder or remove content. Job analysis delegates wording
and qualification classification to the model without condition-review disclosures.
Cover-letter citations identify supplied
sources; they do not independently verify those sources. Ordinary paraphrases
never require hidden sentence records or literal wording checks. Editorial advice
may mention missing skills or suggest a bullet count without asserting those as
candidate facts. Actual edits retain factual safeguards.

## Resume entry rows

Standard resume entries support Add/Remove title and subtitle rows from the
right-click menu, including when targeting an entry's bullet. Each row includes
its left and right fields; Remove clears both and supports Undo. Enter at the
end of Title right adds or focuses Subtitle left. Backspace at the start of
Subtitle left removes the row only when both subtitle fields are empty, then
returns to Title right when available. Forward Delete is unchanged.

A fully empty entry remains recoverable from the containing section's
`Empty entry N` context submenu. Row absence persists in `.resume` and removes
its space from editor, print, and PDF output. Existing resumes retain their
appearance; older builds reject newly saved files with removed rows. These
controls do not apply to section headings, Skills, Summary, or cover letters.

Long title/subtitle values wrap within their paired row. Names and individual
contact values wrap inside the document margins in both Resume and Cover letter.
Continuations preserve text, formatting, links, and existing editing commands;
oversized heading groups can continue on the next page. Fitting paired rows
retain their existing layout. Resume and Cover letter header baselines stay
fixed when typing different letter shapes at the same font, size and wrap count,
including typing the first character into an empty name.

Section titles also wrap inside the text margins. Their alignment and heading
case are preserved; one section rule follows the final continuation, and tall
headings can continue onto another page without changing saved text.
