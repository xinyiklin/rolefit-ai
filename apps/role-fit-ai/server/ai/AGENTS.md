# RoleFit AI Runtime Guide

Applies to `apps/role-fit-ai/server/ai/` and `server/ai-cli/`. Prompt and
sanitizer code is executable product behavior and anti-fabrication-critical.

## Content and evidence policy

The [canonical product policy](../../PRODUCT.md#content-and-evidence-warning-policy)
requires content/evidence failures to preserve otherwise usable output with
warnings across RoleFit generation, assessment, and review paths. Job analysis
is structured JD extraction: retain truthful prompts and basic shape/markup/size
validation, but no post-extraction fact checks, source matching, condition
replacement, or evidence warnings. Other stages retain their existing checks;
do not add an AI analysis stage or policy engine. The one user-directed
exception is the opt-in Resume Polish review (`resumeProposalReview.ts`). Unknown source references or unconfirmed excerpts are evidence
warnings, never verified citations or links to unrelated sources. Invalid edit
targets, unsafe markup, unusable structures, unauthorized mutations, and stale
application retain blocking technical guards.

## Module ownership

- `providers.ts` resolves provider identity, defaults, credentials, models, and
  reasoning effort. `shared/cliReasoning.ts` owns model-specific CLI effort
  capabilities used by browser settings, request validation, and CLI argv.
  Catalog changes must preserve readable canonical preferences and backups;
  only known provider-setting repairs may precede strict validation.
- `clients.ts` owns native API/CLI dispatch. `server/ai-cli/` owns subprocess
  invocation and provider-specific process constraints. The optional dispatch
  collector reports attempts and the provider's own token counts
  (`providerUsage.ts`: numbers only, `null` when a provider reports none);
  benchmarks read it, the product does not display it.
- `prompts.ts` owns fenced input construction and truthfulness/output rules.
- `sanitize.ts` owns shared deterministic markup and numeric-claim guards. Stage
  modules own their response schemas and outcome derivation.
- `resumeProposal.ts` owns normal Resume Polish: one generation dispatch, flat
  target IDs, deterministic mutation grounding, tolerant optional feedback,
  and truthful Proposal / No changes / Withheld outcomes. Oversized target sets
  are ranked by materiality and job relevance into complete JSON; the response
  is validated only against that selected set and reports the omitted count.
  The 12-change result cap is stated in the prompt and applied as a fixpoint:
  the kind order (rewrites, removals, reorders, additions) exists only to settle
  conflicts and to order the emitted set; the kept set is the first 12 usable
  changes in the model's order, and the prefix is re-examined without the cut
  tail until stable so a cut change never knocks out an earlier one. Do not let
  the kind order rank value.
- `resumeProposalReview.ts` owns the opt-in Resume Polish review (request field
  `reviewEdits`, default off): one keep/drop dispatch after sanitizing, only when
  at least one change survives, on the generation's resolved provider, model,
  effort, and abort signal, with no unreadable-output retry. The reviewer sees
  review-local `edit-N` ids, each edit's before/after and its own whole entry
  and linked Profile evidence (as the generator saw them), never server target
  ids, generator reasons, or deterministic warnings. Its rules follow the
  benchmark's materiality rubric: cutting filler is kept, length alone is never
  a reason. Its new fence
  is registered in `prompts.ts` (`RESUME_REVIEW_FENCE_NAMES`) and the firewall
  line names exactly its five fences. The reply parser is strict: one KEEP or
  DROP (`LOW_IMPACT` | `INCORRECT`) per sent id and nothing else, else the whole
  reply is rejected; only the optional display note is tolerant (plain text
  without control or bidi characters, dropped past 2,000 characters before any
  markup scan, clipped to 160, never re-sent). Kept changes are the sanitized objects
  themselves, warnings included; review never certifies. Every failure except
  cancellation fails open to the full proposal as `review.outcome:
  "UNAVAILABLE"` (benchmarks also get a shape-only provider/unreadable failure
  kind that never reaches the wire); holding back everything returns No changes
  with an empty summary and keeps any withheld count. Held-back changes travel in `review.heldBack` for Restore.
- `resumePolish.ts` accepts only `mode: "resume-proposal"` and routes it to that
  contract. Cover letters and application answers use their own routes.
- `applicationAnswerConversation.ts` owns Answers chat (`mode: "conversation"`);
  `applicationAnswers.ts` retains the historical batch contract. The shared
  `applicationAnswersContract.ts` owns question limits, exact-text counts,
  placeholder detection and constraint validation; `applicationAnswerStorage.ts`
  owns saved revisions. Every Answers section name is registered in
  `prompts.ts` (`ANSWER_CONVERSATION_FENCE_NAMES`) so `fenceUntrusted`
  neutralizes it and the firewall line names it; add any new section there.
  Generate once and allow at most one format repair. Explicit employer limits
  gate normal Copy/Save; unresolved drafts remain available through Save draft.
  A negated or penalty-phrased "more than / over / exceed N" is a hard ceiling;
  un-negated, it is a hard floor only after a positive instruction and
  otherwise no limit at all, so an unrecognised negation never drives a repair
  past an employer's limit. A worded maximum turns bare counts of its own unit
  into advice, and bare counts of other units too unless an instruction
  introduces them ("Answer in 3 sentences. Maximum 500 characters." keeps both;
  "Feel free to answer in 150 words", "In 200 words or so", later advice such
  as "which is usually enough", and a count sitting between two of a field's
  questions stay advice).
  Evidence warnings remain advisory. Preserve question identity and revision,
  distinguish explicit user facts from generated drafts, and reject oversized
  inputs instead of silently clipping them. Unknown usage from any dispatch
  makes the aggregate unknown, including failed repairs.
  Refinements make the smallest useful edit and retain supported specifics and
  responsibility levels. A prior draft cannot supply new facts; resume, Profile
  and explicit user facts remain the evidence. Match the question's work/study/
  project setting, accept modest contributions, and ask one short non-leading
  clarification only when necessary. Never invent prior intentions or beliefs.
  Do not pad to an optional word range or append unasked lessons, pitches or
  disclaimers. Current cover-letter prose is not Answers evidence.
- `jobAnalysis.ts`, `fitAssessment.ts`, `coverLetter.ts`, and `applicationAnswers.ts`
  own their routes and prompt contracts. Prepare may ask `jobAnalysis.ts` for
  Job analysis plus optional compact Fit Assessment in one provider dispatch only
  when their provider/model/reasoning settings match; otherwise the client commits
  Job analysis before using `mode: "fit-assessment"` with Fit's own configuration.
  Their response subsections sanitize independently. `mode: "fit-assessment"`
  reruns only the compact fit after a relevant input changes. Fit's normalized
  input limits (`fitAssessmentInputLimitError`) are measured before any
  dispatch on both paths: the standalone route answers with the existing
  input-limit explanation and zero attempts, and combined Prepare omits the
  Fit section while Job analysis still runs. The sanitizer repeats the check
  on the response as defense in depth. Fit Assessment must
  follow the canonical
  [`server/ai/README.md`](README.md#fit-assessment-technical-contract)
  contract: both paths render one exported rules block and request exact
  current-source excerpts. Unlocated references and explicit conflicts remain
  visible as warnings; safe conclusions and summary prose are preserved.
  The model owns semantic judgment; no requirement ledger, completeness gate,
  deterministic verdict calculation, or guessed fallback is permitted.
  Cover-letter tailoring is one operation over the source letter and candidate
  evidence. Shared preflight requires a prepared role/company, and the route
  also requires resume evidence; a missing candidate name or private fact is
  advisory. Safe placeholders
  remain usable text with warnings. No additional evidence-planning stage exists.
- `grounding.ts` provides deterministic evidence checks. The direct category
  rubric in `fitAssessment.ts` is provider-applied; do not add a deterministic
  fit classifier, numeric scores, or a visible/persisted ledger.
- Evidence selection belongs to the model, not to the candidate and not to a
  prompt-enforced count. The server sends the whole corpus, verifies the ids
  that come back, and reports provenance. Do not reintroduce a preparation plan,
  a use/skip classification pass, or a selected-evidence request field.
- Cover-letter validation separates content findings from technical defects.
  A usable body returns `ready` with warnings without repair. Unusable structure
  may receive one silent repair; a repeated technical failure returns bounded
  user-safe issues and leaves the editor unchanged. Never expose internal repair
  instructions or treat source-id location as factual verification. Acceptance
  remains a client-side boundary, not another server stage.
- Cover-letter findings have two lifetimes, decided by `isCoverLetterConcern`.
  `concerns` are claim findings about the wording (evidence-category issues
  other than citation bookkeeping, plus a cited unanswered private slot); the
  client carries them past acceptance. `warnings` describe one draft
  (structure, quality, unknown or missing citations, leftover template tokens,
  phrasing, length, model notes) and are recomputed each run. The model's
  optional `warnings` field is read as at most three sanitized, deduplicated
  notes prefixed `Model note:`, placed last so the list cap trims them first;
  malformed metadata is ignored, never an issue, and a note is display-only: it
  never becomes a concern, is stripped from the repair prompt's rejected
  output, and never re-enters a later request.
  (Offline measure on the 2026-10-05 benchmark letters: Sol wrote ~0.3 notes per
  letter, mostly eligibility gaps; Claude models 3-4, mostly "did not claim X".)
- Unfinished Guidance prompts are not evidence. Filter unresolved bracketed
  context in the browser corpus builder and independently at the server request
  boundary. Numeric grounding normalizes equivalent digit and word durations
  (for example, `3 years` and `three years`). A duration absent from candidate
  evidence must produce a warning, not discard usable text.
- A pure employer fact may stay outside the candidate-claim surface, but an
  employer-led sentence that compares the employer with candidate experience or
  implies a candidate background remains inside the grounding checks. Grammatical
  subject alone is not an evidence exemption.
- Bracketed slot text is a drafting instruction, never candidate evidence and
  never voice. The model may legitimately leave a slot unused. Optional private
  facts can be flagged but must not require user input before usable output
  proceeds; they do not become operational requirements merely by appearing in
  a template.
- Cover-letter length is a warning, never a gate. Do not restore a word-count or
  verbatim-source-phrase acceptance check: both reject genuinely better letters.
- A cited slot id that the source letter really has (the deterministic role,
  company, name, or date slot) is dropped, never repaired: on the 2026-10-05
  benchmark every model cited one beside the paragraph naming the role, and
  that alone sent 114 of 120 letters through the repair pass. A cited
  unanswered private slot (a referral) is the clearest sign of an invented
  fact, so it becomes a non-blocking warning on that paragraph, never a drop
  or a repair. Only an id the source never had is a technical defect.
- Cover-letter evidence warnings are benchmark-backed (2026-10-05, replaying
  real letters against GPT-6 Astra per-sentence labels; see `CONTINUITY.md`).
  Each rule below removed false warnings on honest prose; the recall given up
  is recorded in `CONTINUITY.md`, and the resume warning replay stayed at
  parity:
  - A citation grounds its whole entry: the other bullets of that resume entry
    and the Profile section the shared Profile linker ties to it
    (`shared/candidateProfileContract.ts`: a heading naming exactly one dated
    resume entry, with every enclosing heading naming it or merely grouping;
    the label's first segment and an employer-like segment name the entry, a
    stack list, location, or date never does). Any other heading forms its
    own group, an unlinked heading that names some entry leaves its parent's
    section, lines under no heading or directly under a grouping heading
    stand alone, and Skills rows never link. Owners are read by heading
    position, so a "### Atlas" nested under an unrelated heading is not the
    top-level "## Atlas", and a heading that carries a bracketed slot ("##
    Beacon [add dates]", or a slot-only "## [Project name]", kept as "##
    (untitled)") keeps its place without the slot. A sentence that names
    exactly one resume entry with a multi-part label, written as a name
    with a capitalised first letter, so "the frontend" is not a name, and a
    single-title entry or a Skills row such as "Frontend" is never named,
    is checked against that entry alone, cited or not: it cannot borrow
    another entry's tools, counts, or outcomes, and a missed citation is
    bookkeeping. Two entries sharing a title ("Software Engineer" twice) never
    pool: the sentence keeps only the cited one.
  - The checked surface of a candidate sentence drops only the clause a
    denial governs, and of that clause only the denial's own verb phrase
    (clauses split before "I"/"we": "Having never used Go, I shipped 12 Go
    services" keeps its second half; a denied verb takes its object list of
    name-like items joined by commas, "and", "or", or "nor", "I have not
    used Kafka, Airflow, or Spark", and stops at the next clause, so "though
    I ran 12 Spark clusters" stays; an experience denial takes its noun, "I
    have no production experience with Kafka"; a trailing denial, "with no
    prior experience", drops only itself; a
    verbless denial, "Never once did I miss a page", gives up at most four
    plain words and never a number, a name, or a tool, so "Not one of the 40
    Kafka consumers I shipped" and "Never did my 12 Airflow DAGs miss a run"
    keep their facts; an aspiration keeps its facts), the prepared role
    title only in an application frame ("applying for <role>",
    "the/this/your/<Company>'s <role> role", "as a <role> at <Company>"; "As
    the Senior Kafka Engineer at Harbor", "my previous <role> role",
    "Harbor's <role> role", "the <role> role at Harbor", and "the <role>
    role I held" are claims, while "the <role> role with your team" is the
    application), the company only in an employer frame ("at Databricks", "join
    Databricks", "why Databricks", "the Databricks team", or a possessive
    before an employer noun such as "Databricks' roadmap" or "mission";
    "Databricks engineering experience", "within Databricks", "Datadog's
    agent", and "Datadog's platform" stay checkable, so a "contribute to
    Snowflake" sentence may warn), "the <words> team" references unless the words carry a count
    or a tool, 401(k)-style plan names, and the word "one" except before a
    magnitude, percent, or duration or inside "fifty-one". An employer-led
    sentence is an employer statement only when "caught my attention" or
    "drew me" closes its clause (also "drew me in", "drew me to this role")
    or leads into "because" ("drew me to apply" counts); "which drew me
    after years building Kafka pipelines" stays a candidate sentence. A
    bare-apostrophe possessive ("Labs' work on") counts.
  - A count keeps its noun and may drop the evidence's modifiers but never gain
    one the evidence does not state ("14 critical bugs" from "14 bugs" warns);
    "300+", "300-plus", and "more than 300" all count the same noun, and the
    noun is the first plural before the next preposition or participle ("120+
    documented API endpoints" counts endpoints; "1 dashboard tracking
    errors" counts dashboards). "evaluations" and "evals" count the same
    thing; "apps" and "applications" do not; a percent keeps its own metric
    ("25 percent lower costs" is not grounded by "25 percent" of latency);
    "30d" and "5yrs" are durations that match "30 days" and "5 years",
    only digits glue ("tend" is not ten days), and "3D" is a name; "who"
    ends a counted phrase. A number word ends at a word
    boundary ("ones" is not a count); letters glued to digits stay a quantity
    ("200ms", "60fps", "5yrs") except the few that make a name (5G, 3GPP, 2FA,
    3D); a count never takes its noun from the next line.
  - Compound adjectives are not outcomes or ownership ("LLM-enabled",
    "API-driven"; "co-led", "self-directed", and "re-enabled" keep their
    verb), "grew out of" is an origin idiom, bare "led to" or "led me to" is
    causal while "I led them to" leads, a modal earlier in the same clause
    (before any comma or relative pronoun; "May" the month is not one) makes
    an outcome an offer, lowercase concepts match whole words and
    their plurals ("etl" is not inside "quietly"; "data pipelines" is still
    the concept), and PostgreSQL grounds "relational database".
  - A value only the candidate's own source letter supports is still allowed,
    but the result carries a warning naming it so a stale base letter gets
    corrected; the Profile may explicitly disclaim what an old letter claims.
  Accepted gaps: small narrative counts ("two bookings cannot overlap"), CI
  evidence for a "CI/CD" claim, a tool-bearing team name the posting itself
  uses ("the Kafka platform team" warns), and judgment calls the labels mark
  unsupported (what the candidate did "most", daily use, an unverifiable
  denial) are not lexical and stay with human review. A count-purpose check
  ("covered by 90+ tests") was tried on letters and dropped: 1 true of 7.
- `json.ts` and `errors.ts` own response parsing and user-safe failure mapping.

## Trust contracts

- Resume Polish prompts require suggestions grounded in the submitted
  resume/Profile context (`candidateContext`); never instruct JD-only skill
  insertion or fabrication.
  Only bullets (rewrite or remove), actual Skills lists, new-bullet slots for
  entries with linked Profile text, and standard-entry bullet orders are
  mutable targets; category labels and standard
  entry role, employer, subtitle, and date fields remain read-only evidence.
  An experience or project entry is grounded only by its own text and the
  Profile text its heading links (`linkProfileBlocks`); Skills and Summary may
  use the whole resume and Profile.
  Unknown/duplicate targets and unsafe or unusable mutation structures retain
  technical guards, and edits with unresolved template placeholders are
  withheld as malformed; unchanged text remains a no-op. Unsupported edits,
  category-like text in actual Skills targets, and cited-advice concerns remain
  reviewable with warnings. Withheld counts describe
  invalid/unusable operations, never content concerns or unchanged echoes.
  The "Proposed improvements" summary is editorial feedback: normalize and bound
  it without candidate-claim checks or generic evidence warnings. Proposed resume
  text and cited advice retain their checks.
  Changes beyond the bounded response window remain disclosed as malformed.
  Proposal decisions include run identity; supported-term preservation compares
  actual accepted edits with the current document, job, and supported baseline.
  True aliases can preserve a mention; related tools never establish support.
  Keep this advisory separate from Fit, without a score or coverage guarantee.
- Resume Polish warning precision is benchmark-backed (2026-10-04): replaying
  stored proposals against independent per-edit fact checks showed most warnings
  fired on honest paraphrases. These shared checks also serve cover letters,
  application answers and review, and Fit evidence. Each relaxation below was
  kept only where the replay showed it removed false warnings:
  - A sentence-initial, Title-case inflection of a listed action verb is
    grammar, not a claim, unless it is a known verb-named product (Boost,
    Scale, Drive, Make, Parse) or the posting uses it mid-sentence as a name
    ("experience with Index"). Unlisted -ed words and acronyms are not verbs.
  - A single verbless line naming the candidate's thing ("Python CLI that
    imports bank CSV exports") supports an authorship verb (Built, Developed…)
    when the rewrite names every word of that head phrase; lines naming a role,
    team, knowledge, coursework, or an activity (testing, review, fixes,
    audits, migration, pairing) do not.
  - In an entry where every linked Profile heading calls it a solo project
    ("## Ledger (personal project)"), one evidence line stating what the
    project has or does supports an authorship verb for that same thing. The
    claim needs at least three distinctive words, 80% of them from that one
    line, and neither the line, the current bullet, the claim, nor a heading may
    credit anyone else. Headings are the only accepted declaration: a body
    sentence inside a job entry is not, and one team heading leaves the whole
    entry shared. Leading, managing, and claims drawn from two lines still warn
    with the merge hint. Accepted gaps: a credit worded outside the marker list
    ("Frontend by my uncle"), and a third-party tool the project only uses
    restated as built ("Uses Stripe checkout" as "Built Stripe checkout").
    These three functions serve only Resume Polish but live in `grounding.ts`
    because they need its private token helpers.
  - A single line that leads with assisting others, in any tense ("Assist
    engineers in migrating…"), rewritten to lead with that assisted verb is an
    ownership increase unless evidence leads with the same verb.
  - Resume Polish bullets only (the `presentLead` option of
    `hasUnsupportedOwnershipIncrease`): a bullet, current bullet or evidence
    line that opens with a capitalised, whole-word, plain or -s present
    ownership verb ("Build…", "Owns…") claims its past form's level.
    - Not read that way: product names that are verbs, line-opening nouns such
      as "Design reviews" or "Direct-to-consumer", tokens glued to a hyphen,
      apostrophe or digit, and bases shorter than three letters ("L2").
    - The shared `ownershipStrength` keeps sentence and noun semantics for Fit,
      cover letters, Answers and review. A 2026-10-07 first version put the
      reading there and made nouns and titles count as ownership.
    - "lead time", "lead generation" and "lead scoring" are nouns everywhere;
      "lead time-series" still leads.
    - A 2026-10-07 replay showed no change on real applications. Five
      synthetic old-prompt flags are present-tense forms of the existing
      "Added/Wrote → Implemented/Developed" ownership rule.
  - Specific evidence entails its category or language (PostgreSQL→database,
    ARIA labels→accessibility, Docker→containerization, Django/pytest→Python,
    AWS/Azure/GCP→cloud, CI→continuous integration; CI evidence never
    grounds CI/CD and a statistical "95% CI" grounds nothing),
    never the reverse, never against a denial, and related practice never
    entails a broader term (CI is not CI/CD). Written-out, undenied
    "object-oriented" evidence grounds the abbreviation OOP. Terminology names are
    case-sensitive; lowercase-only grounding leaves out ambiguous names
    (flask, pandas). Contrived collisions (Django Reinhardt) and tools named
    only inside a posting's list ("Tools: Port, Backstage") are accepted gaps.
  - Skills: a new item warns when it or any parenthetical part is a category
    label (whole labels built from category words, any colon, or any Skills row
    label sent in the request), when a parenthetical is a proficiency qualifier
    ("(advanced)"), or when a parenthetical part is not grounded beside its
    head ("AWS (S3, EC2)"). Existing items are not re-judged. "Name API/SDK/CLI"
    is grounded only where the evidence attaches that interface to the name
    ("OpenAI and Anthropic APIs", "API providers (OpenAI, Anthropic)"), never by
    another name's interface or a stack list ("REST APIs (Django, PostgreSQL)").
    Names sharing one interface ("Mistral and Cohere APIs") and names in
    parentheses under an interface head ("LLM APIs (OpenAI, Anthropic)") each
    need that interface attached to them. REST and RESTful are one term (the
    plain word "rest" grounding either is an accepted gap), and a multi-word
    term whose last word has four or more letters also matches its singular
    ("code reviews"), never a different name ("AWS ECS" from "AWS EC2").
    "AI-assisted <activity>" is grounded by one affirmative line naming an AI
    coding tool and that activity; "AI-assisted development" needs only the
    tool ([USER] approved 2026-10-05: a paraphrase match, not a true alias).
    Codex, Copilot, Cursor, and Windsurf count only on a line that is also
    about coding, parenthetical parts must be named on that same line, and a
    denial of the practice or of the tool for that activity vetoes it.
    Accepted gaps: a line where the tool was replaced or banned for the
    activity, and a non-tool part named on the tool's line.
    Hyphenated practices ("AI-assisted", "test-driven") carry no ownership
    level; role phrases ("Team Lead", "Co-led…") still do.
  The replay showed no benefit, and reviews found fabrication holes, for
  treating reduction verbs as interchangeable ("cut" for "reduced") and for
  letting a count change its modifiers ("14 critical bugs"); both still warn.
  A count's magnitude stays with its noun and rate ("10k requests per second").
  A count also keeps the scope of its own evidence line: a checking purpose
  attached to it ("60 tests to verify X", "X, covered by 60 tests") warns unless
  a line holding that count names at least half the distinctive words of the
  purpose's first item or of the whole list. The purpose is read only between
  that count and the next one. Unsupported purposes attached this way were the
  largest class of missed edits in the replay; independent labels split on the
  mildest cases ("to validate backend changes"), which still warn because the
  statement is accurate. Purposes introduced with "for" are not detected.
  "One" followed by a participle counts the noun after it ("one shared lock"
  counts locks), so matching evidence grounds it and an invented one still warns.
  Do not restore warnings on sentence-initial verbs or verb choice alone.
- A Resume Polish evidence warning names what failed: up to three concerns, one
  per kind of check (term, number, count purpose, ownership, outcome), each echoing the edit's
  own wording. An ownership concern adds a merged-facts hint only when the
  current text makes no ownership claim and the entry uses a building verb
  elsewhere; a supporting line promoted to building or leading keeps the plain
  ownership wording. Do not return to one generic sentence or to naming only the
  first concern: a reviewer who fixes the named term would read the rest as
  checked.
- Churn settles as an `UNCHANGED` no-op, never a reviewable edit: a bullet
  rewrite that adds no word as written (only tense and number inflect), keeps
  the remaining words in order and marked alike, cuts under 15%, and deletes no
  narrowing claim word or count. Narrowing words, matched on the raw word, are
  exclusivity or scope ("solely", "all"), importance ("critical",
  "production"), seniority ("senior", "lead") and counts ("three engineers",
  digits). Such a deletion is a correction the user reviews. Some deletions
  widen the claim instead, so they stay a dropped no-op rather than an unwarned
  inflation: a negation or hedge ("not", "nearly"), or a partial quantity
  ("most", "half", or any deletion that removes "of" or a percentage, as in
  "40% of", "2 of the 5"). Stored benchmark receipts hold only surviving
  edits, so a replay cannot measure this rule. The same no-op rule covers a
  Skills row with the same items, written and marked the same, that moves no
  skill the posting names forward. Casing, spelling, symbol, and preposition
  changes are new words and stay reviewable. Dropping is safe because the resume
  keeps its text, but the filter is narrow by design: on 1,146 stored real
  edits it removed 3, none judged material (2026-10-04 replay). Length is never
  a materiality test in either direction, here or in the benchmark judge; page
  fit is the candidate's guidance and review, not a server rule.
- Resume Polish restraint rules are benchmark-backed: rewrites keep
  each bullet's existing tense, tense-only and synonym edits are churn, and
  separate facts or a broader posting term never become a new claim. Keep
  supporting-role and team wording explicit; adding "with" or "alongside"
  teammates does not justify promoting assistance to direct execution or
  ownership. Never compute totals such as years of experience from dates. The
  prompt tells the model to follow user_guidance preferences within these rules:
  the shared firewall still lists user_guidance as data, and without that line a
  static page-length preference was half-followed (2026-10-04 round-2 benchmark).
  Keep guidance-following in per-prompt lines, not the shared firewall. Do not
  restore the current-role present-tense rule: it made a quarter of rewrites
  tense-only churn that the grounding checks then flagged.
- The cover-letter prompt wording is benchmark-backed (2026-10-05/06, 40 real
  applications plus a disjoint holdout, blinded GPT-6 Astra + Claude Opus 5.5
  pairwise judging; numbers in `CONTINUITY.md`). A restraint-and-length variant
  (numbers keep noun and qualifier, team wording stays, no merged entries,
  scope notes never restated, no volunteered gaps, 3-4 paragraphs under 340
  words) beat the current wording on Sonnet 5.5 and Opus 5.5 but lost on GPT-6.1
  Sol medium 27-7, and Sol with the current wording wrote the best-judged
  letters of any arm (and the fewest unsupported sentences, 3-4%). The cover
  stage is configured for Sol, so the current wording stays; the losing variant
  is kept verbatim in the ignored `workspace/cover-benchmark/harness/variants.mjs`
  (`v3`) for a Claude-model setting. Do not add length or restraint lines
  without re-running that benchmark on the configured model: judges reward
  elaboration, and Sol already writes tersely and faithfully. The base letter
  is the stronger lever: a rewrite in a plain first-person voice (one short
  clinic story, one small engineering decision, no stack lists, no
  "I would bring X, Y, and Z") won 35-0 over the previous template on Sol.
- Polish failures fail plainly without changing the document. A failed opt-in
  review is not a Polish failure: it fails open to the unreviewed proposal.
  Job analysis and Fit Assessment failures are advisory to Prepare: the local brief
  remains usable, invalid fit never invalidates valid job fields, and neither
  failure authorizes silent fabrication or a substitute AI result.
- Propagate request cancellation into native API fetches and CLI subprocesses.
  Browser disconnect or Stop must terminate matching provider work and never
  advance a later stage.
- Credentials are provider-specific. Supported providers are Claude Code,
  Codex, and Antigravity CLIs plus native OpenAI and Anthropic APIs. Browser
  requests never carry managed API keys: a companion-owned server resolves API
  credentials from its private in-memory snapshot, while standalone/headless
  use may resolve explicit provider-specific `.env` keys. Unknown, removed,
  unconfigured, or unready providers fail closed without a paid fallback.

## Maintainability

- Keep provider quirks in provider clients/CLI adapters, not route orchestration.
- Clip structured fields before serialization; never slice serialized JSON.
- Share prompt rule helpers where behavior is intentionally identical, but keep
  stage schemas and responsibilities explicit.
- Avoid catch-all AI service classes and hidden retry/fallback chains. Response
  provenance and attempt counts must remain explicit.
- Keep errors user-safe but classified: auth, rate-limit/quota, configuration,
  timeout, and generic provider failure are distinct recovery cases.
  Cancellation is silent provider termination plus client Stop state, not an
  error class. Routine logs are shape-only; never include model-supplied target
  IDs, free-form provider/model errors, response fragments, or private inputs.
- Keep deterministic grounding/sanitizing functions separately testable.

## Verification

- Run the server TypeScript gate.
- Run the nearest offline eval under `server/ai/__evals__/`.
- Prompt, grounding, sanitizer, provider-contract, or scoring-contract changes
  require adversarial probes and a diff review before handoff.
- Fit Assessment changes require `fit-assessment-probes.mjs`,
  `fit-input-limit-probes.mjs`, and `fit-assessment-consistency-contracts.mjs`
  (which also runs the Prepare benchmark offline against a fake dispatcher);
  shared request or lifecycle changes additionally require the client request,
  lifecycle, and intake entry-point evals named in the app guide.
- `coverLetterJudge.ts` is benchmark-only: its rubric prompt and tolerant
  parser are pinned by `cover-letter-quality-contracts.mjs`; never GPT Sol as a
  judge, and never a judge pass in the product.
- Live provider evals cost tokens and may expose private inputs; run them only
  with explicit authorization and synthetic or approved fixtures.

## Evidence-grounding ownership

- `shared/evidencePolarity.ts` owns clause-level polarity for client and server.
  `shared/contentWarnings.ts` bounds every warning list (8 items, 500
  characters, markup stripped); `shared/jobAnalysisWarnings.ts` owns field-keyed
  historical job-warning metadata for saved-record compatibility only.
  `claimEvidence.ts` owns candidate-claim checks. `fitEvidence.ts` catches focused explicit conflicts;
  do not expand it into a lexical proof of semantic support or a second classifier.
  Fit is advisory: leave tool coverage and responsibility/ownership judgments to
  the model. Retain citation integrity, polarity, and explicit experience-source
  restrictions without importing document-generation word-matching gates.
- Resume replacement checks detect unfinished tokens and unsupported atoms;
  content-only failures become warnings. Complete
  target enumeration precedes budgeting. Optional structural advice is separately
  validated and never changes the document. Education uses the shared RoleFit
  classifier; credential-shaped titles stay locked even under mixed headings.
  Each selected entry is serialized once; targets reference its stable identity.
  Do not require auxiliary claim records or literal paraphrase proof after actual
  replacement checks pass. Advice is editorial guidance, not replacement text.
- `coverLetterParagraphEvidence.ts` checks explicit factual conflicts against
  paragraph-cited sources, narrowing to explicitly named work when identifiable.
  Employer claims use employer evidence. Run one typed factual pass per claim;
  explicit affiliations need candidate evidence, but generic capitalization is
  not proof of an invented name. Do not require sentence bindings or literal
  wording for paraphrases; ambiguous attribution is advisory, not repair.
- Job analysis delegates summaries and qualification classification to the model.
  Its prompt preserves alternatives, negation, thresholds, and required versus
  preferred qualifications; the response parser does not verify those judgments.
- `applicationReview.ts` permits exactly one dispatch, local findings on failure,
  and no persistence. Posting-only evidence cannot authorize candidate revisions;
  current-document references expose conflicts, not independent factual support.
