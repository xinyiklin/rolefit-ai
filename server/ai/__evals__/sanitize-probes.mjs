// Offline, deterministic probes for the tailor-suggestion sanitizer and the
// fit-score/verdict rules. No model calls, no network, runs in <1s:
//
//   node server/ai/__evals__/sanitize-probes.mjs
//
// Every case here is a regression lock for a failure observed live during the
// 2026-06-11 tailor-pipeline hardening:
// - formatted bullets (<b> editor tokens) silently killing ALL suggestions
// - "Windows"/"Linux" fabrications laundered through inferred-evidence prose,
//   including a hits:[] + evidence:"n/a" evasion of the hit-keyword gate
// - verdict/score disagreement at band edges
// All fixture text is synthetic. Exit code is non-zero on any failure.

import {
  applyGapCapsAndVerdict,
  coverageHasEligibilityBlocker,
  makeRewriteGrounder,
  missingRequiredFromCoverage,
  reconcileFitVerdict,
  sanitizeTailorSuggestions,
  sanitizeStrictReview,
  scoreFromBuckets,
  scoreFromRequirementCoverage,
  summarizeDroppedSuggestions
} from "../sanitize.mjs";
import { findUngroundedJdTerm } from "../grounding.mjs";

const scope = {
  sections: [
    {
      id: "s",
      heading: "EXPERIENCE",
      type: "standard",
      entries: [
        {
          id: "e",
          titleLeft: "",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: [
            { id: "b", text: "Led an EHR migration at a clinic with production troubleshooting using PostgreSQL and JavaScript reporting tools." }
          ]
        }
      ]
    }
  ]
};
const JD = "Requirements: Linux administration, Windows support, Java backend services, PostgreSQL, Flask or FastAPI, Kubernetes on EKS, containerized deployments, microservices architecture, machine learning pipelines, CI/CD.";

// Multi-entry scope for the entry-scoped anti-misattribution probes: a Skills row
// listing Python/TS/SQL, a pure-Node RoleFit project (NO Python in its own text),
// and a separate Data Pipeline project that DOES use Python + Docker. Corpus-wide
// grounding would let "Python" from Skills/the pipeline leak onto the RoleFit
// bullet; entry-scoped grounding must not.
const MULTI = {
  sections: [
    { id: "sk", heading: "Skills", type: "skills", entries: [
      { id: "row", titleLeft: "Stack", titleRight: "", subtitleLeft: "Python, TypeScript, SQL", subtitleRight: "", bullets: [] }
    ] },
    { id: "proj", heading: "Projects", type: "standard", entries: [
      { id: "rolefit", titleLeft: "RoleFit AI", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
        { id: "b1", text: "Built a resume review engine on a Node provider adapter spanning 10+ LLM backends with a deterministic fallback." }
      ] },
      { id: "pipe", titleLeft: "Data Pipeline", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
        { id: "b2", text: "Built batch ETL jobs in Python and containerized them with Docker." }
      ] }
    ] }
  ]
};
const MULTI_JOB = "Requirements: Python, TypeScript, Node.js, Docker, LLM integration.";

function survives({ proposedText, hits = [], honest = "", evidence = "quotes the EHR migration bullet", evidenceType = "exact" }) {
  return sanitizeTailorSuggestions(
    [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText, evidenceType, evidence, hits }],
    scope,
    {},
    honest,
    JD
  ).length === 1;
}

const evasionStats = {};
sanitizeTailorSuggestions(
  [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText: "Led an <b>EHR migration</b> across <b>Linux</b>-based clinic systems.", evidenceType: "exact", evidence: "n/a", hits: [] }],
  scope, evasionStats, "", JD
);

const DONT = "DON'T APPLY";
const checks = [
  // --- editor inline-mark vocabulary vs real markup smuggling ---
  ["<b> editor token passes", survives({ proposedText: "Led the <b>EHR migration</b> with validation checks and rollback." })],
  ["<i>/<u> editor tokens pass", survives({ proposedText: "Led the migration with <i>validation</i> and <u>rollback</u> phases." })],
  ["tag with attributes rejected", !survives({ proposedText: "Led the <b onclick=alert(1)>migration</b> cutover." })],
  ["script tag rejected", !survives({ proposedText: "Led the <script>x</script> migration." })],
  ["non-mark tag rejected", !survives({ proposedText: "Led the <em>migration</em> cutover." })],
  ["latex command rejected", !survives({ proposedText: "Led the \\href{x}{migration} cutover." })],
  ["newline rejected", !survives({ proposedText: "line one\nline two" })],

  // --- evidence requirements ---
  ["adjacent evidenceType rejected", !survives({ proposedText: "Led the migration with rollback.", evidenceType: "adjacent" })],
  ["placeholder evidence n/a rejected", evasionStats.missingEvidence === 1],
  ["short junk evidence rejected", !survives({ proposedText: "Led the migration with rollback.", evidence: "yes" })],

  // --- keyword grounding (hit-based and proposed-text based) ---
  ["hit keyword written but ungrounded rejected", !survives({ proposedText: "Led an EHR migration on Windows workstations.", hits: ["Windows"] })],
  ["mid-sentence ungrounded JD term rejected (hits omitted)", !survives({ proposedText: "Coordinated rollout across Linux servers." })],
  ["JD term grounded by honest context passes", survives({ proposedText: "Deployed Kubernetes workloads on EKS for an internal service.", hits: ["Kubernetes"], honest: "Exact evidence: I deployed and monitored Kubernetes workloads on Amazon EKS in 2023." })],
  ["inflection tolerance (Postgres/PostgreSQL) passes", survives({ proposedText: "Tuned PostgreSQL queries for the reporting workload.", hits: ["PostgreSQL"] })],
  ["hit keyword reported but not written passes", survives({ proposedText: "Led an EHR migration with validation checks.", hits: ["Windows"] })],
  ["non-JD proper noun passes", survives({ proposedText: "Presented findings to the Cardiology team weekly." })],
  ["grounded rewrite passes", survives({ proposedText: "Led an EHR migration with production troubleshooting and rollback.", hits: ["EHR migration"] })],
  ["lowercase concept (microservices) ungrounded rejected", !survives({ proposedText: "Decomposed the clinic reporting into microservices." })],
  ["lowercase concept (machine learning) ungrounded rejected", !survives({ proposedText: "Applied machine learning to triage reporting requests." })],
  ["lowercase concept grounded by honest context passes", survives({ proposedText: "Maintained the machine learning evaluation scripts.", honest: "I maintained machine learning eval scripts for a research lab in 2023." })],
  ["leading tech-noun (sentence start) rejected", !survives({ proposedText: "Kubernetes deployments managed for the clinic reporting stack." })],
  ["leading action verb still passes", survives({ proposedText: "Migrated the clinic reporting workload with validation checks." })],
  ["prefix false-friend: Java NOT grounded by JavaScript", !survives({ proposedText: "Wrote Java services for clinic reporting." })],
  ["JavaScript itself stays grounded", survives({ proposedText: "Maintained JavaScript reporting tools for the clinic.", hits: ["JavaScript"] })],
  ["alias pair: k8s grounds Kubernetes term", survives({ proposedText: "Managed Kubernetes rollouts for the reporting stack.", honest: "I managed k8s rollouts on EKS in 2023." })],
  ["inflection: containerized grounded by container", survives({ proposedText: "Containerized the reporting service.", honest: "Built container builds for the reporting service." })],
  ["false-friend: React NOT grounded by reactive prose", (() => {
    const reactScope = { sections: [{ id: "s", heading: "X", type: "standard", entries: [{ id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: "Wrote reactive monitoring scripts for clinic alerts." }] }] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText: "Built React components for clinic alerts.", evidenceType: "exact", evidence: "quotes the monitoring bullet", hits: [] }],
      reactScope, {}, "", "Requirements: React experience."
    ).length === 0;
  })()],

  // --- detector 3 bounded-lexicon sweep: no over-flagging of English words,
  // --- but real lowercase tool names still get caught (both directions) ---
  ["English words shared with JD do NOT over-flag honest bullet", (() => {
    // Honest bullet whose ungrounded words ("and", "to", "support", "a",
    // "growing", "customer", "base") all appear in the JD; the real tech
    // (REST APIs) is grounded by the source bullet. The bounded lexicon must
    // ignore the English connectives and let the suggestion survive.
    const restScope = { sections: [{ id: "s", heading: "X", type: "standard", entries: [{ id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: "Designed and maintained REST APIs for the reporting service." }] }] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText: "Designed and maintained REST APIs to support a growing customer base.", evidenceType: "exact", evidence: "quotes the REST APIs bullet", hits: [] }],
      restScope, {}, "", "Requirements: Designed and maintained REST APIs to support a growing customer base across services."
    ).length === 1;
  })()],
  ["lowercase tool name (terraform) ungrounded rejected", (() => {
    const tfScope = { sections: [{ id: "s", heading: "X", type: "standard", entries: [{ id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: "Maintained the reporting stack and on-call runbooks." }] }] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText: "Provisioned terraform modules for the reporting stack.", evidenceType: "exact", evidence: "quotes the reporting stack bullet", hits: [] }],
      tfScope, {}, "", "Requirements: terraform for infrastructure provisioning."
    ).length === 0;
  })()],

  // --- skills-row targets: bulletId is meaningless for non-bullet fields and
  // --- must not block the target match (regression: a model attaching a stray
  // --- bulletId to a skill add silently dropped as unknownTarget, while the
  // --- changeSummary still claimed the edit landed) ---
  ["skill add with stray bulletId still resolves", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "row-tool", bulletId: "b1", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: uses Microsoft Office daily for documentation", hits: ["Microsoft Office"] }],
      skillScope, {}, "Exact evidence: I use Microsoft Office (Word, Excel, PowerPoint) daily.", "Requirements: Microsoft Office for documentation and reporting."
    ).length === 1;
  })()],
  ["skill add with no bulletId resolves", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "row-tool", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: uses Microsoft Office daily for documentation", hits: ["Microsoft Office"] }],
      skillScope, {}, "Exact evidence: I use Microsoft Office (Word, Excel, PowerPoint) daily.", "Requirements: Microsoft Office for documentation and reporting."
    ).length === 1;
  })()],
  ["skill add with label text as entryId still drops (not auto-correctable)", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "Tooling & Cloud", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: uses Microsoft Office daily for documentation", hits: ["Microsoft Office"] }],
      skillScope, {}, "Exact evidence: I use Microsoft Office (Word, Excel, PowerPoint) daily.", "Requirements: Microsoft Office for documentation and reporting."
    ).length === 0;
  })()],
  // --- skills field aliasing: the scope JSON exposes a skills row's list under
  // --- the property `subtitleLeft`, and the prompt lists BOTH "skill" and
  // --- "subtitleLeft" as valid fields, so a model routinely targets the literal
  // --- property name. That must resolve to the canonical "skill" target, not
  // --- drop as unknownTarget (the symptom: changeSummary claims a Skills edit
  // --- the resume never received). ---
  ["skill edit targeted as subtitleLeft resolves to the canonical skill target", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "row-tool", field: "subtitleLeft" }, proposedText: "Docker, Git, Render", reason: "surface containers first", evidenceType: "exact", evidence: "all three tools already listed in the skills row", hits: [] }],
      skillScope, {}, "", "Requirements: Docker and Git experience."
    );
    return out.length === 1 && out[0].target.field === "skill";
  })()],
  ["skill row reached via both skill + subtitleLeft dedups to one suggestion", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [
        { target: { sectionId: "sk", entryId: "row-tool", field: "skill" }, proposedText: "Docker, Git, Render", reason: "reorder", evidenceType: "exact", evidence: "all three tools already in the skills row", hits: [] },
        { target: { sectionId: "sk", entryId: "row-tool", field: "subtitleLeft" }, proposedText: "Render, Docker, Git", reason: "reorder again", evidenceType: "exact", evidence: "all three tools already in the skills row", hits: [] }
      ],
      skillScope, {}, "", "Requirements: Docker and Git experience."
    ).length === 1;
  })()],

  // --- entry-scoped grounding: anti-misattribution (a REAL skill relocated onto
  // --- a project that never used it). The RoleFit "Python/Node adapter" failure:
  // --- Python is in Skills + a different project, but NOT in the RoleFit entry,
  // --- so it must NOT be attachable to the RoleFit bullet. Skills-row adds keep
  // --- corpus grounding (a skill you have anywhere is legitimate to list). ---
  ["misattribution: Python (in Skills + other entry) NOT attachable to a pure-Node project bullet", (() => {
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "proj", entryId: "rolefit", bulletId: "b1", field: "bullet" },
         proposedText: "Built a resume review engine on a Python/Node provider adapter spanning 10+ LLM backends.",
         evidenceType: "exact", evidence: "Python is listed in skills and used in the data pipeline project", hits: ["Python"] }],
      MULTI, {}, "", MULTI_JOB
    );
    return out.length === 0;
  })()],
  ["same-entry tech still grounds (Docker written where the entry already uses it)", (() => {
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "proj", entryId: "pipe", bulletId: "b2", field: "bullet" },
         proposedText: "Built batch ETL jobs in Python, containerized with Docker for scale.",
         evidenceType: "exact", evidence: "quotes the ETL / Docker pipeline bullet", hits: ["Python", "Docker"] }],
      MULTI, {}, "", MULTI_JOB
    );
    return out.length === 1;
  })()],
  ["honest-context escape hatch grounds a standard-entry tech (TypeScript on RoleFit)", (() => {
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "proj", entryId: "rolefit", bulletId: "b1", field: "bullet" },
         proposedText: "Built a resume review engine on a Node adapter with a deterministic TypeScript fallback.",
         evidenceType: "exact", evidence: "honest context attests the fallback is TypeScript", hits: ["TypeScript"] }],
      MULTI, {}, "Exact evidence: RoleFit's deterministic fallback engine is written in TypeScript.", MULTI_JOB
    );
    return out.length === 1;
  })()],
  ["skills-row add stays corpus-grounded (Docker from another entry is a valid skill to list)", (() => {
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "row", field: "skill" },
         proposedText: "Python, TypeScript, SQL, Docker",
         evidenceType: "exact", evidence: "Docker is used in the data pipeline project", hits: ["Docker"] }],
      MULTI, {}, "", MULTI_JOB
    );
    return out.length === 1;
  })()],

  // --- Finding 1 regression lock: the hit-keyword gate is alias/inflection-aware,
  // --- so entry-scoped grounding does NOT false-drop an honest edit whose entry
  // --- spells a tech in its short/alias form while the hit names the long form. ---
  ["alias in entry grounds a long-form hit (entry has 'k8s', hit says 'Kubernetes') - no false drop", (() => {
    const aliasScope = { sections: [
      { id: "sk", heading: "Skills", type: "skills", entries: [
        { id: "row", titleLeft: "Infra", titleRight: "", subtitleLeft: "Kubernetes, Terraform", subtitleRight: "", bullets: [] }
      ] },
      { id: "exp", heading: "Experience", type: "standard", entries: [
        { id: "e1", titleLeft: "Platform Eng", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
          { id: "b", text: "Ran the reporting platform on k8s with rolling deploys." }
        ] }
      ] }
    ] };
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "exp", entryId: "e1", bulletId: "b", field: "bullet" },
         proposedText: "Ran the reporting platform on Kubernetes with rolling deploys and health checks.",
         evidenceType: "exact", evidence: "quotes the k8s reporting platform bullet", hits: ["Kubernetes"] }],
      aliasScope, {}, "", "Requirements: Kubernetes on EKS."
    );
    return out.length === 1;
  })()],

  // --- Finding 2 regression lock: the strict-review one-click "apply rewrite"
  // --- path is entry-scoped via makeRewriteGrounder, so the review pass cannot
  // --- reintroduce a misattribution the tailor gate drops. ---
  ["review rewrite CANNOT misattribute Python onto the pure-Node bullet (entry-scoped grounder)", (() => {
    const corpus = "Python, TypeScript, SQL\nBuilt a resume review engine on a Node provider adapter spanning 10+ LLM backends with a deterministic fallback.\nBuilt batch ETL jobs in Python and containerized them with Docker.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built a resume review engine on a Node provider adapter spanning 10+ LLM backends with a deterministic fallback.",
          rewrite: "Built a resume review engine on a Python/Node provider adapter spanning 10+ LLM backends." },
        { original: "Built batch ETL jobs in Python and containerized them with Docker.",
          rewrite: "Built batch ETL jobs in Python and containerized them with Docker for scale." }
      ] },
      MULTI_JOB.toLowerCase(),
      corpus,
      { rewriteGrounder: makeRewriteGrounder(MULTI, "", corpus) }
    );
    // Python-on-Node rewrite dropped; the same-entry ETL rewrite kept.
    return out.rewrites.length === 1 && /ETL jobs in Python/.test(out.rewrites[0].rewrite);
  })()],
  ["review rewrite: substring-superset entry does NOT mis-route grounding (re-review bypass)", (() => {
    // Entry A's bullet CONTAINS entry B's shorter bullet as a substring and A has
    // Python; the rewrite targets B's exact bullet and injects Python. A blob
    // substring match would ground against A (Python present) and pass; exact
    // bullet-equality grounds against B (no Python) and drops. Also matches the
    // client's findBullet, which applies the rewrite to B.
    const subScope = { sections: [
      { id: "exp", heading: "Experience", type: "standard", entries: [
        { id: "a", titleLeft: "Senior Eng", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
          { id: "ba", text: "Built the analytics ingestion pipeline for the reporting platform in Python with retries." }
        ] },
        { id: "b", titleLeft: "Analyst", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
          { id: "bb", text: "Built the analytics ingestion pipeline for the reporting platform" }
        ] }
      ] }
    ] };
    const corpus = "Built the analytics ingestion pipeline for the reporting platform in Python with retries.\nBuilt the analytics ingestion pipeline for the reporting platform";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built the analytics ingestion pipeline for the reporting platform",
          rewrite: "Built the analytics ingestion pipeline for the reporting platform in Python." }
      ] },
      "requirements: python.", corpus,
      { rewriteGrounder: makeRewriteGrounder(subScope, "", corpus) }
    );
    return out.rewrites.length === 0;
  })()],
  ["review rewrite WITHOUT grounder keeps corpus behavior (backward-compat)", (() => {
    const corpus = "Python, TypeScript, SQL\nBuilt a resume review engine on a Node provider adapter with a deterministic fallback.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built a resume review engine on a Node provider adapter with a deterministic fallback.",
          rewrite: "Built a resume review engine on a Python/Node provider adapter." }
      ] },
      "requirements: python, node.js.",
      corpus
    );
    // No grounder -> corpus grounding -> Python (in the Skills row of the corpus)
    // still passes. Documents the pre-fix behavior the grounder closes.
    return out.rewrites.length === 1;
  })()],

  // --- review rewrite `hits` grounding: the "✓ <kw>" chips claim JD coverage,
  // --- so a hit is kept only when the rewrite text surfaces it AND it is
  // --- grounded in the resume/context. A model can no longer stamp fabricated
  // --- ✓ matches onto a barely-changed rewrite (the tailor path already gated
  // --- its hits; this closes the review-path asymmetry). ---
  ["review rewrite: fabricated ✓ hit chips (absent from rewrite) are pruned, honest rewrite + real chip kept", (() => {
    const corpus = "Built the reporting service in Node with structured logging and a deterministic fallback.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built the reporting service in Node with structured logging and a deterministic fallback.",
          rewrite: "Built the reporting service in Node with structured logging, a deterministic fallback, and retries.",
          hits: ["Kubernetes", "AWS", "logging"] }
      ] },
      "requirements: kubernetes, aws, logging.", corpus
    );
    // Rewrite kept; only "logging" (in the text + grounded) survives — the
    // Kubernetes/AWS chips the text never surfaces are dropped.
    return out.rewrites.length === 1
      && out.rewrites[0].hits.length === 1
      && out.rewrites[0].hits[0] === "logging";
  })()],
  ["review rewrite: a grounded hit the rewrite actually surfaces is kept", (() => {
    const corpus = "Tuned PostgreSQL queries for the clinic reporting workload.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Tuned PostgreSQL queries for the clinic reporting workload.",
          rewrite: "Tuned PostgreSQL queries and indexes for the clinic reporting workload.",
          hits: ["PostgreSQL"] }
      ] },
      "requirements: postgresql.", corpus
    );
    return out.rewrites.length === 1 && out.rewrites[0].hits.length === 1 && out.rewrites[0].hits[0] === "PostgreSQL";
  })()],
  ["review rewrite: a short-token hit (Go) present + grounded survives the chip gate", (() => {
    const corpus = "Built services in Go for the ingestion pipeline.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built services in Go for the ingestion pipeline.",
          rewrite: "Built high-throughput services in Go for the ingestion pipeline.",
          hits: ["Go"] }
      ] },
      "requirements: go.", corpus
    );
    return out.rewrites.length === 1 && out.rewrites[0].hits.length === 1 && out.rewrites[0].hits[0] === "Go";
  })()],
  ["review rewrite: a MULTI-WORD hit the rewrite + grounding both surface is kept (phrase branch)", (() => {
    // Locks the phrase-branch survive path so a future normalizePhrase/isGrounded
    // edit can't silently regress multi-word ✓ chips. (Known limit: an inflected
    // variant — "machine learning" vs "machine-learning models" plural/word-order —
    // drops the one chip; safe-direction under-credit, tracked as a follow-up.)
    const corpus = "Shipped a machine learning pipeline for demand forecasting.";
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Shipped a machine learning pipeline for demand forecasting.",
          rewrite: "Shipped a machine learning pipeline that improved demand forecasting accuracy.",
          hits: ["machine learning"] }
      ] },
      "requirements: machine learning.", corpus
    );
    return out.rewrites.length === 1 && out.rewrites[0].hits.length === 1 && out.rewrites[0].hits[0] === "machine learning";
  })()],

  // --- prose-mode brand grounding (cover letters / application answers) ---
  // findUngroundedJdTerm(proposedText, jobLower, grounding) — caller lowercases
  // jobLower + grounding. Prose mode skips detector 1 (capitalized tokens) so
  // company/role proper nouns are NOT flagged, but curated branded tools routed
  // through detector 3 (LOWERCASE_TOOL_NAMES) still are.
  ["prose: ungrounded branded tool (Salesforce) in JD + letter, not in resume -> FLAGGED", (() => {
    const letter = "I am excited to bring my Salesforce administration experience to your team.";
    const job = "We need a Salesforce admin to manage our CRM workflows.".toLowerCase();
    const grounding = "Built reporting dashboards and managed a clinic intake workflow.".toLowerCase();
    return findUngroundedJdTerm(letter, job, grounding, { proseMode: true }) === "salesforce";
  })()],
  ["prose: branded tool present in grounding -> NOT flagged (grounded passes)", (() => {
    const letter = "My Salesforce administration experience maps directly to this role.";
    const job = "We need a Salesforce admin to manage our CRM workflows.".toLowerCase();
    const grounding = "Administered Salesforce for a 30-person sales org and built CRM reports.".toLowerCase();
    return findUngroundedJdTerm(letter, job, grounding, { proseMode: true }) === null;
  })()],
  ["prose: company proper noun (Acme) in JD -> NOT flagged (not in lexicon)", (() => {
    const letter = "I am excited about Acme's mission to modernize healthcare logistics.";
    const job = "Acme is hiring an operations analyst for our logistics team.".toLowerCase();
    const grounding = "Coordinated logistics for a regional distribution team.".toLowerCase();
    return findUngroundedJdTerm(letter, job, grounding, { proseMode: true }) === null;
  })()],
  // English-collision decision: "Excel" (the tool) is OMITTED from the lexicon
  // because "excel" doubles as the common verb ("excel at"). The honest prose
  // "I excel at..." must survive even with "Excel" present in the JD — a false
  // drop here would break an honest application, the worse failure.
  ["prose: honest 'I excel at' with Excel (tool) in JD -> NOT flagged (Excel excluded)", (() => {
    const letter = "I excel at cross-team collaboration and clear written communication.";
    const job = "Proficiency with Microsoft Excel and reporting is required.".toLowerCase();
    const grounding = "Coordinated cross-functional teams and wrote weekly status reports.".toLowerCase();
    return findUngroundedJdTerm(letter, job, grounding, { proseMode: true }) === null;
  })()],
  // Resume-mode (proseMode OFF) regression: detector 1 still flags a capitalized
  // ungrounded JD proper noun, so existing tailor-path behavior is unchanged.
  ["resume-mode regression: capitalized ungrounded JD term still flagged (proseMode off)", (() => {
    const proposed = "Coordinated rollout across Linux servers.";
    const job = "Requires Linux administration for the platform team.".toLowerCase();
    const grounding = "Coordinated a clinic reporting rollout with validation checks.".toLowerCase();
    return findUngroundedJdTerm(proposed, job, grounding) === "Linux";
  })()],
  ["resume-mode regression: branded tool (Salesforce) flagged in resume mode too", (() => {
    // In resume mode detector 1 (capitalized tokens) fires first and returns the
    // surface form "Salesforce"; prose mode would instead catch the lowercase
    // "salesforce" via detector 3. Either way the brand is flagged when ungrounded.
    const proposed = "Administered Salesforce for the reporting workflow.";
    const job = "We need a Salesforce admin.".toLowerCase();
    const grounding = "Maintained the reporting workflow and intake forms.".toLowerCase();
    const flagged = findUngroundedJdTerm(proposed, job, grounding);
    return typeof flagged === "string" && flagged.toLowerCase() === "salesforce";
  })()],

  // --- conservative verdict/score reconciliation (no-buckets fallback path) ---
  ["pessimistic verdict clamps base AND tailored down", JSON.stringify(reconcileFitVerdict({ base: 58, tailored: 59, liftReason: "" }, DONT).aiScore) === JSON.stringify({ base: 45, tailored: 45, liftReason: "" })],
  ["optimistic verdict downgrades, scores intact", (() => {
    const r = reconcileFitVerdict({ base: 82, tailored: 82, liftReason: "" }, "STRONG FIT");
    return r.verdict === "REASONABLE FIT" && r.aiScore.tailored === 82 && r.aiScore.base === 82;
  })()],
  ["agreeing pair untouched", (() => {
    const r = reconcileFitVerdict({ base: 60, tailored: 75, liftReason: "" }, "REASONABLE FIT");
    return r.verdict === "REASONABLE FIT" && r.aiScore.base === 60 && r.aiScore.tailored === 75;
  })()],

  // --- arithmetic bucket scoring + gap caps (primary path) ---
  ["bucket sums add and clamp per-bucket", (() => {
    const s = scoreFromBuckets({
      base: { requiredTech: 30, requiredDomains: 20, seniority: 10, preferred: 5, clarity: 8 },
      tailored: { requiredTech: 99, requiredDomains: 20, seniority: 10, preferred: 5, clarity: 8 },
      liftReason: "x"
    });
    return s.base === 73 && s.tailored === 83; // tailored requiredTech clamps 99 -> 40
  })()],
  ["sparse buckets rejected (needs >=3)", scoreFromBuckets({ base: { requiredTech: 40 }, tailored: { requiredTech: 40 } }) === null],
  ["missing buckets falls back to null", scoreFromBuckets(undefined) === null],
  ["requirement coverage derives base/tailored without model numbers", (() => {
    const s = scoreFromRequirementCoverage([
      { category: "Required tech", requirement: "React", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required tech", requirement: "TypeScript", importance: "high", baseStatus: "adjacent", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "REST API development", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Entry level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Preferred", requirement: "Healthcare domain", importance: "low", baseStatus: "missing", tailoredStatus: "adjacent" }
    ], { riskFlags: [] });
    return s.base === 77 && s.tailored === 95 && /TypeScript/.test(s.liftReason);
  })()],
  ["requirement coverage weighting makes critical misses hurt more", (() => {
    const s = scoreFromRequirementCoverage([
      { category: "Required tech", requirement: "Java", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "Git", importance: "low", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Backend APIs", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "New grad", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ], { riskFlags: [] });
    return s.tailored === 61;
  })()],
  ["sparse requirement coverage falls back to null", scoreFromRequirementCoverage([
    { category: "Required tech", requirement: "React", importance: "high", baseStatus: "covered", tailoredStatus: "covered" }
  ], { riskFlags: [] }) === null],
  ["BLOCKER gap caps both scores into DON'T-APPLY band", (() => {
    const r = applyGapCapsAndVerdict({ base: 73, tailored: 83, liftReason: "" }, { gaps: [{ severity: "BLOCKER" }] });
    return r.aiScore.base === 45 && r.aiScore.tailored === 45 && r.verdict === DONT;
  })()],
  // Graduated HIGH-gap cap: one missing required skill no longer pins to 69.
  ["1 HIGH gap caps at 79 -> REASONABLE FIT", (() => {
    const r = applyGapCapsAndVerdict({ base: 60, tailored: 83, liftReason: "" }, { gaps: [{ severity: "HIGH" }] });
    return r.aiScore.tailored === 79 && r.verdict === "REASONABLE FIT" && r.aiScore.base === 60;
  })()],
  ["2 HIGH gaps cap at 69 -> STRETCH (old flat behavior)", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 88, liftReason: "" }, { gaps: [{ severity: "HIGH" }, { severity: "HIGH" }] });
    return r.aiScore.tailored === 69 && r.verdict === "STRETCH";
  })()],
  ["3+ HIGH gaps cap at 60 -> STRETCH", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 88, liftReason: "" }, { gaps: [{ severity: "HIGH" }, { severity: "HIGH" }, { severity: "HIGH" }] });
    return r.aiScore.tailored === 60 && r.verdict === "STRETCH";
  })()],
  ["BLOCKER still overrides HIGH count -> DON'T APPLY", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 88, liftReason: "" }, { gaps: [{ severity: "HIGH" }, { severity: "BLOCKER" }] });
    return r.aiScore.tailored === 45 && r.verdict === DONT;
  })()],
  ["strict-review gap with unsafe suggestedEdit keeps gap but blanks edit", (() => {
    const review = sanitizeStrictReview({
      verdict: "STRETCH",
      gaps: [
        {
          gap: "Active Secret clearance",
          severity: "BLOCKER",
          evidenceType: "none",
          canHonestlyAdd: false,
          evidence: "Not in resume",
          suggestedEdit: "Add clearance\nSecond line"
        }
      ]
    }, "Requires Active Secret clearance.", "React projects");
    const r = applyGapCapsAndVerdict({ base: 82, tailored: 84, liftReason: "" }, review);
    return review?.gaps?.length === 1 && review.gaps[0].suggestedEdit === "" && r.verdict === DONT;
  })()],
  ["no qualifying gaps: verdict derived from sum", (() => {
    const r = applyGapCapsAndVerdict({ base: 73, tailored: 86, liftReason: "" }, { gaps: [{ severity: "MEDIUM" }] });
    return r.aiScore.tailored === 86 && r.verdict === "STRONG FIT";
  })()],

  // --- coverage-table eligibility blocker (Fix 2): a hard gate reported only as
  // --- a missing critical/high requirementCoverage row, NOT as a BLOCKER gap,
  // --- must still force the DON'T APPLY band ---
  ["coverage: missing critical clearance row (no BLOCKER gap) -> caps base+tailored <=45, DON'T APPLY", (() => {
    // The reviewer reports the hard gate as a coverage ROW (category carries the
    // "clearance" keyword), tailoredStatus "missing", and NO gap at severity
    // BLOCKER. Category must carry a bucketable token (sanitizeRequirementCoverage
    // drops un-bucketable rows) — "Active Secret clearance required" buckets as
    // seniority AND matches the eligibility sub-lexicon.
    const coverage = [
      { category: "Active Secret clearance required", requirement: "TS/SCI clearance", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "React", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Backend APIs", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Entry level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ];
    const hasBlocker = coverageHasEligibilityBlocker(coverage);
    const r = applyGapCapsAndVerdict({ base: 88, tailored: 90, liftReason: "" }, { gaps: [] }, hasBlocker);
    return hasBlocker && r.aiScore.base <= 45 && r.aiScore.tailored <= 45 && r.verdict === DONT;
  })()],
  ["coverage: missing work-auth/license rows also trigger the blocker", (() => {
    const visa = coverageHasEligibilityBlocker([
      { category: "Work authorization", requirement: "Must be authorized to work in the US without sponsorship", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "Python", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Data pipelines", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Mid level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ]);
    const license = coverageHasEligibilityBlocker([
      { category: "Certification", requirement: "Active RN license required", importance: "high", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "EHR systems", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Patient intake", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Entry level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ]);
    return visa && license;
  })()],
  ["coverage: missing '5+ years experience' seniority row (NOT eligibility) -> NOT a blocker", (() => {
    const coverage = [
      { category: "Required years", requirement: "5+ years of experience", importance: "high", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "React", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Frontend work", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Preferred", requirement: "GraphQL", importance: "low", baseStatus: "covered", tailoredStatus: "covered" }
    ];
    const hasBlocker = coverageHasEligibilityBlocker(coverage);
    // No coverage blocker, no gaps -> applyGapCapsAndVerdict leaves the score
    // uncapped (only normal scoring / HIGH-gap caps would apply elsewhere).
    const r = applyGapCapsAndVerdict({ base: 70, tailored: 78, liftReason: "" }, { gaps: [] }, hasBlocker);
    return hasBlocker === false && r.aiScore.tailored === 78 && r.verdict === "REASONABLE FIT";
  })()],
  ["coverage: COVERED clearance row (satisfied) -> NOT a blocker", (() => {
    const hasBlocker = coverageHasEligibilityBlocker([
      { category: "Eligibility", requirement: "Active Secret clearance", importance: "critical", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required tech", requirement: "Java", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "Backend services", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Mid level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ]);
    return hasBlocker === false;
  })()],
  ["coverage: low-importance missing eligibility row -> NOT a blocker (only critical/high escalate)", (() => {
    const hasBlocker = coverageHasEligibilityBlocker([
      { category: "Preferred certification", requirement: "AWS certification a plus", importance: "low", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "Node.js", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required experience", requirement: "API design", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Required years", requirement: "Entry level", importance: "medium", baseStatus: "covered", tailoredStatus: "covered" }
    ]);
    return hasBlocker === false;
  })()],
  ["coverage: eligibility keyword only in requirement under a NON-bucketing category ('Eligibility'/'Education') -> still fires the blocker + caps", (() => {
    // The gate keyword lives in `requirement`; the `category` ("Eligibility",
    // "Education") does NOT match any scoring bucket, so sanitizeRequirementCoverage
    // would DROP these rows. The raw-row scan must still catch them — otherwise an
    // ineligible role keeps a Strong-fit verdict. Locks the adversarial-review fix.
    const clearance = coverageHasEligibilityBlocker([
      { category: "Eligibility", requirement: "Must hold an active Top Secret/SCI clearance", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Skills", requirement: "Go", importance: "high", baseStatus: "covered", tailoredStatus: "covered" }
    ]);
    const degree = coverageHasEligibilityBlocker([
      { category: "Education", requirement: "Bachelor's degree in Nursing required", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" }
    ]);
    const r = applyGapCapsAndVerdict({ base: 84, tailored: 88, liftReason: "" }, { gaps: [] }, clearance);
    return clearance === true && degree === true && r.aiScore.tailored <= 45 && r.verdict === DONT;
  })()],
  ["applyGapCapsAndVerdict default hasCoverageBlocker preserves existing gap-only behavior", (() => {
    // Two-arg call (legacy signature) must behave exactly as before: no coverage
    // blocker, gap-based caps only.
    const r = applyGapCapsAndVerdict({ base: 73, tailored: 86, liftReason: "" }, { gaps: [{ severity: "HIGH" }] });
    return r.aiScore.tailored === 79 && r.verdict === "REASONABLE FIT";
  })()],

  // --- null aiScore (sparse review, no numeric score) still honors a hard
  // --- blocker: eligibility gate must force DON'T APPLY, not inherit the model's
  // --- verdict. Locks the applyGapCapsAndVerdict null-score hardening. ---
  ["null aiScore + coverage blocker -> DON'T APPLY (not the model's verdict)", (() => {
    const r = applyGapCapsAndVerdict(null, { verdict: "STRETCH", gaps: [] }, true);
    return r.aiScore === null && r.verdict === DONT;
  })()],
  ["null aiScore + BLOCKER gap -> DON'T APPLY", (() => {
    const r = applyGapCapsAndVerdict(null, { verdict: "REASONABLE FIT", gaps: [{ severity: "BLOCKER" }] });
    return r.aiScore === null && r.verdict === DONT;
  })()],
  ["null aiScore, no blocker -> sanitized verdict passes through unchanged", (() => {
    const r = applyGapCapsAndVerdict(null, { verdict: "STRETCH", gaps: [{ severity: "HIGH" }] });
    return r.aiScore === null && r.verdict === "STRETCH";
  })()],
  ["null aiScore, no strict review -> verdict null", (() => {
    const r = applyGapCapsAndVerdict(null, null);
    return r.aiScore === null && r.verdict === null;
  })()],

  // --- score-gameability reconciliation: cap on missing-required coverage rows
  // --- even when the model omits them from the gaps array ---
  ["missingRequiredFromCoverage counts critical/high missing required rows only", (() => {
    const cov = [
      { category: "Required tech", requirement: "Kubernetes", importance: "critical", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required experience", requirement: "Distributed systems", importance: "high", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "React", importance: "high", baseStatus: "covered", tailoredStatus: "covered" },
      { category: "Preferred", requirement: "GraphQL", importance: "low", baseStatus: "missing", tailoredStatus: "missing" },
      { category: "Required tech", requirement: "SQL", importance: "medium", baseStatus: "missing", tailoredStatus: "missing" }
    ];
    return missingRequiredFromCoverage(cov) === 2; // clearance/covered/preferred/medium excluded
  })()],
  ["reconcile: 2 missing required coverage rows the gaps array omitted -> cap 69 (not gameable)", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 92, liftReason: "" }, { gaps: [] }, false, 2);
    return r.aiScore.tailored === 69 && r.verdict === "STRETCH";
  })()],
  ["reconcile: honest reply (gaps agree with coverage) is unchanged", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 88, liftReason: "" }, { gaps: [{ severity: "HIGH" }] }, false, 1);
    return r.aiScore.tailored === 79 && r.verdict === "REASONABLE FIT";
  })()],
  ["reconcile: gaps stronger than coverage still governs (max, not override)", (() => {
    const r = applyGapCapsAndVerdict({ base: 90, tailored: 88, liftReason: "" }, { gaps: [{ severity: "HIGH" }, { severity: "HIGH" }, { severity: "HIGH" }] }, false, 1);
    return r.aiScore.tailored === 60; // max(3 gaps, 1 coverage) = 3 -> 60
  })()],

  // --- surface withheld fabrications: split unsupported (anti-fab) vs benign drops ---
  ["summarizeDroppedSuggestions: null when empty; splits unsupported vs benign", (() => {
    const empty = summarizeDroppedSuggestions({});
    const some = summarizeDroppedSuggestions({ ungroundedJdTerm: 2, missingEvidence: 1, duplicateTarget: 1, emptyOrUnchanged: 3 });
    return empty === null && some.total === 7 && some.unsupported === 3;
  })()]
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
