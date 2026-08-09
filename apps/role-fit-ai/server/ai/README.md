# RoleFit AI Provider Runtime

This directory owns provider dispatch, prompts, response parsing, grounding, and
sanitization for RoleFit's AI stages. The broader loopback and trust boundary is
documented in [`docs/engineering/ai-server.md`](../../docs/engineering/ai-server.md),
and contributor rules live in [`AGENTS.md`](AGENTS.md).

## Initial Fit technical contract

This section is the canonical technical specification for Initial Fit. User-
visible verdict, eligibility, and automation behavior lives in
[`PRODUCT.md`](../../PRODUCT.md#initial-fit-user-contract). The executable prompt
source is `QUICK_FIT_RULES` in [`quickFit.ts`](quickFit.ts).

### Prompt and provider paths

When Initial Fit is enabled and a selected resume is usable, the normal Job
analysis dispatch requests an independent `initialFit` subsection. Fit-only
Retry uses `mode: "initial-fit"` on the same `/api/job-analysis` route and the
same exported system-level rules block. When evidence genuinely falls between
adjacent categories, the rules choose the lower category unless direct candidate
evidence supports the higher. Transferable evidence may inform the verdict but
cannot support a direct match; one posting excerpt cannot be both a match and a
gap, and overlapping excerpts cannot count one missing need twice.

The provider selects the verdict before assessing eligibility. Eligibility is
limited to work authorization, sponsorship/visa, clearance, or legal ability to
take the role—not education, skills, or experience—and never changes the
verdict.

### Structured output and grounding

The response contains one verdict, up to three matches with exact posting and
resume/candidate-context excerpts, up to three `NOT_SHOWN` gaps with exact
posting excerpts, and at most one eligibility result. `CHECK` requires an exact
posting condition; `BLOCKED` additionally requires an exact conflicting
candidate-context fact. The accepted verdict maps to fixed public summary copy;
model-authored summary text is not part of the wire contract.

`quickFit.ts` validates only shape, enums, bounds, deduplication, and exact
excerpts from the same normalized, clipped sources the provider received. It
does not select requirements, recalculate semantic coverage, parse degree or
years equivalence, run a broad eligibility classifier, or derive a verdict.
Unusable output becomes unavailable rather than guessed.

### Request identity and lifecycle

The client retains the normalized captured posting as `screeningJobText` for
combined Prepare, fit-only Retry, provenance, and staleness. Editing the displayed
prepared brief does not replace it. Provenance fingerprints that posting, the
authoritative resume, candidate context, provider, model, reasoning effort, and
prompt version. An unchanged successful result is reused; changed semantic
inputs or a prior failure dispatch again. Retry reads the same prepared-resume
owner as Prepare, rejects starter/stub/blank-origin editor text, and remains
available from the prepared-job receipt across a setting toggle.

Job analysis and Initial Fit sanitize independently in both directions: the
server preserves valid job fields when fit is absent or invalid, and the client
preserves a valid fit when Job analysis falls back to the deterministic local
brief. `src/lib/aiJobAnalysis.ts` owns the single browser request boundary;
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
