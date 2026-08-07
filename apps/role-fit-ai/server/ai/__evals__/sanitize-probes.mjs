// Offline, deterministic probes for the tailor-suggestion sanitizer and the
// submission-assessment and tailoring contracts. No model calls, no network, runs in <1s:
//
//   node server/ai/__evals__/sanitize-probes.mjs
//
// Every case here is a regression lock for a failure observed live during the
// 2026-06-11 tailor-pipeline hardening:
// - formatted bullets (<b> editor tokens) silently killing ALL suggestions
// - "Windows"/"Linux" fabrications laundered through inferred-evidence prose,
//   including a hits:[] + evidence:"n/a" evasion of the hit-keyword gate
// - invalid AI-authored score/verdict pairs reaching the UI
// All fixture text is synthetic. Exit code is non-zero on any failure.

import assert from "node:assert/strict";

import {
  hasUngroundedNumericClaim,
  sanitizeMissingRequiredSkills,
  sanitizeTailorSuggestions,
  summarizeDroppedSuggestions
} from "../sanitize.ts";
import { findUngroundedJdTerm } from "../grounding.ts";
import { buildPolishPrompts, buildSubmissionAssessmentPrompts, serializeJsonForPrompt } from "../prompts.ts";
import {
  normalizeTailorScope,
  resolveReviewOutcome as resolveReviewOutcomeResult,
  reviewFailureFromReason,
  stripStructuralInlineMarks
} from "../polish.ts";
import { UserSafeAiError } from "../errors.ts";
import { parseSubmissionAssessment } from "../../../shared/fitAssessmentContract.ts";

function resolveReviewOutcome(...args) {
  const result = resolveReviewOutcomeResult(...args);
  return {
    submissionAssessment: result.status === "ok" ? result.assessment : null
  };
}

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

function sanitizedSuggestion({ proposedText, hits = [], honest = "", evidence = "quotes the EHR migration bullet", evidenceType = "exact" }) {
  return sanitizeTailorSuggestions(
    [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText, evidenceType, evidence, hits }],
    scope,
    {},
    honest,
    JD
  );
}

function survives(input) {
  return sanitizedSuggestion(input).length === 1;
}

const evasionStats = {};
sanitizeTailorSuggestions(
  [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" }, proposedText: "Led an <b>EHR migration</b> across <b>Linux</b>-based clinic systems.", evidenceType: "exact", evidence: "n/a", hits: [] }],
  scope, evasionStats, "", JD
);

const negativeQualificationContexts = [
  "I don't have production Kubernetes experience.",
  "I have no production Kubernetes experience.",
  "I am not proficient in Kubernetes.",
  "I have never used Kubernetes.",
  "I haven't used Kubernetes in production."
];

const checks = [
  ["string booleans cannot mark missing-skill evidence honestly addable", (() => {
    const items = sanitizeMissingRequiredSkills(
      [{ keyword: "PostgreSQL", evidenceType: "exact", canHonestlyAdd: "false", reason: "Resume lists PostgreSQL" }],
      "Required: PostgreSQL",
      "Resume lists PostgreSQL"
    );
    return items.length === 1 && items[0].canHonestlyAdd === false;
  })()],
  // --- editor inline-mark vocabulary vs real markup smuggling ---
  ["<b> editor token passes", survives({ proposedText: "Led the <b>EHR migration</b> with validation checks and rollback." })],
  ["<i>/<u> editor tokens pass", survives({ proposedText: "Led the migration with <i>validation</i> and <u>rollback</u> phases." })],
  ["unbalanced inline mark is rejected", !survives({ proposedText: "Led the <b>EHR migration with validation checks." })],
  ["misnested inline marks are rejected", !survives({ proposedText: "Led the <b><i>EHR migration</b></i> with validation checks." })],
  ["tag with attributes rejected", !survives({ proposedText: "Led the <b onclick=alert(1)>migration</b> cutover." })],
  ["script tag rejected", !survives({ proposedText: "Led the <script>x</script> migration." })],
  ["non-mark tag rejected", !survives({ proposedText: "Led the <em>migration</em> cutover." })],
  ["latex command rejected", !survives({ proposedText: "Led the \\href{x}{migration} cutover." })],
  ["newline rejected", !survives({ proposedText: "line one\nline two" })],

  // --- evidence requirements ---
  ["adjacent evidenceType rejected", !survives({ proposedText: "Led the migration with rollback.", evidenceType: "adjacent" })],
  ["placeholder evidence n/a rejected", evasionStats.missingEvidence === 1],
  ["short junk evidence rejected", !survives({ proposedText: "Led the migration with rollback.", evidence: "yes" })],
  ["common Codex evidence-locator wording stays grounded", survives({
    proposedText: "Led the EHR migration with production troubleshooting and validation checks.",
    evidence: "The existing bullet documents the EHR migration and production troubleshooting experience."
  })],
  ["overlong proposed text is rejected instead of silently truncated", (() => {
    const stats = {};
    const out = sanitizeTailorSuggestions(
      [{ target: { sectionId: "s", entryId: "e", bulletId: "b", field: "bullet" },
        proposedText: `Led the EHR migration ${"with validation checks ".repeat(90)}`,
        evidenceType: "exact", evidence: "The existing bullet documents the EHR migration." }],
      scope, stats, "", JD
    );
    return out.length === 0 && stats.overlongProposedText === 1;
  })()],
  ["honest-context attribution wording does not reject supported Claude Code/Codex skills", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, AWS, OpenAI", subtitleRight: "", bullets: [] }
    ] }] };
    const honest = "When the role mentions AI-assisted development or similar tools, highlight my practical experience using Claude Code and OpenAI Codex to support implementation planning, coding, debugging, refactoring, and code review.";
    return sanitizeTailorSuggestions(
      [{
        target: { sectionId: "sk", entryId: "row-tool", field: "skill" },
        proposedText: "Git, Docker, AWS, OpenAI, Claude Code, OpenAI Codex",
        evidenceType: "exact",
        evidence: "The honest context explicitly states practical experience using Claude Code and OpenAI Codex for implementation planning, coding, debugging, refactoring, and code review.",
        hits: ["AI-assisted development"]
      }],
      skillScope, {}, honest, "Experience with AI-assisted development tools is required."
    ).length === 1;
  })()],
  ["honest-context attribution wording does not reject supported Microsoft Office skills", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, AWS", subtitleRight: "", bullets: [] }
    ] }] };
    const honest = "I am proficient with Microsoft Word, Excel, and PowerPoint. When a job description mentions Microsoft Office, include this experience where relevant.";
    return sanitizeTailorSuggestions(
      [{
        target: { sectionId: "sk", entryId: "row-tool", field: "skill" },
        proposedText: "Git, Docker, AWS, Microsoft Office (Word, Excel, PowerPoint)",
        evidenceType: "exact",
        evidence: "The user explicitly confirms proficiency with Microsoft Word, Excel, and PowerPoint.",
        hits: ["Microsoft Office"]
      }],
      skillScope, {}, honest, "Proficiency with Microsoft Office is required."
    ).length === 1;
  })()],

  // --- keyword grounding (hit-based and proposed-text based) ---
  ["hit keyword written but ungrounded rejected", !survives({ proposedText: "Led an EHR migration on Windows workstations.", hits: ["Windows"] })],
  ["mid-sentence ungrounded JD term rejected (hits omitted)", !survives({ proposedText: "Coordinated rollout across Linux servers." })],
  ["JD term grounded by honest context passes", survives({ proposedText: "Deployed Kubernetes workloads on EKS for an internal service.", hits: ["Kubernetes"], honest: "Exact evidence: I deployed and monitored Kubernetes workloads on Amazon EKS in 2023." })],
  ["inflection tolerance (Postgres/PostgreSQL) passes", survives({ proposedText: "Tuned PostgreSQL queries for the reporting workload.", hits: ["PostgreSQL"] })],
  ["hit keyword reported but not written is stripped from the surviving suggestion", (() => {
    const output = sanitizedSuggestion({ proposedText: "Led an EHR migration with validation checks.", hits: ["Windows"] });
    return output.length === 1 && output[0].hits.length === 0;
  })()],
  ["non-JD proper claim absent from evidence is rejected", !survives({ proposedText: "Presented findings to the Cardiology team weekly." })],
  ["non-JD invented metric is rejected", !survives({ proposedText: "Led the EHR migration, reducing incidents by 99%." })],
  ["non-JD invented known tool is rejected", !survives({ proposedText: "Built GraphQL reporting services for the clinic." })],
  ["ordinary-language fabricated outcome is rejected", !survives({
    proposedText: "Led the EHR migration, prevented outages, and protected revenue."
  })],
  ["ordinary-language outcome survives when the entry evidence states it", survives({
    proposedText: "Led the EHR migration and prevented outages.",
    honest: "Exact evidence for this role: the EHR migration prevented outages."
  })],
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
      [{ target: { sectionId: "sk", entryId: "row-tool", bulletId: "b1", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: Microsoft Office Word Excel PowerPoint daily", hits: ["Microsoft Office"] }],
      skillScope, {}, "Exact evidence: I use Microsoft Office (Word, Excel, PowerPoint) daily.", "Requirements: Microsoft Office for documentation and reporting."
    ).length === 1;
  })()],
  ["skill add with no bulletId resolves", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "row-tool", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: Microsoft Office Word Excel PowerPoint daily", hits: ["Microsoft Office"] }],
      skillScope, {}, "Exact evidence: I use Microsoft Office (Word, Excel, PowerPoint) daily.", "Requirements: Microsoft Office for documentation and reporting."
    ).length === 1;
  })()],
  ["skill add with label text as entryId still drops (not auto-correctable)", (() => {
    const skillScope = { sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
      { id: "row-tool", titleLeft: "Tooling & Cloud", titleRight: "", subtitleLeft: "Git, Docker, Render", subtitleRight: "", bullets: [] }
    ] }] };
    return sanitizeTailorSuggestions(
      [{ target: { sectionId: "sk", entryId: "Tooling & Cloud", field: "skill" }, proposedText: "Git, Docker, Render, Microsoft Office (Word, Excel, PowerPoint)", evidenceType: "exact", evidence: "honest context: Microsoft Office Word Excel PowerPoint daily", hits: ["Microsoft Office"] }],
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
  ["malformed read-only context cannot crash otherwise valid sanitization", (() => {
    const malformedContextScope = {
      sections: [{ id: "sk", heading: "Technical Skills", type: "skills", entries: [
        { id: "row-tool", titleLeft: "Tooling", subtitleLeft: "Git, Docker", bullets: [] }
      ] }],
      contextSections: [null, 7, { heading: "Education", entries: [null] }]
    };
    try {
      return sanitizeTailorSuggestions(
        [{ target: { sectionId: "sk", entryId: "row-tool", field: "skill" },
          proposedText: "Docker, Git", evidenceType: "exact", evidence: "Both tools are already listed." }],
        malformedContextScope, {}, "", "Docker required."
      ).length === 1;
    } catch {
      return false;
    }
  })()],
  ["duplicate model ids are normalized to distinct suggestion ids", (() => {
    const out = sanitizeTailorSuggestions(
      [
        { id: "duplicate", target: { sectionId: "proj", entryId: "rolefit", bulletId: "b1", field: "bullet" },
          proposedText: "Built a resume review engine on a Node provider adapter with deterministic fallback behavior.",
          evidenceType: "exact", evidence: "The existing bullet documents the Node provider adapter and deterministic fallback." },
        { id: "duplicate", target: { sectionId: "proj", entryId: "pipe", bulletId: "b2", field: "bullet" },
          proposedText: "Built Python ETL jobs and containerized the batch pipeline with Docker.",
          evidenceType: "exact", evidence: "The existing bullet documents Python ETL jobs and Docker containers." }
      ],
      MULTI, {}, "", MULTI_JOB
    );
    return out.length === 2 && out[0].id !== out[1].id;
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

  // --- surface withheld fabrications: split unsupported (anti-fab) vs benign drops ---
  ["summarizeDroppedSuggestions: null when empty; splits unsupported vs benign", (() => {
    const empty = summarizeDroppedSuggestions({});
    const some = summarizeDroppedSuggestions({ ungroundedJdTerm: 2, missingEvidence: 1, duplicateTarget: 1, emptyOrUnchanged: 3 });
    return empty === null && some.total === 7 && some.unsupported === 3;
  })()],
  ["free prose cannot introduce a metric absent from resume or honest context", (() => {
    return hasUngroundedNumericClaim("Improved throughput by 40%.", "Improved throughput for the reporting service.")
      && !hasUngroundedNumericClaim("Improved throughput by 40%.", "Exact result: improved throughput by 40%.");
  })()],

  // --- canonical submission-assessment contract ---
  ["a complete grounded submission assessment is accepted", (() => {
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED",
      summary: "The resume shows Python clearly but should foreground deployment scope.",
      requirementVisibility: [{
        id: "python", requirement: "Python", sourceRequirement: "Python", importance: "CORE", coverage: "COVERED",
        evidence: [{ source: "RESUME", excerpt: "Python" }],
        explanation: "Python appears in Technical Skills.", canSurfaceInResume: false
      }],
      unsupportedClaims: [], missingEvidence: [], presentationIssues: ["Deployment detail is buried."],
      topEdits: ["Move the deployment bullet higher."]
    } }, "Python and deployment experience are required.", "Technical Skills: Python. Deployed APIs.", "");
    return result.submissionAssessment?.readiness === "REVISIONS_RECOMMENDED"
      && /^revisions recommended:/i.test(result.submissionAssessment.summary)
      && /resume directly presents trusted evidence/i.test(result.submissionAssessment.requirementVisibility[0].explanation)
      && result.submissionAssessment.topEdits[0] === "Move the deployment bullet higher.";
  })()],
  ["old score-shaped review output is invalidated without conversion", (() => {
    const result = resolveReviewOutcome({ strictReview: { verdict: "STRONG FIT" }, aiScore: { base: 70, tailored: 90 } }, "Python required.", "Python", "");
    return result.submissionAssessment === null;
  })()],
  ["invalid submission readiness is rejected", (() => {
    const result = resolveReviewOutcome({ submissionAssessment: { readiness: "MAYBE" } }, "Python required.", "Python", "");
    return result.submissionAssessment === null;
  })()],
  ["submission assessment rejects a requirement absent from the job", (() => {
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
      requirementVisibility: [{ id: "rust", requirement: "Rust", sourceRequirement: "Rust", importance: "CORE", coverage: "MISSING", evidence: [], explanation: "Not visible.", canSurfaceInResume: false }],
      unsupportedClaims: [], missingEvidence: ["Rust"], presentationIssues: [], topEdits: []
    } }, "Python required.", "Python", "");
    return result.submissionAssessment === null;
  })()],
  ["model surfacing metadata cannot override the server's evidence decision", (() => {
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
      requirementVisibility: [{ id: "python", requirement: "Python", sourceRequirement: "Python", importance: "CORE", coverage: "MISSING", evidence: [], explanation: "Not visible.", canSurfaceInResume: true }],
      unsupportedClaims: [], missingEvidence: ["Python"], presentationIssues: [], topEdits: []
    } }, "Python is required.", "Technical Skills: TypeScript.", "");
    return result.submissionAssessment?.requirementVisibility[0]?.canSurfaceInResume === false;
  })()],
  ...negativeQualificationContexts.map((honestContext) => [
    `negative honest context cannot authorize surfacing: ${honestContext}`,
    (() => {
      const result = resolveReviewOutcome({ submissionAssessment: {
        readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
        requirementVisibility: [{
          id: "kubernetes", requirement: "Production Kubernetes experience",
          sourceRequirement: "Production Kubernetes experience is required.",
          importance: "CORE", coverage: "MISSING",
          evidence: [{ source: "HONEST_CONTEXT", excerpt: honestContext }],
          explanation: "Not visible.", canSurfaceInResume: true
        }],
        unsupportedClaims: [], missingEvidence: [], presentationIssues: [], topEdits: []
      } }, "Production Kubernetes experience is required.", "Technical Skills: Python.", honestContext);
      return result.submissionAssessment === null;
    })()
  ]),
  ["positive relevant honest context can authorize surfacing a missing qualification", (() => {
    const honestContext = "I operate production Kubernetes services.";
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
      requirementVisibility: [{
        id: "kubernetes", requirement: "Production Kubernetes experience",
        sourceRequirement: "Production Kubernetes experience is required.",
        importance: "CORE", coverage: "MISSING",
        evidence: [{ source: "HONEST_CONTEXT", excerpt: honestContext }],
        explanation: "Not visible.", canSurfaceInResume: true
      }],
      unsupportedClaims: [], missingEvidence: [], presentationIssues: [], topEdits: []
    } }, "Production Kubernetes experience is required.", "Technical Skills: Python.", honestContext);
    return result.submissionAssessment?.requirementVisibility[0]?.canSurfaceInResume === true;
  })()],
  ["17 missing visibility rows survive the server-to-client round trip", (() => {
    const rows = Array.from({ length: 17 }, (_, index) => ({
      id: `missing-${index}`,
      requirement: `Required capability ${index}`,
      sourceRequirement: `Required capability ${index} must be demonstrated.`,
      importance: "SUPPORTING",
      coverage: "MISSING",
      evidence: [],
      explanation: "Not visible.",
      canSurfaceInResume: false
    }));
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
      requirementVisibility: rows,
      unsupportedClaims: [], missingEvidence: [], presentationIssues: [], topEdits: []
    } }, rows.map((row) => row.sourceRequirement).join("\n"), "Technical Skills: Python.", "");
    const reparsed = parseSubmissionAssessment(result.submissionAssessment);
    return result.submissionAssessment?.missingEvidence.length === 17
      && reparsed?.requirementVisibility.length === 17;
  })()],
  ["submission assessment rejects a fabricated technology and metric in top edits", (() => {
    const result = resolveReviewOutcome({ submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED", summary: "Review needed.",
      requirementVisibility: [{
        id: "python", requirement: "Python", sourceRequirement: "Python", importance: "CORE", coverage: "COVERED",
        evidence: [{ source: "RESUME", excerpt: "Python" }], explanation: "Python is visible.", canSurfaceInResume: false
      }],
      unsupportedClaims: [], missingEvidence: [], presentationIssues: [],
      topEdits: ["Add Kubernetes cluster operations and quantify the 30% latency reduction."]
    } }, "Python is required.", "Technical Skills: Python.", "");
    return result.submissionAssessment === null;
  })()],
  ["review failures preserve actionable safe classifications", (() => {
    const rateLimit = reviewFailureFromReason(new UserSafeAiError("OpenAI rate limit or quota was reached. Wait, then try again.", 429), "openai");
    const unknown = reviewFailureFromReason(new Error("secret upstream payload"), "openai");
    return rateLimit.status === 429 && /rate limit/i.test(rateLimit.message)
      && unknown.status === 502 && !unknown.message.includes("secret upstream payload");
  })()],
  ["submission prompt requests readiness without a fit-score contract", (() => {
    const { userPrompt } = buildSubmissionAssessmentPrompts({
      jobText: "Python and TypeScript are required.", resumeText: "Technical Skills: Python, TypeScript.", honestContext: "", customInstructions: ""
    });
    return /"submissionAssessment"/.test(userPrompt)
      && /"requirementVisibility"/.test(userPrompt)
      && /document readiness, not candidate fit/i.test(userPrompt)
      && !/"(?:score|aiScore|baseScore|tailoredScore)"\s*:/.test(userPrompt);
  })()],

  // --- JSON prompt budgets preserve syntax and caller-owned inputs. ---
  ["serializeJsonForPrompt is bounded, deterministic, valid JSON, and non-mutating", (() => {
    const input = {
      version: 1,
      items: Array.from({ length: 8 }, (_, index) => ({ id: `stable-id-${index}`, text: `${index}: ${"long resume evidence ".repeat(12)}` }))
    };
    const before = JSON.stringify(input);
    const first = serializeJsonForPrompt(input, 360);
    const second = serializeJsonForPrompt(input, 360);
    let parsed;
    try { parsed = JSON.parse(first); } catch { return false; }
    return first === second && first.length <= 360 && JSON.stringify(input) === before
      && parsed.version === 1 && Array.isArray(parsed.items) && parsed.items.length < input.items.length
      && parsed.items.every((item) => /^stable-id-/.test(item.id));
  })()],
  ["tailor prompt serializes read-only context exactly once", (() => {
    const { userPrompt } = buildPolishPrompts({
      jobText: "A sufficiently detailed job description for the synthetic prompt probe.",
      tailorScope: {
        version: 1,
        sections: [{ id: "editable-section", entries: [] }],
        contextSections: [{ id: "read-only-sentinel", entries: [] }]
      }
    });
    return (userPrompt.match(/read-only-sentinel/g) ?? []).length === 1
      && /<context_sections>[\s\S]*read-only-sentinel[\s\S]*<\/context_sections>/.test(userPrompt)
      && !/<tailor_scope>[\s\S]*read-only-sentinel[\s\S]*<\/tailor_scope>/.test(userPrompt);
  })()],
  ["tailor prompt does not license cross-entry context misattribution", (() => {
    const { userPrompt } = buildPolishPrompts({
      jobText: "Python required.",
      tailorScope: {
        version: 1,
        sections: [{ id: "editable", entries: [] }],
        contextSections: [{ id: "read-only", entries: [] }]
      }
    });
    return /context sections may support corpus-level skills or summary edits/i.test(userPrompt)
      && /must not attribute a context-only fact to a specific project or role/i.test(userPrompt);
  })()],
  ["tailor scope strips structural marks before prompt and grounding while preserving emphasis", (() => {
    const normalized = normalizeTailorScope({
      version: 1,
      locked: {
        omittedSections: ["<align=center>References</align>"]
      },
      sections: [{
        id: "experience",
        heading: "<align=center>Experience</align>",
        type: "standard",
        entries: [{
          id: "role",
          titleLeft: "<font=source-sans><b>Software Engineer</b></font>",
          titleRight: "<link=https://example.test>Acme</link>",
          subtitleLeft: "<size=11>Platform</size>",
          subtitleRight: "<nolink>2024</nolink>",
          bullets: [{
            id: "bullet",
            text: "<align=justify><b>Built</b> APIs with Node.js.</align>"
          }]
        }]
      }],
      contextSections: [{
        id: "education",
        heading: "Education",
        type: "standard",
        entries: [{
          id: "degree",
          titleLeft: "<link=https://school.test>State University</link>",
          bullets: []
        }]
      }]
    });
    const { userPrompt } = buildPolishPrompts({
      jobText: "A sufficiently detailed synthetic posting requiring Node.js API experience.",
      tailorScope: normalized
    });
    const serialized = JSON.stringify(normalized);
    return stripStructuralInlineMarks("<b>Keep</b><font=source-serif> structure</font>") === "<b>Keep</b> structure"
      && normalized.sections[0].heading === "Experience"
      && normalized.sections[0].entries[0].titleLeft === "<b>Software Engineer</b>"
      && normalized.sections[0].entries[0].titleRight === "Acme"
      && normalized.sections[0].entries[0].bullets[0].text === "<b>Built</b> APIs with Node.js."
      && normalized.contextSections[0].entries[0].titleLeft === "State University"
      && normalized.locked.omittedSections[0] === "References"
      && !/<\/?(?:font|size|align|link|nolink)(?:=|>)/i.test(serialized)
      && !/<\/?(?:font|size|align|link|nolink)(?:=|>)/i.test(userPrompt)
      && userPrompt.includes("<b>Software Engineer</b>");
  })()]
];

// Floor: silently deleting a check must shrink the gate loudly, not quietly.
// Raise this number whenever you ADD a check above.
assert(checks.length >= 70, `sanitize probe count dropped below the floor (70): found ${checks.length}`);

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
