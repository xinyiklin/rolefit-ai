# Benchmark record and cost estimates

Recorded 2026-10-07. This is the aggregate ledger for the Prepare, Resume,
Cover and Answers evaluations. Detailed prompts, candidate documents, answers,
judgments and receipts remain ignored and local. Synthetic fixtures are tracked
where the corresponding evaluation supports them. The initial ledger used
existing receipts only; the explicitly requested single-sample follow-up below
made two additional generation calls, and the later 39-case Resume baseline is
listed under coverage gaps.

## Decisions and evidence

| Workflow | Current recommendation | Meaningful benchmark evidence | Limits |
| --- | --- | --- | --- |
| Prepare: Job analysis + Fit | Claude Sonnet 5.5 low, combined | 22 synthetic postings across five configurations; then 20 fresh postings × three repeats for Sonnet and the old Luna/GPT-5.5 split. Sonnet holdout: 4.9 s median versus 17.5 s, extraction 0.997 versus 0.993, zero fabricated terms in both. | Each setting had a Fit automation-flip group; synthetic labels are not human calibration. |
| Resume Polish | GPT-6.1 Sol medium (since 2026-10-07; previously Claude Opus 5.5 high) | Factual safety favors Sol. 2026-10-07 live baseline, 39 synthetic cases, corrected opportunity gates, Astra fact-checks: Sol 39/39 passed, 88 edits, 0 unsupported, 1 immaterial; Opus High 35/39, 103 edits, 3 unsupported (each merged separately listed facts into a new relationship), 3 immaterial, 1 tense flip; both met all five gated opportunity cases. 2026-10-05, 32 fresh real applications: Opus 2/99 edits unsupported, Sol 0/123. 2026-10-04 34-case eval: Sol passed all cases; Opus passed 63/68 trap checks, then 67/68 after the round-2 prompt. Writing quality favored Opus: on the 2026-10-04 22-application holdout (older prompt), Opus High beat Sol Medium 11–5 where Astra and Opus agreed (Astra alone 11–11, Opus judge 17–5); Opus High also beat Sonnet Medium 17–1 there. | A user-directed safety-first choice. One run per synthetic case; the only fact-check judge is Astra (OpenAI family, same vendor as Sol). The quality comparison predates the current prompt and its arm labels (`opus-high-space` vs `sol-medium`) suggest unmatched guidance. A paired real-application rerun on the current prompt is pending (deferred for Codex usage). Page count is not materiality or a factuality score. |
| Cover Polish | GPT-6.1 Sol medium, existing prompt | 40 tuning applications plus 20 holdouts, sentence fact-checking and blinded Astra/Opus pairwise judging. On the 40-case same-prompt comparison, Sol beat Sonnet 25–2 and Opus 16–0 where both judges agreed. | Model judges disagreed on some comparisons. Claude-specific prompt gains did not transfer to Sol, so the shared prompt was retained. |
| Answers | Claude Opus 5.5 high; GPT-6.1 Sol medium as OpenAI alternative | 57 synthetic cases × nine settings, 513 completed answers; 38 fresh cases and 19 regressions. Astra High and Opus High agreed the rubric before independent judging. | Opus High's fresh mean lead over Medium was only 0.67/100. Astra slightly preferred Sol Medium to Opus High; Opus preferred Opus High. One sample per case, no human calibration. |
| Final review | Claude Sonnet 5.5 low | Retained user preference. | No comparative benchmark supporting a winner. |

The matched Prepare downstream check used ten real applications, both brief
sources, the same Resume/Cover generators and two blinded judges. Resume
preferences split 5–5; Cover preferences differed between judges. It did not
establish a downstream quality advantage for the slower Prepare setup.

Resume/Cover use private application corpora; only aggregate findings belong
here. Their experiment history is retained in the dated root
[continuity record](../../../../CONTINUITY.md). The current tracked Resume
regression corpus has 39 cases; that is not the sample size of every historical
run. Commands, gates and reporting contracts are in [Testing](testing.md).

## Expanded Answers record

Prompt `application-answer-conversation-v3` was frozen. The nine settings were
Opus 5.5, Sonnet 5.5 and GPT-6.1 Sol at Low, Medium and High. The judges made
five real discussion/approval calls and both approved
`senior-recruiter-consensus-v1` before grading. The approved rubric's SHA-256 is
`ed4a7d89efff14fd0bf1a44ef0eb2334ddb347b5abe5400735691885b9d6ce69`.

Weights: tone/naturalness 25%, evidence/specificity 25%, clarity/readability
20%, instructions 15%, economy 15%. Cliches, unnecessary additions/removals
and padding affect the relevant dimensions. A Profile/resume is incomplete:
ordinary interests, modest learning and reasonable interpretation need not be
verbatim facts. Concrete achievements still need support or confirmation;
absence from the record is not proof of absence or dishonesty.

Execution: 519 generation requests including six repairs; 114 valid judging
passes, 1,026 ratings and 116 recorded judging attempts. The recovered pass
retains two failed attempts and unknown cumulative usage. All 16 source hashes
matched. Mechanical checks passed 1,088/1,090, including every exact-answer
and protected-text check. Sonnet Low/High failed the missing-certification
clarification. Sol High separately over-clarified an answerable statement.
No judge's material-risk flag was raised, which does not certify all claims.

[Scores, all five dimensions, timings and qualitative findings](testing.md#2026-10-07-expanded-comparison-and-current-selection)
remain the detailed result record. The prompt was not retuned on the 38 fresh
cases. The default and saved current selection were updated to Opus High;
further prompt tuning needs new acceptance cases.

## What the dollar amounts mean

All amounts are USD. A **task** below means one answer generation (including
its bounded repair) or one combined Prepare operation (including retries).
A **benchmark run** also includes the separate grading, fact-checking,
comparison and consensus requests specified by that experiment. A whole
application session may contain several tasks and follow-ups.

- **Reported estimate:** the CLI's saved `costUsd`, summed without repricing.
  This is usage valuation, not an observed invoice or an extra subscription
  charge. Actual cash cost and remaining plan allowance cannot be derived from
  these receipts.
- **API equivalent:** the recorded token counts priced at current Standard API
  rates. The range uses five-minute versus one-hour cache writes because the
  normalized receipts do not retain cache duration. It is a scenario range,
  not a confidence interval or a bound on an invoice. The recorded Claude
  estimates match the one-hour scenario for the inspected runs.
- **Unknown:** missing usage is neither zero nor a number inferred from answer
  length. The historical Codex usage is absent or lacks an input/output/cache
  breakdown. Hidden reasoning cannot be reconstructed from the final answer.
  Older private Resume/Cover harnesses did not save usage counts.

API equivalents include the recorded CLI prompt overhead. A direct API
integration, different context sizes, caching, service tier, region, retries or
conversation history can change the cost. No subscription fee allocation,
computer/electricity cost, development chat, browser QA or reviewer-agent cost
is included. Rates are a 2026-10-07 snapshot, not a historical price claim.
The later single-sample receipt retains raw numeric usage details, including
cache duration/writes, so its estimates do not need the older cache scenarios.

## Estimated cost per task

Generation only; benchmark judges are excluded. All 57 expanded Answers cases
are included in each mean, including clarifications and refinement requests.
These are observed workload averages, not a quote for every new question.

| Workflow / setting | Tasks | Recorded requests | Reported estimate / task | API equivalent / task |
| --- | ---: | ---: | ---: | ---: |
| Prepare — Sonnet 5.5 low, fresh holdout | 60 | 61 | $0.0323 | $0.0227–$0.0323 |
| Answers — Opus 5.5 low | 57 | 59 | $0.0428 | $0.0292–$0.0428 |
| Answers — Opus 5.5 medium | 57 | 58 | $0.0492 | $0.0359–$0.0492 |
| Answers — Opus 5.5 high | 57 | 57 | $0.0525 | $0.0394–$0.0525 |
| Answers — GPT-6.1 Sol low | 57 | 57 | Unknown | Unknown |
| Answers — GPT-6.1 Sol medium | 57 | 57 | Unknown | Unknown |
| Answers — GPT-6.1 Sol high | 57 | 57 | Unknown | Unknown |
| Answers — Sonnet 5.5 low | 57 | 58 | $0.0199 | $0.0133–$0.0199 |
| Answers — Sonnet 5.5 medium | 57 | 58 | $0.0202 | $0.0135–$0.0202 |
| Answers — Sonnet 5.5 high | 57 | 58 | $0.0232 | $0.0165–$0.0232 |
| Resume Polish — Opus 5.5 high (default until 2026-10-07) | Historical corpora | Not reconstructed | Unknown | Unknown |
| Resume Polish — GPT-6.1 Sol medium | 39-case baseline | Not retained | Unknown | Unknown |
| Cover Polish — GPT-6.1 Sol medium | Historical corpora | Not reconstructed | Unknown | Unknown |

At the current defaults, **Prepare + one Answer has a measured partial average
of $0.0848** (about 8.48 cents), excluding Resume, Cover, Final review and
additional answers. The corresponding API scenario is $0.0622–$0.0848. A full
application session total is unknown. Sonnet is cheaper on these recorded
Answers workloads, but the writing/evidence results did not justify changing
the quality-first recommendation. There is no measured OpenAI cost comparison
for the historical Answers runs.

### Single-sample Resume and Cover follow-up

On 2026-10-07 the user requested one sample of each. Both used the production
prompt, workflow and validators with existing synthetic fixtures and the
then-recommended models (Resume: Opus 5.5 high, replaced 2026-10-07). Neither changed user documents or saved settings. The local
observer captured Claude's numeric JSON envelope and added Codex's `--json`
telemetry flag in memory; no production source file was edited. No judge was
called, and there were exactly two successful CLI requests, with no retries or
format repairs.

| Sample | Input tokens, including cache | Cache-read / cache-write tokens | Output tokens, including reasoning | Elapsed | CLI reported estimate | Standard API equivalent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Resume Polish — Opus 5.5 high | 9,319 | 540 / 8,777 | 2,607 | 26.47 s | $0.122472 | $0.122472 |
| Cover Polish — GPT-6.1 Sol medium | 19,631 | 7,168 / 0 | 492 | 22.59 s | Not reported | $0.0305628 |

The combined Standard API equivalent is **$0.1530348**, about **15.30 cents**.
It reflects the former Opus Resume default, not the current Sol default, whose
cost is unmeasured.
Resume's cache writes were explicitly one-hour writes. Its calculation is
`(2 × 4 + 540 × 0.20 + 8,777 × 8 + 2,607 × 20) / 1,000,000`.
Cover's is
`(12,463 × 2 + 7,168 × 0.10 + 0 × 2.50 + 492 × 10) / 1,000,000`.
The 1,604 Claude thinking tokens and 198 Codex reasoning tokens are subsets of
output, not additional billable counts. See
[OpenAI usage accounting](https://developers.openai.com/api/docs/guides/agents-api/observability#model-usage-and-cost).
The Codex receipt reports zero cache writes; a cache-write assumption was not
needed. Standard API prices are a comparison basis, not proof of the CLI's
actual billing tier or an extra subscription charge.

This is **one sample per workflow, not a production average or a new quality
benchmark**. Resume used `backend-platform` (1,248-character normalized scope)
and returned four proposed changes, passing its deterministic traps. Cover used
`base-variant-general-full-stack` (405-character source letter), producing a
143-word letter with one length warning and no content concerns. Factual quality
was not independently judged. Full personal contexts, longer letters and later
revisions can cost more or less; the models' input totals also include their
different CLI overheads and are not a matched token-efficiency comparison.

The ignored receipt is identified by `polish-cost-sample-20261007/run-rhLg5f`;
it retains the manifest, nine unchanged source hashes, result summaries, numeric
dispatch usage and exact decimal calculations. It does not recover or replace
the unknown costs of the older Resume/Cover experiments. The historical
$35.7473 subtotal below is unchanged; these two samples are reported separately.

## Cost of the benchmark runs

**Known subtotals below must not be read as complete costs.** Coverage counts
usage entries with a numeric cost: one answer/judge result for Answers and one
dispatch entry for Prepare. An entry can include several attempts. Duplicate per-case files, collection
files, archived failures and report-only replays are not counted twice.

### Answers, 2026-10-07

| Experiment | Generation requests | Judge requests | Known generation estimate | Known judge estimate | Known subtotal | Cost coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial six-setting screen, 12 cases | 74 | 24 | $1.4725 | $0.6955 | $2.1680 | 48/96 records |
| Low–High screen, v1, 12 cases | 73 | 24 | $1.8755 | $0.6738 | $2.5493 | 48/96 records |
| Low–High screen, v2, 12 cases | 72 | 24 | $1.8975 | $0.5933 | $2.4907 | 48/96 records |
| Low–High screen, v3, 12 cases | 72 | 24 | $1.8774 | $0.5994 | $2.4768 | 48/96 records |
| Paired v2/v3 grading, saved answers reused | 0 | 24 | $0 | $0.8497 | $0.8497 | 12/24 records |
| Seven-case v3 holdout | 42 | 14 | $0.9395 | $0.3198 | $1.2593 | 28/56 records |
| Expanded 57-case round | 519 | 116 | $11.8481 | $5.8322 | $17.6803 | 398/627 records |
| Expanded judge discussion/approval | 0 | 5 | $0 | $0.1656 | $0.1656 | 2/5 records |

The expanded round plus consensus has a **$17.8460 known subtotal**, covering
400/632 saved records. Its full cost is unknown: all 171 Sol answer records,
57 Astra grading records, three Astra consensus calls and the recovered Opus
grading record lack complete usage. The recovered record represents three
attempts; its successful response does not make cumulative cost known.

The six Claude generation arms cost $2.4392 / $2.8063 / $2.9939 for Opus
Low/Medium/High and $1.1370 / $1.1511 / $1.3206 for Sonnet Low/Medium/High,
each covering 57 cases and its repairs. Total recorded Claude answer generation
is $11.8481; grading and consensus are separate overhead, not production
answer costs.

Local run IDs, in screen/v1/v2/v3/holdout/expanded order:
`2026-10-07T04-02-44-919Z-76wSjc`,
`2026-10-07T04-42-03-708Z-lr9x3E`,
`2026-10-07T04-51-07-007Z-EkLmrM`,
`2026-10-07T04-59-19-531Z-ceawL6`,
`2026-10-07T05-13-23-246Z-57k7Lm`,
`2026-10-07T11-38-53-153Z-PGsRGH`.
These IDs identify private receipts under `workspace/application-answer-eval/`;
they are not public artifact links.

### Prepare, 2026-10-06

| Experiment / path | Task results | Reported estimate | Mean / task | Coverage |
| --- | ---: | ---: | ---: | --- |
| Screen — Sonnet Low combined | 22 | $0.6810 | $0.0310 | Complete |
| Screen — Sonnet Medium combined | 22 | $0.7659 | $0.0348 | Complete |
| Screen — standalone Fit comparison, both Sonnet efforts | 44 | $1.1597 | $0.0264 | Complete |
| Screen — three Codex configurations, including standalone comparisons | 132 | Unknown | Unknown | No usable costs |
| Holdout — Sonnet Low combined | 60 | $1.9364 | $0.0323 | Complete |
| Holdout — Sonnet Low standalone Fit comparison | 60 | $1.5646 | $0.0261 | Complete |
| Holdout — Luna Medium + GPT-5.5 Medium split | 60 | Unknown | Unknown | No usable costs |
| Matched downstream check — ten applications, both brief sources, Resume/Cover and judges | Multiple stages | Unknown | Unknown | Usage not retained |

The Sonnet screen's full recorded benchmark estimate is **$2.6065**, and its
holdout is **$3.5010**, including standalone Fit comparisons. The commonly
quoted $0.6810 and $1.9364 cover only the combined Prepare path. The corrected
holdout split path has two calls per task. The earlier Codex screen also saved
standalone comparisons for the split configurations; those historical extra
calls stay in the cost inventory even though the current runner omits them.

Screen receipt IDs: `2026-10-06T20-24-25-015Z-ULyDK5` (Codex),
`2026-10-06T20-46-29-789Z-KQYc53` (Sonnet). Holdout:
`2026-10-06T21-23-44-031Z-BiozV8` (Sonnet),
`2026-10-06T21-26-39-060Z-QXGWYS` (Codex), under
`workspace/fit-assessment-eval/`.

### Older experiments and coverage gaps

The saved Resume prompt/effort, guidance, warning and slimming experiments
(`tailor-benchmark`), Cover prompt/base-letter/fact-check experiments
(`cover-benchmark`), matched downstream Prepare experiment, early private Fit
calibration, the v2/v3 Fit pilot/matrix/boundary experiments
(`fit-assessment-matrix`), initial Fit tests and early Tailor tests were inspected for numeric
usage fields. Their retained JSON does not contain input/output token counts or
provider dollar estimates. Their per-task and full-session costs are **unknown**.
Stored answer length, timing, file count and model name cannot recover hidden
reasoning, retries or cache behavior. File count is not a provider-call count.
The 2026-10-07 39-case Resume baseline (78 generations, 63 Astra fact-checks
across Opus 5.5 high and Sol 6.1 medium) retained no usage fields either.

Across the six Answers runs, paired grading, judge consensus and four Prepare
receipt directories, **$35.7473 is the known reported subtotal** for 840/1,600
usage entries (1,613 recorded attempts). It is not the total cost of all RoleFit
benchmarks. Missing OpenAI/recovery usage and older experiments are excluded.
The same 840 records have a Standard API cache-duration scenario of
$26.2102–$35.7473. No claim is made that this amount was billed separately.

## Pricing and calculation provenance

Current Standard rates per million tokens, checked 2026-10-07:

| Model | Fresh input | Cache read | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 | $4 | $0.20 | $5 (5m) / $8 (1h) | $20 |
| Claude Sonnet 5.5 | $2 | $0.20 | $2.50 (5m) / $4 (1h) | $10 |
| GPT-6.1 Sol | $2 | $0.10 | $2.50 | $10 |
| GPT-6 Astra | $10 | $1 | $12.50 | $50 |

Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[OpenAI Sol model pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[OpenAI Astra model pricing](https://developers.openai.com/api/docs/models/gpt-6-astra).
OpenAI rates are shown for reference; no missing usage was priced from them.

The existing `server/ai/providerUsage.ts` defines normalized input as fresh +
cache-read + cache-written tokens. Calculation therefore subtracts the two cache
subsets from total input, prices each category once, and adds output once.
Recorded output is used as supplied; no invented reasoning allowance is added.
For each task, sum actual recorded attempts first, then average across tasks.
Unknown inputs keep totals unknown; known subtotals are explicitly partial.

The local read-only reconciliation retained hashes of each cost source,
verified unique Answers result identities and the expanded 519/116 attempt
counts, and checked the category arithmetic. Raw receipts were not edited.
Future runs should retain usage, model, effort, cache breakdown/duration,
service tier and all attempts for generation and judges. This documentation
update does not change provider capture or promise universal CLI accounting.
