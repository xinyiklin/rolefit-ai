// Anti-fabrication probes for the LOCAL fallback polisher (rewrite.ts). These
// lock the behaviors a hardening audit flagged as the highest-risk fabrication
// vectors — the deterministic polisher must NEVER assert a resume fact the
// source doesn't support, never drop real content, and never double a verb.
//
//   node src/resume/__evals__/rewrite-eval.mjs
//
// rewrite.ts imports ./keywords + ./text + ./scoring, so it must be BUNDLED
// (not just transformed) before import.

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function load() {
  const entry = fileURLToPath(new URL("../../resumeEngine.ts", import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { polishResume, normalizePolishedResume } = await load();

const JD = "Tech Stack / Keywords:\n- React\n- AWS\n- Kubernetes\nSeniority Signals:\n- entry-level";
const HEAD = ["Jane Dev", "jane@example.com | github.com/jane", "", "EXPERIENCE", "Acme | Software Engineer | 2023-2025"];
const EDU = ["", "EDUCATION", "State University | BS Computer Science | 2019-2023"];
const resumeOf = (bullets) => [...HEAD, ...bullets, ...EDU].join("\n");
const bulletsOf = (text) => text.split("\n").filter((l) => /^\s*[-*•]\s+/.test(l));
const stripMetric = (l) => l.replace(/\s*\[add metric[^\]]*\]/gi, "");

// ── 1. Anti-fabrication verb gate: a bullet that started with its OWN words and
// negates / attributes the action elsewhere must NOT get an asserted action verb.
const gated = polishResume(
  resumeOf([
    "- never deployed to production; my work stayed in a sandbox for the team",
    "- testing was handled by the QA team, not me, on the checkout service",
    "- shadowed a senior engineer who built the backend api for payments"
  ]),
  JD
).polishedText;
const gatedBullets = bulletsOf(gated).map(stripMetric);

// ── 1b. The HARDER gate case: a recognized weak-lead phrase IS stripped, but the
// remainder negates the action or attributes it to a third party. We must still
// NOT assert a verb (the weak lead does not prove the candidate did the work).
const gated2 = polishResume(
  resumeOf([
    "- responsible for shadowing a senior engineer who built the payments backend service",
    "- worked on tickets that the QA team actually closed and verified each release cycle",
    "- used a deployment tool that a contractor had already configured before I joined here"
  ]),
  JD
).polishedText;
const ASSERTED = /\b(built|designed|developed|deployed|delivered|validated|strengthened|coordinated|resolved|automated|engineered|integrated)\s+(shadowing|tickets|a deployment tool)/i;
// A bare gerund weak-lead must not double the verb.
const bareGerund = polishResume(resumeOf(["- worked on deploying"]), JD).polishedText;

// ── 2. A recognized weak-lead phrase ("responsible for") DOES get strengthened.
const strengthened = polishResume(
  resumeOf(["- responsible for the ci/cd release pipeline and staging for the squad"]),
  JD
).polishedText;

// ── 3. A gerund lead is kept as-is (no asserted verb prepended) — so a real verb
// gerund is never doubled ("Deployed deploying") AND a noun-modifier gerund
// ("testing frameworks", "string parsing") is never stripped/corrupted.
const gerund = polishResume(
  resumeOf([
    "- worked on deploying microservices on aws for the platform team",
    "- string parsing utilities reduced log noise across the pipeline for the team"
  ]),
  JD
).polishedText;

// ── 4. No skill fabrication: the resume has React/Node but NOT AWS/Kubernetes,
// even though the JD lists them — the polished SKILLS/SUMMARY must not assert them.
const noFab = polishResume(
  resumeOf(["- Built a React and Node.js dashboard for the internal operations team"]),
  JD
).polishedText;

// ── 5. Data loss: normalizePolishedResume must keep a real bullet that contains
// an email / URL / phone (it only strips a duplicated header contact LINE).
const normalized = normalizePolishedResume(
  [
    "Jane Dev",
    "jane@example.com | github.com/jane",
    "",
    "EXPERIENCE",
    "- Cut p95 latency 30%, dashboards at github.com/jane/perf",
    "- Shipped the notify@acme.com alerting service",
    "- Built the React frontend"
  ].join("\n"),
  ""
);

// ── 6. Aspirational / second-hand skills must NOT be asserted in the GENERATED
// summary/skills, even though the source bullet that mentions them is preserved.
// Real skills (incl. "machine learning", which must survive the aspirational
// marker check that contains the word "learning") are kept and de-duplicated.
const aspir = polishResume(
  resumeOf([
    "- Built React and TypeScript dashboards, wrote Node.js REST APIs, trained machine learning models",
    "- Familiar with Kubernetes and Docker but never used them in production myself here"
  ]),
  "Tech Stack / Keywords:\n- React\n- machine learning\n- Kubernetes\n- Docker"
).polishedText.split("\n");
const aSummary = aspir.find((l) => /targeting the role/i.test(l)) || "";
const aSkillsIdx = aspir.findIndex((l) => /^technical skills$/i.test(l.trim()));
const aGenerated = aSummary + " " + (aSkillsIdx >= 0 ? aspir[aSkillsIdx + 1] : "");

// ── 7. Clause-scoped claim: on a mixed line, a skill in a NON-aspirational clause
// ("; shipped Docker …") is claimed while a skill in the "familiar with" clause is
// not — the old whole-line check wrongly suppressed Docker here.
const mixedLines = polishResume(
  resumeOf(["- Built React and Node.js apps; familiar with Kubernetes; shipped Docker pipelines to production"]),
  "Tech Stack / Keywords:\n- React\n- Node.js\n- Kubernetes\n- Docker"
).polishedText.split("\n");
const mSkillsIdx = mixedLines.findIndex((l) => /^technical skills$/i.test(l.trim()));
const mGen = (mixedLines.find((l) => /targeting the role/i.test(l)) || "") + " " + (mSkillsIdx >= 0 ? mixedLines[mSkillsIdx + 1] : "");

// ── 7b. A pipe-separated aspirational LIST must stay fully excluded — "|" is a
// list separator here, so the marker governs every item (no over-claim).
const pipeList = polishResume(
  resumeOf(["- Built React and Node.js services for the analytics platform team daily", "- Familiar with: Kubernetes | Docker | Terraform"]),
  "Tech Stack / Keywords:\n- React\n- Kubernetes\n- Docker\n- Terraform"
).polishedText;
const pSummary = pipeList.split("\n").find((l) => /targeting the role/i.test(l)) || "";

// ── 8. An entry/project HEADING that contains a URL is not deleted as a contact line.
const projHeading = normalizePolishedResume(
  ["Jane Dev", "jane@example.com | github.com/jane", "", "PROJECTS", "Portfolio Site | github.com/jane/portfolio | 2024", "- Built a static site with React"].join("\n"),
  ""
);

const checks = [
  // 6 — skill attribution (generated sections only)
  ["aspirational-only Kubernetes not asserted in generated summary/skills", !/kubernetes/i.test(aGenerated)],
  ["aspirational-only Docker not asserted in generated summary/skills", !/docker/i.test(aGenerated)],
  ["real machine learning still asserted (no 'learning' false-exclude)", /machine learning/i.test(aGenerated)],
  ["real React still asserted in generated", /react/i.test(aGenerated)],
  ["no bigram-subword redundancy ('Machine Learning, Learning, Machine')", !/machine learning,\s*(learning|machine)\b/i.test(aSummary)],

  // 7 — clause-scoped skill claim
  ["clause-scoped: Docker in its own non-aspirational clause is claimed", /docker/i.test(mGen)],
  ["clause-scoped: Kubernetes only in a 'familiar with' clause is excluded", !/kubernetes/i.test(mGen)],
  ["pipe-separated aspirational list stays fully excluded (no over-claim)", !/kubernetes/i.test(pSummary) && !/docker/i.test(pSummary) && !/terraform/i.test(pSummary)],

  // 8 — entry/project heading with a URL is not deleted
  ["project heading with URL survives normalize", projHeading.includes("Portfolio Site") && projHeading.includes("github.com/jane/portfolio")],

  // 1 — gate
  ["negation preserved (no asserted 'Deployed')", gatedBullets.some((b) => /never deployed/i.test(b)) && !/deployed\s+never/i.test(gated)],
  ["passive/third-party preserved (QA handled it)", gatedBullets.some((b) => /^- testing was handled/i.test(b)) && !/validated\s+(was\s+)?handled/i.test(gated)],
  ["third-party-built preserved (candidate shadowed)", gatedBullets.some((b) => /^- shadowed a senior/i.test(b)) && !/built\s+shadowed/i.test(gated)],

  // 1b — weak-lead stripped but remainder is negated / third-party owned
  ["weak-lead + third-party clause is NOT actionized", !ASSERTED.test(gated2)],
  ["3rd-party 'who built' preserved", /shadowing a senior engineer who built/i.test(gated2)],
  ["3rd-party 'QA team closed' preserved", /tickets that the qa team/i.test(gated2)],
  ["3rd-party 'contractor configured' preserved", /a contractor had already configured/i.test(gated2)],
  ["bare gerund weak-lead not doubled ('Deployed deploying')", !/deployed deploying/i.test(bareGerund)],

  // 2 — legitimate strengthening still happens
  ["weak-lead 'responsible for' is stripped + actionized", !/responsible for/i.test(strengthened) && /ci\/cd/i.test(strengthened)],

  // 3 — gerund handling: lead kept verbatim, never doubled, never stripped
  ["gerund lead kept (no double verb)", /deploying microservices on aws/i.test(gerund) && !/deployed deploying/i.test(gerund)],
  ["non-gerund noun lead not mangled ('string' kept)", /string parsing utilities/i.test(gerund)],
  ["noun-modifier gerund not stripped ('testing frameworks' kept whole)", (() => { const t = polishResume(resumeOf(["- responsible for testing frameworks across the release pipeline"]), JD).polishedText; return /testing frameworks/i.test(t); })()],

  // 4 — no skill fabrication from the JD
  ["no fabricated AWS in skills/summary", !/\baws\b/i.test(noFab)],
  ["no fabricated Kubernetes in skills/summary", !/kubernetes/i.test(noFab)],
  ["real React still surfaced", /react/i.test(noFab)],

  // 5 — no content loss
  ["URL bullet survives normalize", normalized.includes("github.com/jane/perf")],
  ["email bullet survives normalize", normalized.includes("notify@acme.com")]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  process.exit(1);
}
console.log(`rewrite anti-fabrication probes passed (${checks.length}/${checks.length})`);
