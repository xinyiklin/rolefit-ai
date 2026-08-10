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
adjacent categories, the rules choose the lower category unless direct candidate
evidence supports the higher. Transferable evidence may inform the verdict but
cannot support a direct match; one posting excerpt cannot be both a match and a
gap, and overlapping excerpts cannot count one missing need twice. Candidate-
declared experience categories retain their evidence source: professional or
industry requirements are not satisfied by academic, personal, volunteer, or
open-source work unless the posting accepts those sources. Categories may
overlap, so their years/counts are never summed and counts never imply duration.
Rubric v3 first separates main responsibilities and core qualifications from
preferred items, logistics, and administrative/form noise, then selects the most
decision-relevant findings. Existing source and overlap boundaries still prevent
project evidence from satisfying an explicitly professional source, prevent
experience categories from being summed, and prevent role/project counts from
implying duration. A posting without substantive role content returns `LIMITED`
rather than inferring fit from its title. At the Limited/Stretch boundary,
meaningful direct supporting-core evidence stays Stretch when the role-defining
specialization is unshown; that narrow rule never promotes a case to Reasonable
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
are trimmed at their outer boundary but never whitespace-rewritten. Every
non-`LIMITED` verdict requires at least one accepted match. `CHECK` requires an
exact posting condition; `BLOCKED` additionally requires an exact conflicting
candidate-context fact, and both accepted anchors remain in the response. The
accepted verdict maps to fixed public summary copy; model-authored summary text
is not part of the wire contract.

`fitAssessment.ts` validates only shape, enums, bounds, deduplication, and exact
excerpts from the same normalized, clipped sources the provider received. It
does not select requirements, recalculate semantic coverage, parse degree or
years equivalence, run a broad eligibility classifier, or derive a verdict.
Unusable output becomes unavailable rather than guessed.

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

### Security and verification

The route remains behind the localhost CSRF/Host guard. `.env` keys stay server-
side; a menu-entered key reaches the route only in that transient request and is
never returned. A successful response echoes the resolved `provider`, `model`,
`reasoningEffort`, and dispatch `attempts`, never `apiKey`, so the client can
record which model produced the brief.

Required offline and opt-in live checks are listed in
[`docs/engineering/testing.md`](../../docs/engineering/testing.md) and the scoped
[`AGENTS.md`](AGENTS.md).
