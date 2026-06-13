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
  reconcileFitVerdict,
  sanitizeTailorSuggestions,
  scoreFromBuckets
} from "../sanitize.mjs";

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
  ["BLOCKER gap caps both scores into DON'T-APPLY band", (() => {
    const r = applyGapCapsAndVerdict({ base: 73, tailored: 83, liftReason: "" }, { gaps: [{ severity: "BLOCKER" }] });
    return r.aiScore.base === 45 && r.aiScore.tailored === 45 && r.verdict === DONT;
  })()],
  ["HIGH gap caps below 70 and derives STRETCH", (() => {
    const r = applyGapCapsAndVerdict({ base: 60, tailored: 83, liftReason: "" }, { gaps: [{ severity: "HIGH" }] });
    return r.aiScore.tailored === 69 && r.verdict === "STRETCH" && r.aiScore.base === 60;
  })()],
  ["no qualifying gaps: verdict derived from sum", (() => {
    const r = applyGapCapsAndVerdict({ base: 73, tailored: 86, liftReason: "" }, { gaps: [{ severity: "MEDIUM" }] });
    return r.aiScore.tailored === 86 && r.verdict === "STRONG FIT";
  })()]
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
