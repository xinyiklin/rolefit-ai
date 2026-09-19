# RoleFit AI Provider Runtime

This directory owns provider dispatch, prompts, response parsing, grounding, and
sanitization for RoleFit's AI stages. The broader loopback and trust boundary is
documented in [`docs/engineering/ai-server.md`](../../docs/engineering/ai-server.md),
and contributor rules live in [`AGENTS.md`](AGENTS.md).

## Content warning contract

The [product policy](../../PRODUCT.md#content-and-evidence-warning-policy) keeps
otherwise usable output with bounded warnings across server, client, and saved
receipts. Unconfirmed citations remain labelled as unconfirmed. Structure,
resource, authorization, mutation-target, and freshness protections remain blocking.
Generation instructions continue to require supplied facts and truthful attribution.

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
The rubric first separates main responsibilities and core qualifications from
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
character-for-character. The server warns on source/overlap concerns while
enforcing technical shape and resource limits.

The provider selects the verdict before assessing eligibility. Eligibility is
limited to work authorization, sponsorship/visa, clearance, or legal ability to
take the role—not education, skills, or experience—and never changes the
verdict.

### Structured output and grounding

The compact response retains one verdict, up to three matches, up to three
`NOT_SHOWN` gaps, and at most one eligibility result. Excerpts are bounded to
500 characters and optional notes to 240. Required enums, safe text, bounded
arrays, and usable structure are validated in both directions. The prompt asks
for exact posting and candidate excerpts, direct support for Strong/Reasonable,
and affirmative transferable support for Stretch without a direct match.

Source checks produce warnings for unlocated excerpts, repeated/overlapping
findings, explicit evidence conflicts, unsupported summaries, missing supporting
findings, and unclear eligibility conflicts. Safe prose and conclusions survive;
code does not change `BLOCKED` to `CHECK`, remove usable gap details, or replace a
usable model summary with fixed copy. Fixed summary copy remains the fallback
when no summary was supplied. Missing candidate citations remain visibly
unconfirmed. Located excerpts establish location, not semantic truth or hiring
accuracy. Invalid source navigation is unavailable without disabling use.

Fit v6 changes evidence handling and optional warning transport, not the rubric's
verdict meanings or scoring. The model still judges materiality, paraphrases,
durations, alternatives, and strength of experience. There is no requirement
ledger, posting-completeness gate, match-count score, or deterministic verdict.
Production describes a deployment environment, not professional employment.

Technically unusable responses and input beyond prompt bounds yield a specific,
privacy-safe failure, never a guessed verdict. Saved Fit/job receipts preserve
optional warnings. Legacy records retain their original provenance and remain
readable without implied verification. Older builds may reject newly saved
warning metadata; no downgrade guarantee is provided. Preserve historical prompt
versions. Future material evidence-policy or output-contract changes require new
provenance; implementation-only fixes use Git history.

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
saved in an assessment snapshot. These errors report technical failure. Usable
results carry content warnings and remain eligible for configured automatic
Polish under the existing thresholds and fresh preparation token.

### Security and verification

The route remains behind the localhost CSRF/Host guard. `.env` keys stay server-
side; a menu-entered key reaches the route only in that transient request and is
never returned. A successful response echoes the resolved `provider`, `model`,
`reasoningEffort`, and dispatch `attempts`, never `apiKey`, so the client can
record which model produced the brief.

Required offline and opt-in live checks are listed in
[`docs/engineering/testing.md`](../../docs/engineering/testing.md) and the scoped
[`AGENTS.md`](AGENTS.md).

The historical v5 receipts below predate the v6 warning policy and do not
validate its runtime behavior.

The 2026-09-08 v5 boundary comparison used eight synthetic cases with independently
agent-authored expectations fixed before output, three repetitions per wording,
Codex CLI / GPT-5.6 Sol / medium, and no unreadable-output retries. All 24 baseline
and 24 clarified-prompt results validated and met their allowed outcomes, with
identical verdicts across all paired runs. One case explicitly allowed either
Limited or Stretch. This supports removing the wording contradiction; it does
not demonstrate improved accuracy or human-adjudicated correctness. Exact prompt
hashes and synthetic receipts remain local; that historical evaluated prompt had
SHA-256 `8a39181f38b5844d59e71ec1e9a9b7e59d91a82631acf6657a86c30c331d5f76`.

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
Malformed findings, warnings, overflow beyond 12 findings, and failed requests
cannot produce a complete review. Safe findings with missing or unconfirmed
provenance remain visible with warnings, including their original messages and
recovery advice; source navigation is enabled only for located references.
Candidate revisions require candidate sources; posting evidence supports employer
facts. Current-document references
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
Neither letters nor Resume Polish require hidden sentence bindings or literal
proof of paraphrases. Explicit factual conflicts and safe placeholders produce
warnings. Only technical structure, identity, markup, and resource failures
withhold operations;
Cover may repair technically unusable output once.
Resume Polish protects actual education/credential records, enumerates all bounded
targets, and sends selected entry evidence once alongside target references. The
existing wider resume context still supports Skills and Summary. Optional structural
advice keeps bounded source references and never becomes a replacement.
Application answers and role descriptions preserve content concerns with item
warnings. Question/role identity binding stays strict, while a warned item does
not erase its usable siblings. Earlier Resume source uncertainty accompanies
Cover and answer requests/results without becoming fresh source verification.

`evidence-policy-probes.mjs` reports synthetic label provenance, adversarial and
valid counts, false acceptance/rejection, and errors by dimension. Labels are
agent-authored and have no recorded human review. The cover-letter structural
score measures citation/shape/style checks only; it is not factual accuracy,
coverage, role relevance, or persuasiveness. Live evaluation remains opt-in.
