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

import { generateResumeProposal } from "../resumeProposal.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(APP_ROOT, "workspace/resume-proposal-eval");
const PROVIDER = process.env.EVAL_PROVIDER || "claude-cli";
const MODEL = process.env.EVAL_MODEL ?? (PROVIDER === "claude-cli" ? "opus" : "");
const RUNS = Number(process.argv[2] || 1);
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5) {
  console.error("runs must be an integer from 1 to 5");
  process.exit(2);
}

const resumeScope = {
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
        subtitleRight: "2022–present",
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
const scopeText = "EXPERIENCE\nSoftware Developer | Synthetic Systems\nSupported JavaScript and SQL services used by internal operations teams.\nBuilt automated tests and documented release procedures.\nSKILLS\nLanguages: JavaScript, SQL";
const jobText = "Software Developer responsible for JavaScript services, SQL data workflows, automated testing, and release documentation.";

mkdirSync(OUT_DIR, { recursive: true });
const summaries = [];
for (let run = 1; run <= RUNS; run += 1) {
  try {
    const result = await generateResumeProposal({
      body: { provider: PROVIDER, ...(MODEL ? { model: MODEL } : {}) },
      resumeScope,
      scopeText,
      jobText,
      honestContext: "",
      customInstructions: "Keep the candidate's supported ownership level unchanged."
    });
    const passed = result.status !== "WITHHELD" && result.changes.length > 0;
    writeFileSync(
      join(OUT_DIR, `${PROVIDER.replace(/[^a-z0-9-]/gi, "_")}-run-${run}.json`),
      JSON.stringify({ resumeScope, scopeText, jobText, result }, null, 2)
    );
    summaries.push({ run, passed, status: result.status, changes: result.changes.length, withheld: result.withheld.count });
  } catch (error) {
    summaries.push({ run, passed: false, error: error instanceof Error ? error.message : "unknown error" });
  }
}

console.log(`Resume Proposal live eval — provider=${PROVIDER} model=${MODEL || "(default)"} runs=${RUNS}`);
for (const summary of summaries) console.log(JSON.stringify(summary));
const failures = summaries.filter((summary) => !summary.passed);
console.log(`Result: ${summaries.length - failures.length}/${summaries.length} clean.`);
process.exit(failures.length ? 1 : 0);
