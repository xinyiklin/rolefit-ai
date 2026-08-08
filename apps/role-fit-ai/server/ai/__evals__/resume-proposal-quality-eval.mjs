// Live, synthetic-only smoke harness for the one-call Resume Polish workflow.
// It never reads a user's workspace or prints generated resume text. Full
// synthetic inputs and sanitized results are written beneath gitignored
// workspace/resume-proposal-eval/ for deliberate manual inspection.
//
// Usage:
//   npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs]
//   EVAL_PROVIDER=codex-cli EVAL_MODEL=gpt-5.6-sol npm run eval:live:resume-proposal --workspace apps/role-fit-ai
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { flattenResumeTargets } from "../../../shared/resumePolishContract.ts";
import {
  findUngroundedClaimTerm,
  findUngroundedJdTerm,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease
} from "../grounding.ts";
import { generateResumeProposal } from "../resumeProposal.ts";
import { hasUngroundedNumericClaim } from "../sanitize.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(APP_ROOT, "workspace/resume-proposal-eval");
const PROVIDER = process.env.EVAL_PROVIDER || "claude-cli";
const MODEL = process.env.EVAL_MODEL ?? (PROVIDER === "claude-cli" ? "opus" : "");
const RUNS = Number(process.argv[2] || 1);
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5) {
  console.error("runs must be an integer from 1 to 5");
  process.exit(2);
}

const alignedScope = {
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: ["Education"] },
  sections: [
    {
      id: "experience",
      heading: "Experience",
      type: "standard",
      entries: [{
        id: "role-1",
        titleLeft: "Software Developer",
        titleRight: "Synthetic Systems",
        subtitleLeft: "",
        subtitleRight: "2022-present",
        bullets: [
          { id: "bullet-1", text: "Supported JavaScript and SQL services used by internal operations teams." },
          { id: "bullet-2", text: "Built automated tests and documented release procedures." }
        ]
      }]
    },
    {
      id: "skills",
      heading: "Skills",
      type: "skills",
      entries: [{
        id: "skills-1",
        titleLeft: "Languages",
        titleRight: "",
        subtitleLeft: "JavaScript, SQL",
        subtitleRight: "",
        bullets: []
      }]
    }
  ],
  contextSections: []
};
const alignedScopeText = "EXPERIENCE\nSoftware Developer | Synthetic Systems\nSupported JavaScript and SQL services used by internal operations teams.\nBuilt automated tests and documented release procedures.\nSKILLS\nLanguages: JavaScript, SQL";
const alignedJobText = "Software Developer responsible for JavaScript services, SQL data workflows, automated testing, and release documentation.";

const improvableScope = structuredClone(alignedScope);
improvableScope.sections[0].entries[0].bullets[0].text =
  "Built reporting tools used by internal operations teams. The tools used JavaScript and SQL.";
const improvableScopeText = "EXPERIENCE\nSoftware Developer | Synthetic Systems\nBuilt reporting tools used by internal operations teams. The tools used JavaScript and SQL.\nBuilt automated tests and documented release procedures.\nSKILLS\nLanguages: JavaScript, SQL";
const improvableJobText = "Software Developer responsible for JavaScript and SQL reporting tools, automated testing, and release documentation.";

const fixtures = [
  {
    name: "aligned",
    resumeScope: alignedScope,
    scopeText: alignedScopeText,
    jobText: alignedJobText,
    customInstructions: "Keep supported facts and ownership unchanged. Return NO_CHANGES when no material improvement is needed.",
    requiresProposal: false
  },
  {
    name: "improvable",
    resumeScope: improvableScope,
    scopeText: improvableScopeText,
    jobText: improvableJobText,
    customInstructions: "Make one safe bullet edit that foregrounds the supported JavaScript and SQL reporting work without changing facts or ownership.",
    requiresProposal: true
  }
];

function independentlySafe(fixture, result) {
  if (result.status === "WITHHELD") return false;
  if (fixture.requiresProposal && (result.status !== "PROPOSAL" || result.changes.length === 0)) return false;
  if (result.status === "NO_CHANGES") return result.changes.length === 0;
  if (result.status !== "PROPOSAL" || result.changes.length === 0) return false;

  const targets = flattenResumeTargets(fixture.resumeScope);
  const targetMap = new Map(targets.map((target) => [target.targetId, target]));
  for (const change of result.changes) {
    const target = targetMap.get(change.targetId);
    if (!target) return false;
    if (target.target.field !== "bullet" && target.target.field !== "skill") return false;
    const grounding = target.sectionType === "standard" ? target.entryText : fixture.scopeText;
    if (hasUngroundedNumericClaim(change.replacement, grounding)) return false;
    if (findUngroundedJdTerm(change.replacement, fixture.jobText.toLowerCase(), grounding.toLowerCase())) return false;
    if (findUngroundedClaimTerm(change.replacement, grounding)) return false;
    if (findUngroundedOutcomeClaim(change.replacement, grounding)) return false;
    if (hasUnsupportedOwnershipIncrease(change.replacement, target.currentText, target.entryText)) return false;
  }
  return true;
}

mkdirSync(OUT_DIR, { recursive: true });
const summaries = [];
for (let run = 1; run <= RUNS; run += 1) {
  for (const fixture of fixtures) {
    try {
      const result = await generateResumeProposal({
        body: { provider: PROVIDER, ...(MODEL ? { model: MODEL } : {}) },
        resumeScope: fixture.resumeScope,
        scopeText: fixture.scopeText,
        jobText: fixture.jobText,
        honestContext: "",
        customInstructions: fixture.customInstructions
      });
      const passed = independentlySafe(fixture, result);
      writeFileSync(
        join(OUT_DIR, `${PROVIDER.replace(/[^a-z0-9-]/gi, "_")}-${fixture.name}-run-${run}.json`),
        JSON.stringify({
          resumeScope: fixture.resumeScope,
          scopeText: fixture.scopeText,
          jobText: fixture.jobText,
          result
        }, null, 2)
      );
      summaries.push({ fixture: fixture.name, run, passed, status: result.status, changes: result.changes.length, withheld: result.withheld.count });
    } catch (error) {
      summaries.push({ fixture: fixture.name, run, passed: false, error: error instanceof Error ? error.message : "unknown error" });
    }
  }
}

console.log(`Resume Proposal live eval: provider=${PROVIDER} model=${MODEL || "(default)"} fixtures=${fixtures.length} runs=${RUNS}`);
for (const summary of summaries) console.log(JSON.stringify(summary));
const failures = summaries.filter((summary) => !summary.passed);
console.log(`Result: ${summaries.length - failures.length}/${summaries.length} clean.`);
process.exit(failures.length ? 1 : 0);
