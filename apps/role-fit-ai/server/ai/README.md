# RoleFit AI Provider Runtime

This directory owns provider dispatch, prompts, response parsing, grounding, and
sanitization for RoleFit's AI stages. The broader loopback and trust boundary is
documented in [`docs/engineering/ai-server.md`](../../docs/engineering/ai-server.md),
and contributor rules live in [`AGENTS.md`](AGENTS.md).

## Fit Assessment technical contract

This section is the canonical technical specification for Fit Assessment. User-
visible verdict, eligibility, and automation behavior lives in
[`PRODUCT.md`](../../PRODUCT.md#fit-assessment-user-contract). The executable prompt
source is `FIT_ASSESSMENT_RULES` in [`fitAssessment.ts`](fitAssessment.ts).

### Prompt and provider paths

When Fit Assessment is enabled and a selected resume is usable, the normal Job
analysis dispatch requests an independent `fitAssessment` subsection. The
**Reassess fit** action uses `mode: "fit-assessment"` on the same
`/api/job-analysis` route and the same exported system-level rules block, but
does not repeat Job analysis. When evidence genuinely falls between
adjacent categories, the rules choose the lower category unless candidate evidence
meets the higher category's definition. Stretch may rely on meaningful transferable
core evidence; generic skills or interest alone are insufficient. Transferable evidence may inform the verdict but
cannot support a direct match; one posting excerpt cannot be both a match and a
gap, and overlapping excerpts cannot count one missing need twice. Candidate-
declared experience categories retain their evidence source: professional or
industry requirements are not satisfied by academic, personal, volunteer, or
open-source work unless the posting accepts those sources. Categories may
overlap, so their years/counts are never summed and counts never imply duration.
Rubric v5 first separates main responsibilities and core qualifications from
preferred items, logistics, and administrative/form noise, then selects the most
decision-relevant findings. Existing source and overlap boundaries still prevent
project evidence from satisfying an explicitly professional source, prevent
experience categories from being summed, and prevent role/project counts from
implying duration. A posting without substantive role content returns `INSUFFICIENT_JOB_INFORMATION`
without a verdict. Existing snapshots without a status remain readable as ASSESSED. At the Limited/Stretch boundary,
meaningful direct supporting-core evidence stays Stretch when the role-defining
specialization is unshown. Meaningful transferable core evidence can also support
Stretch without a direct match; neither allowance promotes a case to Reasonable
or Strong. Before returning JSON, the provider self-checks every evidence excerpt
character-for-character; the server remains
the fail-closed authority for exact anchors, duplicates, and list bounds.

The provider selects the verdict before assessing eligibility. Eligibility is
limited to work authorization, sponsorship/visa, clearance, or legal ability to
take the role—not education, skills, or experience—and never changes the
verdict.

### Structured output and grounding

The response contains one verdict, up to three matches with exact posting and
resume/candidate-context excerpts, up to three `NOT_SHOWN` gaps with exact
posting excerpts, and at most one eligibility result. The server retains both
sides of each accepted match so the UI can show why it counts; exact excerpts
are trimmed at their outer boundary but never whitespace-rewritten. `STRONG` and `REASONABLE` require at least one accepted direct match. `STRETCH`
may instead cite transferable candidate evidence in a gap; when it has no direct
matches, at least one affirmative transferable citation is required. All excerpts
are bounded to 500 characters and optional notes to 240. The prompt states these
same limits and shows `{"status":"INSUFFICIENT_JOB_INFORMATION"}` separately from
the assessed result. In combined Job analysis, that compact object is the
`fitAssessment` value and does not replace the independent job object. `CHECK` requires an
exact posting condition; `BLOCKED` additionally requires an exact conflicting
candidate-context fact, and both accepted anchors remain in the response. The
accepted verdict maps to fixed public summary copy; model-authored summary text
is not part of the wire contract.

`fitAssessment.ts` validates the compact response and source excerpts. Rubric v5
removes the transient requirement ledger, posting-completeness gate, and
match-count verdict calculation introduced in v4. The model judges materiality,
paraphrases, durations, and alternatives. Code checks exact anchors, list bounds,
duplicates, and focused explicit conflicts such as denied or aspirational evidence,
unshown named tools, increased ownership, or clearly personal work cited for an
explicitly professional requirement. These guards do not prove semantic entailment
or hiring accuracy. Production is a deployment environment, not employment.
Personal production deployments can support source-neutral deployment work.

Transferable displayed gaps may include compact candidate-source
metadata. Missing or malformed optional metadata is omitted without dropping the
gap. `BLOCKED` eligibility needs an explicit related conflict; other exact-anchored
conditions become `CHECK` without discarding the independent Fit verdict.
Malformed required evidence or input beyond prompt bounds yields a specific,
privacy-safe failure message, never a guessed verdict. Legacy snapshots retain
their original prompt provenance and are not revalidated as v5.

Prompt clarifications and bug fixes that preserve the assessment criteria and
accepted output contract remain on v5. A new rubric version is warranted for a
material change to verdict meanings, evidence policy, or output contract; ordinary
implementation changes use Git history. Preserve historical version labels rather
than reusing them. The v5 clarification reconciles Limited and the adjacent-category
tie-breaker with Stretch's existing allowance for meaningful transferable evidence.

### Request identity and lifecycle

The client retains the normalized captured posting as `screeningJobText` for
combined Prepare, reassessment, provenance, and staleness. Editing the displayed
prepared brief does not replace it. Provenance fingerprints that posting, the
authoritative resume, candidate context, provider, model, reasoning effort, and
prompt version. An explicit reassessment always dispatches again, even when the
inputs are unchanged. It reads the same prepared-resume owner as Prepare,
rejects starter/stub/blank-origin editor text, and remains available from the
prepared-job receipt across a setting toggle. The accepted client snapshot adds
its completion time plus provider, model, reasoning effort, and prompt/rubric
version. The accepted snapshot records the server-resolved provider, model,
reasoning effort, and dispatch-attempt count while provenance continues to
identify the configuration that requested the work. Tracker persistence keeps
that bounded attribution with the result.

Job analysis and Fit Assessment own independent stage configurations. Prepare
uses the combined response shape only when both resolved provider/model/reasoning
triples match exactly. If any field differs, it sends Job analysis without resume
or candidate context, commits the prepared brief, then dispatches
`mode: "fit-assessment"` with Fit Assessment's configuration. Reassessment always
uses that assessment-only path.

Job analysis and Fit Assessment sanitize independently in both directions: the
server preserves valid job fields when fit is absent or invalid, and the client
preserves a valid fit when Job analysis falls back to the deterministic local
brief. `src/lib/aiJobAnalysis.ts` owns the browser request boundary for combined
and assessment-only calls;
`src/hooks/useJobIntake.ts` owns one ready/unavailable fit settlement boundary
and one shared URL/paste/extension/Retry post-acquisition coordinator.
Rejected Fit responses carry an optional, fixed-copy `fitAssessmentError` through
both paths. The current session shows that reason instead of discarding it for
a generic message. It contains no provider prose or source excerpts and is not
saved in an assessment snapshot. Evidence rejection remains advisory and never
creates a verdict or starts automatic Polish.

### Security and verification

The route remains behind the localhost CSRF/Host guard. `.env` keys stay server-
side; a menu-entered key reaches the route only in that transient request and is
never returned. A successful response echoes the resolved `provider`, `model`,
`reasoningEffort`, and dispatch `attempts`, never `apiKey`, so the client can
record which model produced the brief.

Required offline and opt-in live checks are listed in
[`docs/engineering/testing.md`](../../docs/engineering/testing.md) and the scoped
[`AGENTS.md`](AGENTS.md).

The 2026-09-08 v5 boundary comparison used eight synthetic cases with independently
agent-authored expectations fixed before output, three repetitions per wording,
Codex CLI / GPT-5.6 Sol / medium, and no unreadable-output retries. All 24 baseline
and 24 clarified-prompt results validated and met their allowed outcomes, with
identical verdicts across all paired runs. One case explicitly allowed either
Limited or Stretch. This supports removing the wording contradiction; it does
not demonstrate improved accuracy or human-adjudicated correctness. Exact prompt
hashes and synthetic receipts remain local; production rules match the evaluated
clarification's SHA-256 `8a39181f38b5844d59e71ec1e9a9b7e59d91a82631acf6657a86c30c331d5f76`.

Six combined-path validation cases repeated three times produced 18 valid results
and 17/18 agreement with the frozen expectations. One teaching-transfer result
was Reasonable rather than the expected Stretch, while retaining the required
adult-workplace experience as a gap. Independent review found no fabricated
evidence; the adjacent-verdict calibration remains uncertain. Three follow-up
baseline combined runs of that case all returned Stretch, compared with two of
three for the clarification. This small sample cannot establish the cause of the
disagreement or demonstrate that the clarification improves this boundary. Eligibility,
prompt-injection, accepted-project, duration-gap, and insufficient-information
controls behaved as expected. No private application materials were used.

## Final application review

POST `/api/application-review` is explicit, advisory, session-only, and read-only.
It reads the current included document text and the retained posting/target,
with separately labeled original loaded-resume and candidate-context evidence.
An excluded loaded resume may support a cover-only review; an excluded letter
is not sent. Pending proposals and application answers are not inputs.

Local checks retain empty-material, placeholder, target, and narrow explicit
cross-document responsibility/date findings even when provider work fails.
One selected-provider request adds bounded source-linked findings. This route
disables unreadable-output retries; other stages retain their existing policy.
Invalid findings, missing provenance, overflow beyond 12 findings, and failed
requests cannot produce a complete review. Candidate revisions require candidate
sources; posting evidence supports employer facts. Current-document references
may identify conflicts but never independently establish truth. Recovery is editorial
advice, not replacement document text; numbers in instructions or references to
missing skills are not candidate claims. Explicit first-person candidate claims
still require supporting candidate evidence.

The `final-review` stage copies the current Fit configuration once when absent,
then persists independently. Exact serialized content/selection/settings identity
and a generation token protect completion. Findings track relevant dependencies;
provider findings conservatively depend on both documents. Applying/navigation,
source replacement, Stop, and unload invalidate in-flight work. Font/zoom/layout
preferences do not enter the content projection. No review result gates Apply,
accepts a proposal, or writes a saved document or tracker record. Placeholder
locations are detected once, and equivalent local/provider findings merge before
the 12-item display cap. Client and server enforce the same 400-item and
120,000-character evidence budget; oversized input is reported before dispatch,
never silently truncated. Individual result validation does not rerun local review.

## Evidence and evaluation boundaries

Numeric support retains count objects, measurement units, rates, and experience
source. Percentages use local clauses, and recognized count units permit modifiers
without borrowing a noun across a preposition or conjunction. These bounded guards
are not a general parser. Explicit experience denial or learning intent cannot
authorize new skills; unrelated reliability negation does not remove experience.
Extracted job conditions retain source wording when a qualifier, alternative, negation, or
number could change meaning. Classification concerns are advisory, including
explicit preferred wording in a required list; the original qualification wording remains visible. Words such as
must or bonus do not veto the model's duty classification;
ordinary duties retain concise model wording rather than duplicate whole clauses.
Cover-letter factual guards use paragraph-cited sources and explicitly named entry
identity in one typed factual pass; employer facts use the posting. Explicit prior
affiliations need candidate evidence, while generic acronyms are not employer names.
Neither letters nor Resume Polish require hidden sentence bindings or literal proof of paraphrases. Only explicit factual
conflicts, identity/format defects, and placeholders trigger withholding or repair.
Resume Polish protects actual education/credential records, enumerates all bounded
targets, and sends selected entry evidence once alongside target references. The
existing wider resume context still supports Skills and Summary. Optional structural
advice keeps bounded source references and never becomes a replacement.
Application-question behavior remains unchanged.

`evidence-policy-probes.mjs` reports synthetic label provenance, adversarial and
valid counts, false acceptance/rejection, and errors by dimension. Labels are
agent-authored and have no recorded human review. The cover-letter structural
score measures citation/shape/style checks only; it is not factual accuracy,
coverage, role relevance, or persuasiveness. Live evaluation remains opt-in.
