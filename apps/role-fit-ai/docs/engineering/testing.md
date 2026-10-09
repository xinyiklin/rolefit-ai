# Testing

RoleFit AI testing should prove the changed behavior, protect API key
isolation, and avoid wasting time on broad checks when a targeted one
gives stronger feedback. The lightweight gates below are what the project
relies on. Run commands below from the repository root unless stated otherwise.
The RoleFit workspace's offline `node:test` suite runs the deterministic
AI-safety probes; the root `npm test` additionally runs package-owned evals.

The [benchmark ledger](benchmarks.md) records the Prepare, Resume, Cover and
Answers decisions together, including per-task cost estimates, benchmark-run
subtotals, receipt coverage and unavailable historical costs.

## Offline Test Suite

`npm test --workspace apps/role-fit-ai` runs the app's
`offline-evals.test.mjs`. It recursively discovers every `.mjs` under an
`__evals__` directory in RoleFit and runs each as a child process (bounded by a
60s timeout), asserting exit 0. There are no external network or model calls and
no provider keys. `server/__evals__/cover-letter-workspace-probes.mjs` is the
one auto-discovered route probe that binds an ephemeral loopback listener. A
new offline eval is gated automatically unless it is explicitly classified as
live.

Each eval still runs standalone for a per-case PASS/FAIL list, e.g.
`node apps/role-fit-ai/server/ai/__evals__/resume-proposal-probes.mjs`. On a failed case the runner
attaches the child's last output lines to the assertion so you can see which
case broke without re-running.

The live cover-letter, Answers and Resume Proposal quality evals are excluded via the
runner's `LIVE` denylist: they drive a real provider, cost tokens, and need a configured provider. Any
new external-network or model eval must be added to `LIVE` so it stays out of `npm test`.

### Application Answers

Saved user facts have their own checks: the hook eval
`src/hooks/__evals__/application-answer-facts.mjs` (Save, reload, Reopen,
refinement resend, per-question scope, nothing taken from answer text), the
persistence and backup probes (strict shape, limits, immutability, restore) and
`src/sections/__evals__/answer-facts-markup.mjs`.

The offline conversation probes exercise the production generator with injected
dispatch, including constraints, bounded repair, factual scope, missing facts,
question identity, cancellation and usage accounting. Client probes hold requests
across source/application changes and test exact revision saves, retries, Apply
coordination and failure recovery.
`src/hooks/__evals__/application-answers-replacement-guard.mjs` runs the
production hook against App's own replacement guards: composer text, an unsaved
draft and an in-flight request hold Prepare and Open, saved or empty threads do
not, and declining keeps the thread. `src/sections/__evals__/answers-prepare-lock.mjs`
renders the Answers tab to prove typing and edits are read-only while Prepare
runs. `src/hooks/__evals__/application-answers-retry-gate.mjs` fails a draft,
then edits the Prepare source (paste or link), or swaps in Starter sample text
with App's `resumeReady` false (and pins that formula in App's source), and
proves send, the tab's Retry and the dock's Retry all stop at the tab's
prepared-job or resume gate, in the tab's order, with no request.
`src/hooks/__evals__/application-answer-draft-source.mjs` runs App's
Answers save, preparation session, committed-intake setter and duplicate guard
with the production store: a first Save describes the job as last prepared and
links only through a duplicate choice a committed Prepare run or a later
Polish/Apply/Skip gate applied to that posting, or one the guard remembers for
that posting from a stopped run (reused by Polish and by the first Save itself,
which looks it up for the posting as last prepared, not later source edits; a
remembered Keep separate wins as it does at Polish and Apply, and a Save
retried after a failed link skips its own Draft), never one from a
different posting, straight from another posting's uncommitted run, or through
a queued run's stale setter.
Persistence probes cover Draft dates, same-ID Apply/Skip, legacy answers
and backup round trips. Run the nearest probe while iterating, then the full
RoleFit offline suite and app/server build.

The opt-in writing benchmark uses nine settings: Opus 5.5, Sonnet 5.5 and
GPT-6.1 Sol, each at low/medium/high. `--expanded` selects 57 synthetic cases:
the existing 12-case screen and seven former holdouts, plus 38 new cases across
13 additional candidate contexts. Regression and fresh results remain separate.
The new corpus spans technical and nontechnical work, career changes, early
career, senior individual contribution, volunteering, factual fields, motivation,
behavioral examples, hard limits and minimal refinements. Cases sharing a
candidate context are related observations, not independent population samples.

It calls the production conversation generator with frozen context and the
production prompt (v3 for every recorded run below; v4 now). Astra High and Opus High exchanged rubric feedback, then both explicitly
approved the identical `senior-recruiter-consensus-v1` hash before grading. The
tracked `support/application-answer-judge-protocol.mjs` owns that exact rubric
and approval metadata. Each judge then receives an independently reordered,
blinded set of answers, without peer scores. Both use a senior-recruiter
perspective and the same weights: naturalness/tone 25%, evidence/specificity and
factual judgment 25%, readability/clarity 20%, instructions/coverage 15%, economy
15%. Each category remains an integer 1–5; weighted totals are out of 100.

The rubric treats resume/Profile as incomplete. Reasonable motivation,
professional interpretations and modest inferred learning need not be verbatim
source facts. Specific unconfirmed personal history, unsupported concrete
qualifications/events and explicit contradictions are distinguished. The legacy
`severeFabrication` field now means a **material grounding-risk judgment**, not
a finding of falsehood or dishonesty. A material risk must name a concrete or
contradiction concern and cannot simultaneously be judged usable. Unasked
reflections may lose economy points without being mislabeled fabricated. Exact
counts and deterministic narrow-edit checks are supplied to the judges and
retained separately from model ratings. The Opus judge also participates as a
candidate; this is not independent human ground truth. Changed judges and rubric
mean new scores are not directly comparable with the historical low-judge rounds.

```bash
npm run eval:live:application-answers --workspace apps/role-fit-ai -- --dry-run
npm run eval:live:application-answers --workspace apps/role-fit-ai -- --dry-run --expanded
npm run eval:live:application-answers --workspace apps/role-fit-ai -- --run --expanded
npm run eval:live:application-answers --workspace apps/role-fit-ai -- --run
npm run eval:live:application-answers --workspace apps/role-fit-ai -- --run --holdout
```

`--dry-run` makes no provider calls. `--run` requires explicit authorization:
The default screen has 108 initial generations, at most 108 repairs and 24 judge
calls. `--expanded` has 513 generations, at most 513 repairs and 114 judge calls.
`--holdout` has 63 generations, at most 63 repairs and 14 judge calls. Concurrency
is two; generator order rotates across cases to balance the fixed arm order.
No private tracker data is read. Source hashes, frozen fixtures, outputs, usage,
timings, blind labels and judgments stay in ignored owner-only
`apps/role-fit-ai/workspace/application-answer-eval/`. Reported CLI cost is an
estimate, not a subscription charge; unavailable counts and cost stay `null`.
`--run --expanded --resume=<run-id>` can recover a run after interruption. The
original corpus, plan and recorded source hashes must match exactly. Completed drafts
are reused; failed/missing calls resume, and a changed answer set is rejudged.
Receipts are atomically replaced and a pending marker precedes each live dispatch
group. An interrupted in-flight call makes cumulative attempts, usage and timing
unknown; it is not silently counted as zero. Unknown timings are excluded with
the available latency sample count reported. Consumed recorded failures are
included in request counts and timing. This recovery does not run automatically.

Choose settings using usable results, factual scope, refinement restraint and
latency together; small score differences alone do not establish a winner.

#### 2026-10-07 expanded comparison and current selection

See the [cost record](benchmarks.md#cost-of-the-benchmark-runs) for generation,
judge and consensus estimates; [per-task costs](benchmarks.md#estimated-cost-per-task)
exclude benchmark grading and retain unknown OpenAI usage explicitly.

The expanded run completed all 513 responses on frozen prompt v3, with six
format repairs and no generation execution failures. Both High judges approved
the same rubric through five preceding discussion/approval calls. Grading then
produced 114 valid independent passes (1,026 ratings). There were 116 recorded
grading attempts: one provider/response failure, an immediate authentication
failure in a restricted recovery process, then successful recovery with CLI
access. Only that failed pass was retried; completed answers and judgments were
reused. Both failed attempts remain in the receipt, and unknown cumulative usage
remains unknown. All 16 recorded source hashes matched after execution.

The 38 fresh cases below were not used to retune the prompt. The 19 older cases
remain regression data. Scores are weighted model judgments, not percentages of
human answer quality. Median times include any repair, measured under the
two-request concurrency used by this run. “Usable” allows minor editing or
candidate confirmation; it does not mean every claim is verified.

| Setting | All 57 mean / 100 | Fresh Astra / 100 | Fresh Opus / 100 | Fresh mean / 100 | Regression mean / 100 | Fresh median seconds | Fresh usable to both |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 low | 97.1 | 98.4 | 96.0 | 97.2 | 96.8 | 3.72 | 38/38 |
| Opus 5.5 medium | 97.4 | 98.4 | 96.2 | 97.3 | 97.7 | 6.56 | 38/38 |
| Opus 5.5 high | 97.9 | 98.8 | 97.1 | 97.9 | 98.0 | 7.72 | 38/38 |
| GPT-6.1 Sol low | 95.7 | 98.9 | 94.4 | 96.7 | 93.8 | 6.18 | 38/38 |
| GPT-6.1 Sol medium | 96.1 | 99.1 | 94.4 | 96.8 | 94.8 | 6.54 | 38/38 |
| GPT-6.1 Sol high | 95.5 | 99.0 | 93.9 | 96.4 | 93.5 | 9.35 | 38/38 |
| Sonnet 5.5 low | 93.7 | 96.8 | 93.4 | 95.1 | 91.0 | 3.41 | 38/38 |
| Sonnet 5.5 medium | 94.8 | 97.0 | 93.8 | 95.4 | 93.7 | 3.31 | 37/38 |
| Sonnet 5.5 high | 94.5 | 96.4 | 93.0 | 94.7 | 94.2 | 4.15 | 37/38 |

Fresh category means retain tone, specificity/evidence, clarity, instructions and
economy separately. Cliches and stock phrasing affect tone/economy; unnecessary
additions, removals, disclaimers and repeated conclusions affect economy and
instruction following. No reliable numerical “cliche rate” is inferred.

| Setting | Tone / 5 | Evidence / 5 | Clarity / 5 | Instructions / 5 | Economy / 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 low | 4.88 | 4.86 | 4.89 | 4.97 | 4.67 |
| Opus 5.5 medium | 4.84 | 4.93 | 4.80 | 4.96 | 4.76 |
| Opus 5.5 high | 4.87 | 4.95 | 4.88 | 5.00 | 4.78 |
| GPT-6.1 Sol low | 4.76 | 4.89 | 4.79 | 4.99 | 4.76 |
| GPT-6.1 Sol medium | 4.71 | 4.86 | 4.89 | 4.97 | 4.82 |
| GPT-6.1 Sol high | 4.67 | 4.88 | 4.83 | 4.95 | 4.84 |
| Sonnet 5.5 low | 4.82 | 4.67 | 4.86 | 4.88 | 4.53 |
| Sonnet 5.5 medium | 4.83 | 4.70 | 4.88 | 4.93 | 4.49 |
| Sonnet 5.5 high | 4.68 | 4.78 | 4.83 | 4.87 | 4.49 |

**Current quality-first recommendation: Claude CLI / Opus 5.5 / high.**
It completed all 57 cases usefully to both judges, had no failed mechanical
checks, and its stronger examples used readable explanations and restrained
attribution. It avoided saying the developer fixed the bug "in production" in
the QA correction, wording Opus low/medium retained, and drafted the long supporting statement where
Sol high asked an unnecessary clarification. It still added one minor unconfirmed
action in the notice-prioritization example. Candidate review remains necessary.
The fresh/reset defaults and the user's current Answers selection adopt this
recommendation; supported saved choices in other workspaces remain preserved.

This is a modest quality preference, not a decisive model-family or effort win.
Opus high minus medium averaged only +0.67 points across fresh cases, with
10 wins, 17 ties and 11 losses. Medium is a near-equivalent alternative at
6.56 seconds versus 7.72. Opus low is worth retaining as a fast option: 3.72
seconds and 97.2, though at least one judge flagged minor concrete concerns in
four fresh cases, versus one each for medium/high. These included expanding a
single next-sheet change into an ongoing habit and retaining an unsupported
production setting during a correction.

**Sol medium is the recommended OpenAI option.** Both judges slightly preferred
it to Sol high on fresh averages; it had no concrete concerns flagged across all
57 cases, all 57 were usable to both judges, and it was faster. Sol low was also
competitive: medium gained only +0.08 fresh points (7 wins, 23 ties, 8 losses).
Sol high lost its older-regression supporting-statement case through unnecessary
clarification; the mechanical checks alone do not expose that coverage failure.

The family comparison depends on the judge. On fresh cases, Astra scored Opus
high 0.29 points below Sol medium, while Opus scored it 2.61 points above. Some
Opus deductions against Sol reflect style preferences rather than factual or
coverage failures. The Opus candidate/judge overlap means this run cannot
separate writing preference from family-correlated judging. Sol medium is a
defensible alternative default when factual restraint and latency take priority.

Sonnet was worth including, but it is not selected as the writing default.
Medium was fastest here at 3.31 seconds, only slightly faster than Opus low.
Minor concrete concerns appeared in 6/7/5 fresh cases at low/medium/high,
respectively, counting a case once if either judge flagged it. Both low and high
asserted that an unrecorded certification did not exist rather than asking for
the missing facts. Medium/high also joined two separate archive incidents; Opus
judged those answers unusable, while Astra allowed a minor correction. Higher
Sonnet effort did not consistently resolve these issues. CLI billing savings
relative to Codex are not established by this run.

Count/control replay passed 1,088 of 1,090 checks. All 45 exact-answer and 18
protected-text checks passed. The two failures were the Sonnet certification
clarifications above; their “usable after confirmation” ratings do not erase
those failures. Neither judge raised a material grounding-risk flag, which does
not certify every claim. Normal interests, professional interpretations and
modest learning remain acceptable without verbatim source wording. No production
prompt or evidence-warning policy was weakened. Prompt v3 remains frozen; any
further tuning should use new acceptance cases rather than reusing these as
fresh evidence. Production now runs `application-answer-conversation-v4`,
which registers the Answers section names in the shared fence and names them
in the input firewall line; its writing guidance is identical to v3 and was
not re-benchmarked. This round does not justify adding xhigh/max candidates or
claim that High judging is calibrated against human recruiters.

#### Earlier 2026-10-07 prompt tuning and default selection

The user authorized Sol 6.1 and Opus 5.5 at low, medium and high, prompt tuning,
and adoption of the recommendations in both fresh and current settings.
Three 12-case screens tested v1, v2 and v3: 216 completed generations plus one
format repair and 72 completed judge calls. A further 24 blinded judge calls
compared the saved v2/v3 answers together, with identical inputs and exact app
counts. The v1 grader did not receive those counts, so raw v1-to-v2 score changes
are not a controlled prompt improvement. The paired comparison favored v3 for
Opus low/high in both judge families; other settings were mixed. The seven fresh
cases then ran once against the frozen v3 prompt: 42 generations, no repairs,
14 judgments, no provider or judge failures. No personal workspace inputs were
sent in these runs.

| Setting | v3 screen mean / 100 | Fresh Opus judge / 100 | Fresh Astra judge / 100 | Fresh mean / 100 | Fresh median seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 low | 94.2 | 83.3 | 91.1 | 87.2 | 6.08 |
| Opus 5.5 medium | 92.1 | 92.0 | 97.7 | 94.9 | 6.08 |
| Opus 5.5 high | 95.0 | 89.6 | 99.6 | 94.6 | 6.37 |
| GPT-6.1 Sol low | 90.5 | 91.3 | 93.3 | 92.3 | 5.26 |
| GPT-6.1 Sol medium | 92.6 | 95.1 | 97.7 | 96.4 | 4.87 |
| GPT-6.1 Sol high | 93.6 | 96.1 | 99.6 | 97.9 | 6.30 |

**Earlier selection: Codex CLI / GPT-6.1 Sol / high, superseded above.** Its fresh workplace, mistake and
draft-correction answers were concise and stayed within the documented facts.
Opus low/medium added unsupported timing or frequency in the workplace case;
Opus low/high suggested the curator as a possible missing disagreement story.
Sol low/medium added unasked accuracy/decision disclaimers in the mistake case.
These concrete differences matter more than the small aggregate score gaps.
Sol medium is a reasonable faster alternative. Sol high's 12-case screen median
was 8.31 seconds, versus 5.97 for medium; timings are observed single-run values.

All six settings passed the exact typo-only edit on the screen. On fresh cases,
all six preserved both protected sentences byte-for-byte, removed the unsupported
prior 40% claim, answered the modest workplace contribution and separated the
missing-story clarification. Counts replayed correctly for all 42 answers. Both
judges called every fresh response usable and flagged no severe fabrication;
that does not erase the smaller unsupported additions above. Advisory guards
also produced false positives such as “one check”; they were not weakened to
improve benchmark results. Seven invented scenarios, one sample per setting,
model judges and no human calibration do not establish a population ranking or
percentage quality equivalence. OpenAI CLI cost was unavailable.

Prompt `application-answer-conversation-v3` reuses the Resume/Cover tuning
lessons: preserve supporting responsibility, use modest available evidence,
make the smallest requested edit, retain supported specifics, and avoid unasked
lessons, pitches, disclaimers or padding. Resume, Profile and explicit user
facts/clarifications remain candidate evidence; previous answers and the current
cover letter do not become factual sources. Existing advisory evidence warnings,
hard-limit validation and bounded format repair remain in place.

The other stage defaults adopt earlier decisions: Sonnet 5.5 low for Job
analysis/Fit (the prior 20-posting, three-repeat Prepare comparison), Opus 5.5
high for Resume Polish (prior user-adopted quality setting; high versus medium
was not a decisive win; superseded 2026-10-07 by GPT-6.1 Sol medium, see
[Benchmarks](benchmarks.md)), and Sol 6.1 medium for Cover (the prior 40-case paired
comparison). Final review retains the user's Sonnet 5.5 low choice, without a
comparative benchmark claim. `src/lib/stageSettings.ts` owns fresh, reset and
recommended-provider selection defaults. Supported saved choices are preserved;
the user's current local settings were updated separately with revision checking.

#### Initial screen, retained as historical evidence

The initial 2026-10-07 screen (Opus low/medium, Sonnet medium, Sol low/medium,
Astra low) completed all 72 generations with two successful repairs
and all 24 judgments. Final counts/constraints replay matched all 72 outputs
after edge-case parser and failed-repair accounting fixes; generation itself was
captured before those fixes. No prompt tuning or human calibration was performed.
Both judges considered 12/12 responses usable for five settings and 11/12 for
Sonnet medium. Sonnet answered a workplace-accomplishment question with an
explicitly personal project; the other settings requested a missing work example.
No judge flagged severe fabrication. Opus/Astra judges disagreed materially on
absolute scores, so the aggregate does not establish percentage equivalence.

| Setting | Mean judge score / 100 | Median generation seconds | Reported generation cost |
| --- | ---: | ---: | ---: |
| Opus 5.5 low | 95.3 | 4.19 | $0.5332 |
| Opus 5.5 medium | 96.2 | 12.03 | $0.6659 |
| Sonnet 5.5 medium | 92.6 | 4.03 | $0.2735 |
| GPT-6.1 Sol low | 95.5 | 6.91 | Unknown |
| GPT-6.1 Sol medium | 95.2 | 7.24 | Unknown |
| GPT-6 Astra low | 96.5 | 6.57 | Unknown |

Costs total 12 cases per setting and include repairs, excluding judges. These
single-run measurements favor testing Low further; they do not justify a default
change. Inspect source hashes and both judge families before reusing a receipt.

`src/lib/__evals__/job-identity-golden.mjs` is a CHARACTERIZATION test, not a
correctness one. It pins the duplicate matcher's verdict for every pair of a
fixed corpus to whatever it is today, so a refactor claiming "same results,
less work" is reviewable. The matcher drives pipeline warnings, posting-link
suggestions, and explicit manual-merge discovery, and its failure mode is silent — a dropped tier does
not throw. When a matcher change is INTENTIONAL, regenerate the golden block
with
`ROLEFIT_GOLDEN_UPDATE=1 node apps/role-fit-ai/src/lib/__evals__/job-identity-golden.mjs`
and review every changed line as a behavior change. Its coverage assertions
fail if the corpus stops exercising a tier, so a body edit cannot leave the
golden green but meaningless.

`src/lib/__evals__/duplicate-scan-eval.mjs` also logs a benchmark of the
tracker-wide duplicate scan. It asserts cache and correctness behavior only —
never wall-clock, so a shared CI machine cannot make it flaky — and defaults to
small sizes. For the full 50/100/300/500 sweep when changing the matcher or the
scan cache, run it standalone with
`ROLEFIT_DUPLICATE_BENCH=full node apps/role-fit-ai/src/lib/__evals__/duplicate-scan-eval.mjs`.

Full server-lifecycle and companion-process integration tests are explicit.
`server/__evals__/server-lifecycle-probes.test.mjs` intentionally uses the
`.test.mjs` suffix, which the offline child-process runner excludes. Run it with
`npm run test:server-lifecycle --workspace apps/role-fit-ai`; it binds an
ephemeral loopback port, uses an isolated temporary workspace, checks the
health/Host/Origin/lifecycle contract, and proves the listener can be released
and rebound.

## Testing Mindset

- Define success before coding: reproduce or identify the behavior,
  change it, and run the smallest meaningful verification.
- Prefer targeted checks while iterating, then broaden when the blast
  radius is shared or user-facing.
- If a check fails, treat the failure as evidence. Fix the smallest
  real cause and rerun the smallest meaningful check before broader
  ones.
- If checks are skipped, explain why in the final response.

## Server / AI Coverage

Good server verification covers:

- `npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit` passes after
  server edits (the server runs under Node's native TypeScript type stripping;
  the NodeNext, rewrite, and erasable-syntax options make this the type +
  native-runtime syntax gate)
- the affected route returns the expected JSON shape and HTTP status
- advisory-warning contracts stay covered by
  `server/ai/__evals__/assessment-warning-contracts.mjs` (Fit and application
  review), `server/applications/__evals__/job-warning-persistence.mjs` (historical
  job-warning compatibility), `src/lib/__evals__/application-answer-warnings-eval.mjs`, and
  `src/lib/__evals__/terminology-warnings-eval.mjs` (supported-term
  preservation and unsupported-term warnings)
- normal `/api/resume-polish` accepts `mode: "resume-proposal"` plus a structured
  `resumeScope`, does not require full-resume `resumeText`, and owns exactly one
  generation dispatch (plus one review dispatch only for the opt-in review
  below). It prompts with flat `target-N` IDs plus `order-N` bullet
  orders and `add-N` new-bullet slots for entries with linked Profile text; only
  bullets, actual Skills lists, and those orders and slots are mutable, while category labels, standard role/employer/subtitle/date,
  education, and omitted sections never become targets. Oversized fixtures prove complete
  JSON stays within budget, later job-relevant targets survive, response ids
  outside the selected set are withheld, and the omitted count round-trips
- one malformed, unknown, duplicate, unchanged, or placeholder-bearing edit is
  dropped without discarding valid siblings; an unsupported edit stays
  reviewable with warnings. Malformed optional summary/gap items are
  independently ignored. An all-drop for any safety reason returns Withheld, not
  a completed proposal; an all-UNCHANGED settle with a valid non-Withheld model
  status returns No changes with the reason still on the wire, while an explicit
  Withheld status stays Withheld; explicit empty output can return No changes.
  Responses beyond the examined change window count the unexamined tail as
  malformed rather than returning a misleading zero-withheld diagnostic
- the bold-in-bullets preference is enforced in both layers: the route rejects a
  present non-boolean with 400 and treats an absent flag as bold-on, and the
  sanitizer strips `<b>` from every bullet replacement when the preference is off
- the opt-in Polish review (`server/ai/__evals__/resume-proposal-review-probes.mjs`):
  with `reviewEdits` absent or false the route makes one dispatch and returns a
  byte-identical result with no `review` field; on, it makes one more dispatch on
  the same provider, model, effort, and signal, never when no edit survives.
  Probes pin the prompt rules for the named cases (synonym swap and unsupported
  claim held back; qualifier correction, filler cut, and Profile addition kept;
  "when unsure, KEEP"; length alone is never a reason), whole entry and linked
  Profile evidence in the reviewer's input, the registered `proposed_edits` fence and five-fence firewall line,
  neutralized injected fence tags in resume, Profile, posting, and guidance
  text, review-local ids with no server ids, generator reasons, or warnings in
  the reviewer's input, the strict reply parser (missing, unknown, duplicate,
  server, or extra ids, extra fields, rewrite or retarget attempts, malformed
  verdicts or reasons all reject the whole reply), by-reference partition, fail
  open on timeout, unreadable, quota, malformed, and partial replies with
  shape-only logs and a provider/unreadable failure kind that never reaches the
  wire, bounded and control-character-free notes, Stop rethrown rather than
  failed open, the all-held-back No changes outcome (keeping any withheld
  count), and the client wire parser's held-back checks. Offline
  probes prove the contract and plumbing only; whether a model judges these
  edits correctly is checked by the live review probes below
- the browser half of the review: `src/hooks/__evals__/resume-proposal-restore-hook.mjs`
  runs the real decision hook (Restore keeps the proposal key, earlier
  decisions and Undo; Accept all skips unrestored edits; a restored addition
  inserts with its arrival id; a new run resets Restore),
  `src/sections/resume/__evals__/resume-proposal-held-back.mjs` renders the
  collapsed list, reasons, notes, warnings, per-edit Restore names, and the quiet
  review lines, and proves an all-held-back result keeps the proposal root and
  the list's child slot across a Restore (so focus is not dropped) with the
  withheld line intact; `src/lib/__evals__/ai-workflow-eval.mjs` pins the
  settled note and its warn tone when edits were still withheld,
  `src/lib/__evals__/not-applying-application.mjs` the review receipt on Apply
  (carried when reviewed, cleared by a later unreviewed run, untouched for an
  excluded resume), and the decision, suggestion, usage, terminology, and
  settings evals cover the key, held-back mapping, `resume-polish-review` usage
  receipt, warning carry, and the off-by-default setting
- the browser makes one `/api/resume-polish` request per normal Resume Polish run
  (the opt-in review runs inside it), sends `reviewEdits` only when it is on,
  exposes no Tailor/Review/Both selector, and classifies a parsed invalid wire
  result as validation rather than `Parsing error`
- Resume and Cover Letter Polish prompts include a silent pre-response audit of
  evidence, claims, identifiers, and output shape. Probes cover focused,
  standard, and deep wording while provider reasoning effort remains a request
  setting rather than a second audit request
- positive Fit Assessment starts enabled Resume and Cover proposals independently;
  neither automatic request awaits or suppresses the other, and each failure is
  confined to its own document workflow
- `/api/resume-polish` rejects every mode except `resume-proposal` and carries no cover,
  Review-stage, score, or multi-stage request fields; the boolean `reviewEdits`
  only toggles the in-request edit review
- missing/unready configured providers and missing managed credentials surface
  a clear, user-safe error rather than a silent fallback
- provider failures distinguish authentication, rate-limit/quota,
  configuration, timeout, and generic failures without exposing provider
  bodies; cancellation remains a silent termination/Stop state, not a surfaced
  provider error
- browser disconnect and Stop cancellation reach the active native fetch or CLI
  child process; no hidden request continues and no later stage advances
- prompt-honesty changes prove that JD-only skills are not injected into
  the suggestion list or polished preview; when possible, use a synthetic
  missing-skill case such as a no-Kubernetes resume against a
  Kubernetes-required JD
- resume-proposal and Polish self-audit prompt changes must keep their focused
  offline probes green, including ungrounded terms, invented numbers, invalid
  targets, and all-withheld outcomes
- prompt-budget changes must add probes that build oversized structured
  payloads, extract each emitted JSON fragment (`editable_targets`,
  `resume_context`, `proposed_changes`, or equivalent), and parse it again;
  serialized JSON must never be truncated by raw character count. Resume target
  selection must also prove it avoids prefix-order bias and sanitizes against
  only the selected targets
- Job analysis probes cover structured field preservation, concise summaries,
  no source checks or review metadata, malformed types, unsafe markup, bounded
  lists, and independent Fit Assessment response handling
- the Job analysis rename contract must keep current code and docs free of the
  retired term except for explicit rejection probes and intentional historical
  release/continuity records
- compact Fit Assessment probes must prove that Prepare with automatic assessment
  off omits resume/context data entirely, automatic Prepare requests Job
  analysis plus fit in one prompt,
  invalid fit preserves valid job fields, the prompt contains the direct rubric
  as one identical system-level block in combined and reassessment paths, includes
  the conservative lower-category and stable posting-order tie breaks, unlocated
  match/gap/eligibility excerpts, duplicates, explicit conflicts, and
  non-Limited verdicts without an accepted match stay usable with warnings,
  both sides of accepted match evidence reach the client, public lists cap at
  three, malformed enums or unsafe text fail unavailable, `BLOCKED` without
  located, explicitly conflicting excerpts is downgraded to `CHECK` with a
  warning, a
  safe provider summary survives with fixed copy as fallback, and reassessments
  omit the Job analysis schema
- `src/lib/__evals__/ai-job-analysis-request-eval.mjs` must exercise the one
  browser request boundary with combined and reassessment success, provider HTTP
  failure, unreadable and invalid responses, network failure, and abort
  propagation and server-resolved provider/model/reasoning/attempt metadata.
  Focused lifecycle and entry-point guards must keep one endpoint request helper
  and one Fit Assessment outcome helper so entry paths cannot grow separate
  settlements
- `src/hooks/__evals__/job-intake-entry-points.mjs` executes URL, paste,
  extension, and imported-posting Retry intake with both duplicate gates, local
  and provider fallback, prepared-resume resolution, Fit Assessment on/off, and
  snapshot commit order, including the duplicate choice each path, Retry included,
  commits with. They also prove the separate first Fit remains awaited,
  identical Prepare runs receive distinct automation receipts, queued intake
  captures settings only after it owns the lock, and settings changes during
  readiness invalidate stale execution context. Stop, source changes, and restore
  cancel in-flight resolution, while too-short and thrown-error paths settle Fit
  out of `running`. Structural guards keep all four entry points on the single private
  post-acquisition coordinator
- auto-polish policy probes must cover every categorical threshold boundary,
  preserve the threshold values/order/labels, and keep automation policy out of
  the shared Fit Assessment contract
- resume proposal probes must keep category labels out of the target set, allow
  grounded list reordering/additions, and attach warnings to category
  substitutions, job-only skills, every upward ownership inflation (including
  level 1 to 2), and `spearheaded`/`oversaw`/`orchestrated` inflation; unrelated
  sibling or broad context leadership cannot silence those warnings, and safe
  sibling edits remain preserved
- application storage probes must prove compact Fit Assessment snapshots
  round-trip while numeric scores, full recruiter reviews, and missing-skill
  compatibility fields are omitted at the storage boundary. Current preview
  field names are strict; a contract rename requires an explicit private data
  rewrite rather than a runtime alias
- when Job analysis or Fit Assessment fails, Prepare keeps the immediate local
  brief editable and manual Polish available; Fit Assessment is separately
  retryable and cannot invalidate valid job fields. Resume Polish failure or
  Withheld keeps the current resume unchanged and locally retryable
- duplicate warnings before or after Job analysis must distinguish exact saved
  records and similar matches. Opening an
  existing record prevents the current and every downstream AI request; new
  work captures a posting relationship; high/possible matches require Link or
  Keep separate; and the decision is acknowledged for that target so the
  pipeline does not prompt twice
- cover-letter tailoring and application-answer generation have no local
  fallback and retain their own retryable task progress. Cover-letter probes
  must prove the **one-click contract**: a template-only starter, a blank
  document, and every base-variant job family reach Polish with zero extra
  fields; only a missing role or company blocks, while a missing candidate name
  or private slot is a warning; a recipient named in the source survives and an impersonal greeting
  falls back to the company hiring team; markdown links, citations, array
  indexes, and escaped brackets stay literal. Probes must show the normal path
  is exactly one provider request, that a technical violation triggers exactly
  one silent repair carrying its reasons, and that a second technical failure
  fails closed with the existing letter kept. Technical rejections cover
  unusable structure, unsafe markup, an unresolved template instruction, and a
  body-level greeting, sign-off, or date; unknown evidence ids, uncited
  paragraphs, generic phrasing, and ungrounded candidate terms, numbers, and
  outcomes return the letter with warnings and never trigger repair — while an
  employer-subject sentence drawn from the posting must not widen candidate
  evidence. Length is asserted
  as a warning, never a gate. Probes pin the two lifetimes: claim findings (the
  evidence category minus citation bookkeeping) and a cited unanswered private
  slot return in `concerns`; structure, quality, unknown or missing citations,
  leftover tokens, length, and model notes in `warnings`; the model's
  `warnings` field becomes at most three sanitized `Model note:` entries listed
  last (malformed metadata yields none and no issue) and is stripped from the
  repair prompt; the route echoes carried `sourceWarnings` as concerns; and the
  client hook carries only `concerns` forward. `cover-letter-warning-precision-probes.mjs` pins
  each benchmark-backed warning rule from `server/ai/AGENTS.md` (whole-entry
  citation scope, the claim surface, count modifiers and head nouns, compound
  adjectives, base-letter-only values, dropped deterministic slot ids) with a
  clean and a warned case each, so removing a rule fails a probe. The thirteen-fixture synthetic corpus spans
  general full-stack, frontend, backend/platform, healthcare, applied AI, a
  role whose strongest lead is not the most prominent project, relevant
  AI-workflow Profile context, and Profile context that must be omitted; it
  grades evidence grounding, resume-dump behavior, generic language, exact
  correspondence, role/company specificity, word range, and page count. It is
  offline by default; run the real-provider harness deliberately with
  `npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs]`.
  `EVAL_PROVIDER`, `EVAL_MODEL`, and `EVAL_REASONING_EFFORT` select the
  generator; `--help` lists fixtures without a provider call. `EVAL_JUDGE=panel`
  (the recorded GPT-6 Astra + Opus 5.5 panel) or a JSON array of judge
  configurations adds a whole-letter judge stage (`server/ai/coverLetterJudge.ts`):
  each judge scores support, relevance, argument, voice, improvement over the
  base letter, and an overall mark from 1 to 10 and lists unsupported
  sentences; the judge sees the letter, evidence (with each item's section and
  entry when the evidence carries them, so employer attribution is checkable;
  the tracked synthetic corpus does not), posting, and base letter but
  never the generator's identity; a reply without an unsupported-sentence list
  leaves that letter's count unknown, never zero; a Sol model is refused as a judge (after the
  request resolves, so an omitted model cannot fall to the Codex default), a
  judge that fails or answers unreadably is recorded as absent for that letter,
  and the structural checks alone still decide pass or fail. Each invocation
  writes an owner-only receipt directory under ignored
  `workspace/cover-letter-eval/` holding `manifest.json` (configuration, corpus
  and source hashes), the fixture snapshot, one receipt per fixture run, and
  `summary.json`, so results from two models never overwrite each other. A
  failed case records only its stage (preflight, generation, layout, grade,
  receipt), never provider text; a letter still unusable after repair is that
  case's `blocked` failure, while any other generation failure stops the run
  with the remaining cases reported as unrun.
  Both halves use only the tracked synthetic corpus: neither reads ignored
  `workspace/cover-letters/` variants or copies personal letter text into a
  fixture, console output, or provider request.
- Prepare has a manual synthetic benchmark (Fit Assessment consistency plus
  Job analysis extraction, timing, and provider usage):
  `npm run eval:live:fit-assessment --workspace apps/role-fit-ai -- [fixture-id[,fixture-id]|all] [runs]`.
  Each matrix entry is one Prepare configuration: the Job analysis request plus
  an optional `fit` request; matching requests take the one-call combined
  path and also run the standalone Retry prompt for pairing, differing
  requests take the app's split path (Job analysis, then standalone Fit) and
  are measured as the two calls they cost, with no second standalone call.
  Runs accept 1–5 (default 3). The runner measures verdict and eligibility distributions,
  non-adjacent jumps, invalid responses, provider errors, material-theme
  overlap, the automatic-Polish decision per threshold across repeats and
  between paths, per-dispatch elapsed time and reported token usage (Claude
  Code and the API adapters report counts, Codex one total, Antigravity none,
  recorded as `null`, never estimated), and the job half of each Prepare
  response against the fixture's `expectedJob` block: required-term coverage,
  preferred placement, or-alternatives kept in one item, eligibility text,
  honest empty lists, identity and salary facts, and `absentTerms` the
  extraction must never add to a list, title, location, or work-authorization
  text (an added term fails the run). Terms may be any-of groups so "4+ years"
  or "BS" count as faithful paraphrases, and all-capital terms match
  case-sensitively. Each invocation
  writes an owner-only receipt directory under ignored
  `workspace/fit-assessment-eval/` holding `manifest.json` (configurations,
  corpus and source hashes), the fixture snapshot, one receipt per dispatch
  set, and `summary.json`. `EVAL_PROVIDER`, `EVAL_MODEL`, and
  `EVAL_REASONING_EFFORT` select one configuration; `EVAL_MATRIX` accepts a
  JSON array (the same configuration twice is rejected). `EVAL_REPORT_ONLY=1`
  with `EVAL_REPORT_DIR` re-reports a receipt directory from its own manifest
  and fixture snapshot, without provider calls or the original matrix,
  re-scoring extraction, themes, and automation decisions from the stored
  fields under the current rules, and warns when the tracked corpus or
  sources have changed since. The runner stops one configuration after its first provider
  failure and is excluded from `npm test`; its contracts run the whole thing
  offline against a fake dispatcher.
  Its twenty-two tracked fixtures include the four verdicts, three eligibility
  states, prompt injection, preferred-only gaps, adjacent technologies, unshown
  years/degree, project-accepted entry-level work, specialized production-AI
  gaps, partial compound requirements, one isolated duration gap, a content-
  poor application form, and five extraction cases: a Python-or-Java
  alternative with a salary range, degree-or-equivalent experience, an
  explicitly professional experience scope, a long posting whose requirements
  follow benefits and equal-opportunity prose, and an embedded instruction that
  must add nothing. Private corpus calibration stays gitignored and is
  reported only through anonymized aggregate counts.
- Resume Proposal has an opt-in synthetic regression benchmark:
  `npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs]`.
  The tracked `server/ai/__evals__/fixtures/resume-proposal-quality.json` keeps
  39 invented cases: 18 from the 2026-10-04 benchmark (six original tuning
  cases, six initial holdouts, and six supporting-role holdouts, now all
  regression cases), 16 frozen holdouts for prompt slimming, and five
  opportunity cases (2026-10-06) that each require a proposal and name the
  expected improvement (a proposal that touches none of the named targets
  fails as `missedOpportunity`; an addition counts only when a new or rewritten
  bullet carries one of the case's `addTerms`, a reorder only when it puts
  the `leadBullet` first, and a case met only by rewrites also needs one the
  fact-check labels material; the brochure cases accept any honest edit): a
  buried strength to reorder, a duplicated achievement to remove, a Profile fact
  missing from its entry, a feature tour hiding the contribution, and an
  irrelevant bullet beside the only proof of a requirement. They exercise
  attribution, posting-only skills, ownership, numbers, prompt injection,
  linked Profile additions, negative evidence, tense, restraint, bold-off
  guidance, and key-evidence removal. Aligned cases permit `NO_CHANGES`;
  brochure and opportunity cases (eight in all) require an improvement, so an
  always-`NO_CHANGES` generator cannot pass the corpus. Corpus inputs and labels are
  agent-authored; passing these cases is not a general accuracy estimate.
  `EVAL_PROVIDER`, `EVAL_MODEL`, and `EVAL_REASONING_EFFORT` select the generator.
  `EVAL_FIXTURES=all` (default) or comma-separated case names select coverage;
  runs accepts 1–5 (default 1). `--help` lists cases without provider calls.
  Every live run also uses Codex CLI / GPT-6 Astra / high to fact-check each
  replacement and added bullet against its permitted entry/Profile evidence.
  Thus a full run makes 39 generation calls and up to 39 judge calls per
  repetition (generation may retry unreadable responses). Both providers must
  be configured; there is no provider fallback or workspace-settings import.
  Traps, tense flips, withheld edits, missing required improvements, unsupported
  edits, and provider/judge failures fail the run. The judge must return complete,
  unique, typed labels; missing labels never count as support. Materiality
  gates only an opportunity case met solely by rewrites; otherwise it,
  opportunity coverage, warning counts, and character growth are diagnostics,
  not gates or rendered page-fit claims. An edit is material when it changes
  what a screener learns or how quickly they find it; length and page count
  are never criteria in either direction. Astra labels are model judgments,
  not independent human certification; removals/reorders receive deterministic
  checks rather than per-edit factual judgments.
  The runner calls the production proposal workflow, reads only tracked
  synthetic inputs/source files, and prints status/count summaries. Unique
  owner-only directories beneath ignored `workspace/resume-proposal-eval/`
  retain the fixture snapshot, generator/judge configuration, corpus/source
  fingerprints, sanitized proposals, judge labels, and `summary.json` for
  comparisons across edits. It stops after the first execution failure and
  reports remaining cases as unrun; trap/factual failures still allow other
  cases to run. Personal applications and earlier private benchmarks are never
  read. The live runner remains excluded from `npm test`; the offline
  `resume-proposal-quality-contracts.mjs` checks fixtures, trap controls, strict
  judge validation, and injected provider success/failure paths without calls.

  Example, from the repository root (explicitly calls both live providers):
  `EVAL_PROVIDER=claude-cli EVAL_MODEL=claude-opus-5-5 EVAL_REASONING_EFFORT=high npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- 3`.
  Compare the same fixtures/repetitions on another model by changing those
  environment variables; each invocation retains its own receipts.

  `EVAL_POLISH_REVIEW=paired` (default `off`, which leaves receipts unchanged)
  evaluates the opt-in Polish review against the same proposals: each generated
  proposal is graded and fact-checked as usual, then the production review runs
  once on that same proposal with the generator's settings, and the kept edits
  are graded as a second arm reusing the same Astra labels (no second judge
  call). Receipts record each held-back edit's reason and class (Astra
  unsupported, immaterial, or valuable for replacements; for removals and
  reorders, trap when it removes key evidence, opportunity when the grader's own
  satisfier rule counts it, otherwise unlabeled), a `keyEvidence` marker on
  edits to `mustKeepBullets` bullets, lost opportunity fixes, caught trap hits,
  and review usage; `summary.json` adds a `review` block. A provider failure
  waits and retries (after 1, 5, and 15 minutes) and then stops the run as an
  execution failure; an unreadable review reply is counted (`reviewUnreadable`)
  and the run continues. Neither rewrites the unreviewed arm's result, and
  neither ever counts as a review that kept everything. Paired
  mode also runs the five tracked review probes in
  `fixtures/resume-proposal-review-probes.json` and reports per-edit agreement
  with their expected keep/drop:
  - four hand-built edits;
  - the same edits under injected resume, Profile, posting and guidance text;
  - three merged-fact edits from Opus 5.5 High's 2026-10-07 baseline
    (separately listed facts joined into a new relationship), each expected
    to be held back. These measure whether the review covers that failure
    before any deterministic check is built. The default-on bar
  (user-approved 2026-10-07; no run yet): zero lost opportunity fixes, zero
  held-back edits to `mustKeepBullets` bullets that Astra labels supported and
  material (`keyEvidenceValuableHeldBack`), at least 75% of held-back edits
  unsupported, immaterial, or non-opportunity structural edits, at most 5% of
  Astra supported-and-material edits held back, and every probe verdict
  matching. A paired repetition costs about 39 generations, 39
  fact-checks, and 44 reviews; a fresh real-application sample needs separate
  authorization because it sends private text to both providers.
- pasted resume text reaches the structured editor as a one-time conversion into
  `ResumeData`; a `.resume` file loads its `ResumeData` directly, and export offers
  PDF + `.resume`. The Resume file picker rejects plain-text, word-processing, and
  PDF files before reading them.
- cover-letter import accepts only `.cover`; `.cover` round trips
  its optional shared header, ordered paragraphs, and cover-specific print style
  without session ids, accepts only the current schema v1 shape, rejects
  malformed/unknown data and every other version, and editor/PDF output uses the
  cover-letter layout
- `workspace/` reads / writes stay inside the workspace; tracker and
  base-resume mutations are serialized/atomic, duplicate application ids are
  rejected, stale same-record tracker writes return `409` with the current
  snapshot, only sparse tracker mutations are accepted, server-authoritative
  unmutated rows retain deterministic ordering, successful own writes retain
  unchanged record references, and corrupt application JSON or malformed strict
  `.resume` data fails closed without destructive reseeding
- portable workspace backup includes only app-managed resumes/history, tracker
  data, saved application `.resume` / `.cover` sources and PDF-only
  replacements, and canonical allowlisted workspace preferences; validates
  decoded sizes and SHA-256 digests; rejects duplicate/traversing paths and
  malformed domain files; excludes standalone saved cover-letter variants and
  their history; and completes backup -> restore -> backup without byte drift.
  Every restore failure must leave the active workspace unchanged,
  a successful restore retains the previous saved workspace as a sibling
  safety copy and stages `source: "restore"` preferences, restore refuses with
  409 while live tab presence is reported, and a corrupt preference record
  never blocks backing up resumes
- routine AI logs remain shape-only and exclude model-authored target IDs,
  free-form error text, provider bodies, and private prompt content

Useful commands:

```bash
npm test --workspace apps/role-fit-ai
npm run test:document-workflows --workspace apps/role-fit-ai
npm run test:server-lifecycle --workspace apps/role-fit-ai
npm run test:editor:browser
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
npm run dev:rolefit
```

When iterating on a single route, hit it directly with `curl` against
`http://localhost:5181/api/...` rather than driving the full UI. If
port `5181` is already bound, the server is likely already running;
reuse it instead of starting a second `npm run dev:rolefit`.

## Frontend Coverage

Good frontend verification covers:

- affected route renders without runtime / console errors
- changed controls are reachable by keyboard
- loading / data refresh does not cause avoidable layout shift
- API error states show user-safe messaging (no raw provider bodies)
- Prepare is the first/default tab in the PREPARE group and the only production
  job-intake surface: URL fetch and pasted text appear there, no `JobMenu` or
  masthead `jobControl` remains, and the masthead contains only the RoleFit
  identity plus the shared Apply command. Read-only Sessions sits immediately
  above Settings in the bottom studio-rail utilities group, outside
  `OUTPUT_TABS` and the APG tablist
- extension receipt and delivery select Prepare before updating visible intake
  state; every delivered posting and Retry asks the selected provider for Job
  analysis after the local preview is published. Provider failure leaves that
  preview usable, and retry/stale guards cannot apply an earlier posting to the
  current session
- extension intake never launches Resume Polish; multiple saved resume
  variants may still be ranked from their actual strict document contents and
  a clear high-confidence winner selected while the editor is clean, but that
  is source selection, not tailoring, and the only persisted variant input is
  the Settings eligibility pool
- the prepared-resume resolution runs as REAL sequences rather than source
  regexes (`src/hooks/__evals__/prepared-resume-resolution.mjs`): an import
  arriving before workspace hydration, exactly one saved variant, a
  starter-only workspace, a ranked winner, option addition/deletion during a
  read, a same-filename candidate overwrite during a read, a changed candidate
  before adoption, a protected document, and a refused adoption with no stale
  recommendation. Both it and `prepared-cover-letter-resolution.mjs` cover the
  Settings pool: an excluded top-ranked variant is never read or adopted, one
  eligible variant is adopted, none keeps the current document, a pool change
  during the read retries under the new pool, a pool change before commit
  cancels adoption, and stale or renamed names are inert.
  `src/lib/__evals__/variant-pool-eval.mjs` pins the exclusion record's
  normalization, eligibility filter, cache round trip, and per-variant rebase;
  the backup-contract, preferences-conflict, and server preferences/backup
  probes pin strict rejection of malformed pools and their backup round trip.
  `src/lib/__evals__/resume-proposal-decisions-eval.mjs`
  pins content-derived proposal identity, keyed resets, undo, and manual-match
  behavior; `src/hooks/__evals__/resume-proposal-add-hook.mjs` runs the real
  decision hook for Profile-linked new bullets (Accept inserts with the assigned
  id, Undo removes exactly it, Discard never touches the document);
  `src/hooks/__evals__/resume-proposal-structure-hook.mjs` runs it for bullet
  removals and reorders (in-place restore, order Undo, group-scoped bulk
  decisions), `server/ai/__evals__/resume-proposal-structure-probes.mjs` pins
  their targets, budgeting, prompt rules, and withholding, and
  `src/sections/resume/__evals__/resume-proposal-groups.mjs` renders the
  grouped review.
  `src/lib/__evals__/profile-links-eval.mjs` pins Profile heading-to-entry
  linking, and `server/ai/__evals__/resume-profile-polish-probes.mjs` pins
  same-entry grounding, new-bullet slots, the Profile label, and Profile
  suggestion references. `src/lib/__evals__/settings-legacy-names-eval.mjs`
  converts every pre-2026-09-29 settings name through the cache, workspace
  file, and backup readers. `src/lib/__evals__/variant-candidate-reads-eval.mjs` pins ONE
  request per candidate read at 1, 5, and 20 variants for both document kinds,
  and `server/__evals__/workspace-candidate-batch-probes.mjs` pins the batch
  routes' name guards, bounded size, skip-on-corrupt behavior, and that they
  return candidates and nothing else
- a valid Fit Assessment survives a local job-analysis fallback, and a response
  carrying only domain or seniority labels keeps the local brief
  (`src/lib/__evals__/job-analysis-fallback-fit-eval.mjs`); the tailoring brief
  budgets whole items across its long lists instead of slicing one string, so
  twelve maximal duties cannot drop the required qualifications or tech stack
  (`src/lib/__evals__/tailoring-text-budget-eval.mjs`); Fit measures its
  24,000/28,000-character normalized input limits once before any dispatch, on
  the standalone route and inside combined Prepare where Job analysis still
  runs (`server/ai/__evals__/fit-input-limit-probes.mjs`); and the compact fit
  contract has threshold-boundary, exact-source-anchor, malformed-response, fixed-
  summary, deduplication, and eligibility adversarial probes in
  `server/ai/__evals__/fit-assessment-probes.mjs`
- `src/hooks/__evals__/fit-assessment-lifecycle.mjs` executes combined-request and
  reassessment provenance, canonical source replacement, displayed-brief independence,
  cleared-resume invalidation, provider/model/reasoning identity invalidation,
  friendly-label exclusion, explicit same-source reassessment,
  and zero-provider-dispatch cases for starter-only, blank-origin edited, and
  40-79-character stub documents
- `src/hooks/__evals__/job-intake-entry-points.mjs` pins the configuration
  boundary: matching Job analysis/Fit Assessment provider triples use one
  combined request, while any difference sends Job analysis without candidate
  evidence and dispatches assessment-only through Fit's provider/model/effort.
- `src/lib/__evals__/workspace-preferences-sync-eval.mjs` pins latest-response
  ownership, protects local edits that arrive during a focus refresh, and proves
  a corrupt canonical record cannot be adopted or seeded from one browser cache.
  `server/__evals__/workspace-preferences-probes.mjs` also refuses later ordinary
  settings writes until that invalid record is explicitly repaired or restored.
  The client probe keeps an unchanged focus adoption from consuming the user's
  next real save. `server/__evals__/workspace-preferences-precondition-probes.mjs`
  refuses a save whose base revision (a hash of the stored bytes) differs from,
  or is unaware of, the stored record, even when an outside edit left `updatedAt`
  unchanged, and returns that record.
  `src/lib/__evals__/workspace-preferences-conflict-eval.mjs` drives the real
  sync module against the real route. It proves that:
  - no-edit page exits never write;
  - an interrupted edit survives reload even after another tab rewrote the
    shared cache;
  - a push sends the tab's own view;
  - stale pending, ordinary, and last-base-resume saves rebase onto a newer
    record;
  - an in-flight edit stays pending;
  - a contended write stops after one retry;
  - a reset and the hook's default re-save leave nothing pending, so a later
    reload cannot delete newer outside values;
  - a failed boot write still restores the recovered edit into the cache;
  - an unseen restore wins;
  - legacy pending markers are discarded;
  `src/hooks/__evals__/application-persistence-guards.mjs` keeps tracker conflict,
  explicit create/update commit ordering, recovery clearing, and modal-save
  failure contracts covered after the retired monolithic workflow guard was
  removed. `src/lib/__evals__/preparation-application-commit.mjs` proves fresh
  Apply creates, restored-record updates preserve the same id, later-stage updates
  preserve identity/date/stage, missing explicit targets fail closed, and all
  primary surfaces use the shared action descriptor.
  `src/hooks/__evals__/application-action-integrity.mjs` pins authoritative
  tracker readiness, fresh same-handler duplicate lookup, late Apply/Skip
  preparation ownership and record existence, and the application-persistence
  edit lock over the captured job and material package.
  `src/hooks/__evals__/applications-refresh-ordering.mjs` executes concurrent
  refresh coalescing, queue-tail draining, and retry when a tracker write starts
  during an authoritative GET.
  `src/hooks/__evals__/duplicate-relationship-resolution.mjs` executes the
  multi-choice duplicate gate, exact-record opening, confirmed linking,
  remembered Keep separate decisions, Prepare gates returning their choice for
  the run's commit while Polish and Apply/Skip gates publish it (remembered
  choices included), and the create-then-atomic-link boundary;
  it also pins destructive merge as a separate tracker operation and established
  group unlinking as one all-member revision-checked mutation.
  `src/lib/__evals__/not-applying-application.mjs` proves new, repeated, and
  update-only Skipped commits with canonical multi-reason lists; job-only AI
  provenance; decision-date preservation; sent-artifact removal for job-only
  decisions while a later-skipped application keeps its date, documents, and
  document AI receipts on re-skip and Save job updates; exact
  dialog/receipt copy; and that the quiet action remains in Prepare rather than
  the masthead. The storage probes additionally verify decision metadata
  roundtrips while `appliedAt` and sent document fields are omitted.
  `src/lib/__evals__/skip-reason-suggestions-eval.mjs` pins the local suggestion
  rules (prior decision wins, submitted-link and Blocked pre-checks, weak marks,
  classifier false positives, no provider path), and
  `server/applications/__evals__/skip-reason-storage.mjs` proves legacy scalar
  reasons load without a rewrite while unknown, mistyped, unsorted, or
  mixed-shape stored reasons fail closed.
  `src/lib/__evals__/explicit-application-write-targets.mjs` proves answer
  generation has no tracker persistence, document-sync ID ownership, Apply/Skip
  relationship handling, and the absence of the retired `findForTarget` and
  ordinary `upsert` write APIs.
  `src/lib/__evals__/application-status-transitions.mjs` pins the forward-only
  status graph and the ban on rewriting submitted or terminal history.
  `src/lib/__evals__/prepared-source-replacement.mjs`
  exercises same-posting corrections, reused generic URLs, conflicting posting
  ids, and the update-mode guard order/copy that runs before duplicate review or
  provider analysis.
  `src/lib/__evals__/application-analytics-eval.mjs` keeps Skipped visible as
  reviewed history dated by its decision, counts only explicit `appliedAt`
  submissions (so an application later marked Skipped keeps its original
  submission in the shared submitted-metric denominator and monthly
  submissions), and excludes Skipped from missing-follow-up hygiene. The preparation/session relationship eval
  pins independent multi-record groups, group counts, and two-versus-many unlink
  plans; the saved-surface probe pins linked-history presentation plus confirmed
  destructive merge controls.
- URL and paste intake remain enabled without an AI provider and produce the
  deterministic local brief; only provider-backed enrichment stays unavailable
- Fit Assessment shows only verdict, summary, up to three
  compact match explanations and gaps, and a relevant eligibility warning with
  its accepted anchors. It exposes no score, confidence, broad evidence ledger,
  recommendation, saved audit, or analytics metric
- changing the selected resume dispatches only `mode: "fit-assessment"`; with
  automatic assessment off, Prepare sends no resume/context data and only an
  explicit Assess fit does. Resume and Cover Letter each use an
  independent automatic Polish switch and categorical minimum-fit threshold;
  `CHECK` remains eligible and only `BLOCKED` stops a threshold match. Manual
  Polish remains available for every fit state
- Fit Assessment never changes tracker state or workflow;
  `fitAssessmentRank` remains available only for explicit sorting
- Resume and Cover Letter render the same material-card structure with separate
  variant selectors and Include toggles, neither is labeled optional, and a
  fresh prepared job starts with Resume included and Cover Letter excluded
- masthead and Prepare primary actions invoke the same handler, action copy, and readiness model:
  a matching completed preparation is required, each included material must be
  ready while its work is idle, neither material is required, and non-empty
  source alone remains blocked. Applying with both excluded records the job;
  excluding a previously saved material on a later update preserves that artifact
- every prepared JD field can be corrected locally on Prepare after partial or
  failed extraction without invalidating the matching prepared source snapshot:
  tracked job facts through one role context, responsibilities, required/preferred
  qualifications, technical keywords, seniority/domain signals, and benefits.
  Deterministic extraction gaps remain visible until addressed; View
  source and Prepare again retain the captured posting, Apply stores the full
  corrected brief, and reopening restores benefits without adding them to the
  Resume Polish projection
- opening a stored application validates its job and strict document sources,
  preserves the dirty-document confirmation, restores the session, and lands
  on Prepare through **Edit preparation**
- Applications routes its new-work action to Prepare, while its modal edits
  existing committed records and exposes no independent job-intake controls
- a failed cover-letter request stays local to its page with safe retry copy and
  typed bounded issues, never replaces the letter, and filters unfinished
  Guidance prompts at both evidence boundaries; a successful one stages a
  fingerprinted whole-letter proposal, only explicit acceptance loads it into
  the editor with an exact one-click Restore, and that Restore plus its result
  summary disappear together the moment the user edits, opens another document,
  or runs Polish again. Duration grounding covers equivalent word and digit forms
- the owned typeset page stays the sole editor and live preview; the tracker may
  render or open a saved application document as PDF. Resume's proposal rail
  shows only What improved, Edits ready, and a withheld line;
  individual cards support Accept/Edit/Discard and still highlight their exact
  editor field, while no evidence/risk/keyword chips return
- production builds keep `TrackerTab`, `AnalyticsTab`, and
  `ApplicationModal` in lazy chunks, and opening each surface loads cleanly
- components reuse shared CSS classes and tokens from `src/styles/` instead of
  one-off styles
- AI setup renders every configured stage expanded together with no
  per-section collapse control or persisted collapse state; only explicitly
  configured providers appear, configured-but-unready selections stay visible
  and disabled, and no API key appears in DOM, browser storage, or HTTP requests
- at 720px and below, only precise Resume authoring is replaced by the width
  notice; Prepare, masthead/navigation, Cover letter, Answers, Applications,
  and Analytics remain reachable, including under high browser zoom
- Sessions and Settings remain reachable in order in expanded and collapsed
  rail states; the compact Sessions count/working indicator remains visible,
  its popover opens rightward without viewport clipping, and it is absent from
  output-tab arrow/Home/End navigation
- job-import analyzer changes prove the before/after shape without
  printing raw private text: the resulting structured brief should keep role
  intro / responsibilities / requirements while stripping empty bullets,
  apply/navigation furniture, duplicated titles, low-value Workday
  metadata, company/culture marketing, and trailing benefits / legal
  boilerplate
- shared-engine integration changes keep
  `src/typeset/__evals__/linebreak-snapshot.mjs`,
  `vertical-layout-snapshot.mjs`, and `pdf-roundtrip.mjs` green. The PDF probe
  emits every supported family and face, covers shaping/links/underlines, and
  exports a multi-page cover letter. Set `ROLEFIT_PDF_AUDIT_DIR` to an ignored
  or temporary directory when external-viewer artifacts are needed. These are
  RoleFit integration and migration guards; the canonical engine checks live
  under `packages/engine/`
- editor changes keep the shared
  `packages/editor/src/sections/editor/__evals__/typeset-editing.mjs` and
  `packages/editor/src/hooks/__evals__/{resume-editor-structure,modal-focus-contract}.mjs`
  checks green so display/value mapping, history coalescing, summary split/merge,
  and modal focus placement/restoration remain atomic
- `npm run test:editor:browser` uses headless Chrome through the DevTools
  protocol to exercise header mark preservation and undo, disabled open
  controls, popover focus return, one-block rich document paste, the Typeset
  explicit-save dirty baseline, and live two-tab workspace adoption

Useful commands:

```bash
npm run build:rolefit
npm run dev:rolefit
```

`npm run build:rolefit` runs the RoleFit workspace build. Run it
before finalizing whenever frontend source or types changed.

## Public Product/Download Page Coverage

The public page is a separate build and security boundary, not a Drafting Desk
route:

```bash
npm run build:rolefit:landing
npm run test:landing --workspace apps/role-fit-ai
```

The build must emit only `apps/role-fit-ai/dist-landing/`. Its guard requires
the public marker and one landing manifest entry and rejects known loopback
origins and product API paths. The offline release probe covers valid complete
signed and unsigned-preview releases, signed-release precedence, and malformed
tags, mismatched draft/prerelease state, wrong origins, zero-sized, missing,
duplicate, and unexpected assets.

Real-browser QA must cover desktop and 390px widths, a clean console, keyboard
focus, and both release states: the live empty/unavailable response links every
platform row to GitHub Releases, while mocked complete signed and unsigned
preview releases produce the exact Apple silicon DMG/ZIP, Intel DMG/ZIP,
Windows x64 EXE, and checksum links. Preview QA must show the unsigned warning
and format labels at both widths; a signed release must outrank every preview.
Request inspection must show only static page assets and public
`api.github.com` release metadata, never RoleFit `/api/*`, localhost probing, or
companion detection.

## Browser / Provider Companion Coverage

Companion static policy checks are part of the RoleFit `check` gate. The process
integration smoke stays explicit because it launches Electron:

```bash
npm run build:rolefit:desktop
npm run test:desktop:vault --workspace apps/role-fit-ai
npm run test:desktop:security --workspace apps/role-fit-ai
npm run test:desktop:contracts --workspace apps/role-fit-ai
npm run test:desktop:cli --workspace apps/role-fit-ai
npm run test:desktop:settings --workspace apps/role-fit-ai
npm run test:desktop:ipc --workspace apps/role-fit-ai
npm run test:rolefit:desktop
```

The browser remains the product host, so companion verification must prove that
Electron renders only its compact local setup page, never the Drafting Desk,
and does not own workspace/tracker files. Focused companion probes should cover:

- numeric-loopback-only server start, explicit compatible/foreign conflict
  outcomes, closed companion/standalone launch provenance, private-handle-only
  ownership, graceful-only POSIX Stop/Restart, listener-PID parsing for
  `lsof`/`netstat`, alternate-port persistence, owned process shutdown, and
  rejection of mode/workspace/arbitrary-listener mismatch;
- a strict local-file CSP, denied renderer permissions, absent Node globals,
  blocked renderer `window.open`, and main-owned external targets reachable
  only through fixed typed IPC methods;
- exact trusted main-frame and exact `file:` URL validation for every IPC call,
  a frozen self-contained preload, fixed named methods, and rejection of unknown
  providers or extra arguments;
- desktop API 13 extension setup copy probes for **Copy path**, **Copy port**,
  the exact Chrome/Edge/Firefox address targets, closed target validation, main-owned
  clipboard writes, sanitized failures, and no returned renderer path or
  renderer clipboard permission; companion UI coverage also verifies native
  click-to-copy buttons, local hover/focus feedback, no panel-wide render call,
  and one visually hidden polite status region;
- extension bundle materialization after active-server resolution, strict
  first-install-seed validation, packaged inclusion of `settings.js` and
  `runtime-config.js`, and
  read-only pairing controls whenever the current companion does not own the
  service;
- fake-encryption/file-adapter cases for API-key save/remove, atomic versioned
  registry round trips, malformed input, insecure-backend refusal, and proof
  that saved keys never appear in IPC results, HTTP, logs, argv, environment, or
  browser storage;
- shape-only installed/signed-in/signed-out/unknown CLI status with no executable
  paths, account identifiers, environment values, tokens, stdout, or stderr;
- installed/configured Antigravity is request-eligible as ready-to-verify while
  `authState` remains unknown; it is never labeled signed in, and the first
  actual provider request owns authentication verification and recovery errors;
- fake-binary cases for absent, malformed, timed-out, and oversized status
  output, plus fixed external-terminal sign-in argv, the install/sign-in-guide
  URL opening, sanitized child environments, and redacted failures;
- the default/saved/environment local-site-port states, integer/range and
  occupied-port rejection, atomic settings persistence under isolated
  `userData`, environment locking, and `Apply & restart` using the normal clean
  quit/relaunch lifecycle;
- `Open RoleFit` launching the selected `http://localhost:<port>` in the system
  browser without granting privileged IPC to that browser content;
- private owned-server provider snapshots, atomic replacement/clearing, a
  shape-only `/api/providers` response, an empty authoritative snapshot before
  listening, disabled `.env` loading/no managed credentials in the owned child
  environment, refusal to inject vault data into a reused standalone listener,
  rejected provider mutations while that reused listener remains active, and a
  main-owned refresh after the setup renderer closes;
- browser selectors showing only configured providers, preserving unready
  selections without a paid fallback, disabling only AI when none exist, and
  awaiting initial discovery for extension Job analysis instead of
  recording a transient loading state as failure;
- browser autosave/editor/tracker behavior remaining independent of Electron,
  plus the existing `npm run dev:rolefit` and extension contract staying green;
- extension analyze/import rejecting unapproved extension callers, accepting
  and reflecting only exact configured Chrome/Firefox/Safari origins, allowing
  valid unapproved origins to enqueue only a bounded short-lived pairing
  request, and rejecting near-match, path-bearing, absent, malformed, and
  oversized identities without CORS;
- extension preparation omitting retired `autoTailor`, `distillAi`, and
  pre-extracted `fields`, while preserving `extensionImport`, `claimToken`,
  `tabId`, and the `"preparing"` progress contract;
  sending the same claim token in the import body and fresh-tab query; claiming
  a reserved inbox entry only from its intended tab; opening an independent tab
  in the current Firefox container when available with the ordinary fresh-tab
  fallback elsewhere; and keeping duplicate, required-AI, retry, and stale-response
  guards intact;
- same-port status rejecting a wrong service before any posting text is sent,
  returning only the marker plus `paired:false` for a privileged origin-less
  GET, rejecting invalid explicit origins and origin-less preflights, separating
  unavailable from unpaired state, and never enqueuing pairing;
- changing app ports being reported as a new browser-storage origin, the
  materialized runtime config remaining only an install seed, saved extension
  storage winning, and popup Settings reconnecting without an extension reload;
- both extension entry points — the popup button and the `import-job` keyboard
  command — clearing the same `confirmPairedService` gate before any page text
  is sent, opening no request path of their own, and adding no permission
  beyond the popup's `activeTab`/`scripting`/`storage`/`cookies` set;
- the keyboard command declaring a Chrome service worker and a Firefox event
  page over one module, guarding against a held-key burst of duplicate imports,
  and recording a bounded, TTL-expiring one-shot failure notice that the popup
  shows and clears without ever blocking the port record from loading;
- every local extension request carrying an abort timeout, with a timed-out
  request reported differently from an unreachable port, verified end to end
  against a stub that rejects on abort exactly as `fetch` does;
- each extension failure reaching the recovery that fits it: only a failed
  status handshake offers the port form, a slow analyze offers retry, and an
  unanswered pairing request reports approval as unconfirmed rather than missing;
- an import failure remaining visible after a successful reconnect, and a
  completed import reaching a terminal labeled state instead of a permanent
  "Preparing" — both exercised against a stub that fails only the import call;
- the popup's live region persisting outside the re-rendered root and carrying
  progress text, and keyboard focus surviving a render: restored to the same
  control on a same-view rebuild, parked on the new view when the control is
  gone, and never taken on first paint. The browser-QA pane runs unfocused, so
  `.focus()` there sets `activeElement` without firing `focusin`; dispatch the
  event explicitly or the focus tracker looks broken when it is not;
- Handshake capture against a synthetic stub of the live layout: a collapsed
  or already-open description captured in full and left open (the toggle
  re-renders on each click), Similar Jobs and alumni profiles excluded in
  either order, the search view's selected posting named by its own link with
  a single-line role and employer, no toggle clicked inside a link or form and
  at most four clicked, a wait of only the 1.5 s deadline when the toggle never
  responds, the 50,000-character cap, generic fallback without a posting pane,
  no clicks on other sites, and no server fetch of the signed-in page;
- popup title/company parsing (`server/extension/__evals__/job-meta-probes.mjs`):
  LinkedIn, Indeed, and `<Role> | <Employer> | Handshake` titles (Handshake
  ahead of LinkedIn), body header lines filling only what the title left open,
  and hostile 500-character titles and 50,000-character page text (the
  analyze route's cap) parsing in under 500 ms (the replaced patterns took
  0.5-32 s, stalling the synchronous analyze route);
- the loadable extension directory containing no reserved `_` name, nothing
  beyond the shipped set defined once in `desktop/extension-bundle.cts` plus its
  two guides, and no missing shipped file — while tolerating dotfiles the
  browser ignores;
- no live provider login, hosted-page CORS/pairing, or paid AI call during
  automated verification.

Automated smoke must not replace the operator's current OS clipboard contents.
Instead, executable helper and IPC probes cover every exact copied value and the
main-owned writer callback, source inspection pins that callback to Electron's
`clipboard.writeText`, and the real Electron smoke dispatches pointer-leave and
blur through the installed renderer listeners. The final OS clipboard click is
manual visual QA.

The existing desktop script names remain the command entry points while the
source layout converges on the companion contract. A smoke that still passes by
loading the React app in a `BrowserWindow` does not satisfy this coverage; the
window must load only the static companion surface.

## Packaged Companion And Release Coverage

Use Node 24 for Forge packaging. Package and smoke only on a matching native
host: macOS arm64/x64 or Windows x64. Cross-compilation is intentionally
rejected.

```bash
npm run build:rolefit:desktop:package
npm run test:desktop:package-layout --workspace apps/role-fit-ai
npm run package:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run test:rolefit:desktop:packaged -- --arch=arm64 --platform=darwin
npm run make:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=arm64 --platform=darwin
npm run test:rolefit:release
```

Use `--arch=x64 --platform=darwin` on an Intel Mac and
`--arch=x64 --platform=win32` on Windows. Generated staging, unpacked apps,
maker output, and normalized artifacts live beneath
`apps/role-fit-ai/.forge/` and remain untracked.

The staged-layout probe must reject `.env`, personal workspace/provider data,
tests, source maps, unrelated workspace apps, and any `.resume` other than the
bundled starter. The packaged process smoke starts from a foreign working
directory with isolated `userData`, verifies the browser bundle/font/workspace
and vault locations, then proves clean utility-server shutdown and
port release. Native release verification additionally checks the macOS app,
ZIP, and DMG signatures/notarization or both the Windows app executable and
installer Authenticode signature plus trusted timestamp. Windows then silently
installs that exact normalized setup, invokes the common packaged smoke with
the absolute installed executable, uninstalls through Squirrel in `finally`,
and verifies the install root was removed.

The release-contract tests remain offline: they verify canonical
`rolefit-vX.Y.Z` tags, package-version equality, main ancestry, exact artifact
names/counts, and publication fail-closed behavior. An actual signed release is
not a local test. It requires `rolefit-macos-signing`,
`rolefit-windows-signing`, and `rolefit-release` GitHub environments restricted
to `rolefit-v*`, protected `rolefit-v*` tags, CI secrets, and the publish-time
remote-tag commit recheck.

## Chrome Visual QA

Chrome visual QA is flag-first: skip by default, flag changes with real
layout/theming risk, and let the user decide. When it runs, check:

- for public landing changes, the complete desktop/390px page, release status,
  installer rows, and absence of horizontal overflow;
- the affected control in the Prepare + studio workflow
- Sessions/Settings reachability and ordering in the expanded and collapsed
  studio rail, including the rightward viewport-bounded Sessions popover and
  its exclusion from APG output-tab navigation
- the typeset editor itself (its own WYSIWYG preview), rather than a legacy HTML
  editor or a separate compile-preview surface
- tab open/close behavior in the output panel when tabs changed
- no overlapping text or controls in resume / output panels
- no spinner / loading / shimmer effects unless requested
- long resume / job-description text wraps without overlap

For tiny copy or class-only edits, visual QA may be skipped with a
short reason.

## Refactors

Good refactor verification proves behavior parity:

- `npm run build:rolefit` succeeds
- grep for old symbol names returns no meaningful hits after renames
- no new imports of deprecated paths
- affected call sites still use the intended public interface
- the AI polish path still works, and a failed AI call surfaces a specific,
  retryable failed step without running any later selected step; Job analysis may
  keep its deterministic brief, but the failure remains a failure

Avoid drive-by refactors. Refactor only when the current task requires
it, the existing structure blocks correctness, or the improvement can
be verified safely.

## Docs-Only Changes

For docs-only changes:

- no frontend build or server check is required
- verify paths and links exist
- run a spelling / grep sanity check when useful
- update root `CONTINUITY.md` for cross-workspace decisions and the app ledger
  only for RoleFit-specific operational state

Document skipped runtime checks as not applicable.
