// Live, synthetic-only quality harness for the two-pass cover-letter workflow.
// It never reads a user's workspace or prints generated prose. Full provider
// responses are written under the gitignored workspace/cover-letter-eval/
// directory for deliberate manual inspection.
//
// Usage:
//   npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs]
//   EVAL_PROVIDER=codex-cli EVAL_MODEL=gpt-5.6-sol npm run eval:live:cover-letter --workspace apps/role-fit-ai
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COVER_LETTER_STYLE_DEFAULTS,
  coverLetterStyleToDocumentStyle,
  parseCoverLetterText
} from "@typeset/engine/lib/coverLetter.ts";
import { layoutCoverLetter } from "@typeset/engine/typeset/layout.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { draftPreparedCoverLetter, prepareCoverLetter } from "../coverLetter.ts";
import { gradeCoverLetterProposal } from "../coverLetterQuality.ts";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(APP_ROOT, "workspace/cover-letter-eval");
const PROVIDER = process.env.EVAL_PROVIDER || "claude-cli";
const MODEL = process.env.EVAL_MODEL ?? (PROVIDER === "claude-cli" ? "opus" : "");
const fixtureFilter = process.argv[2] || "all";
const RUNS = Number(process.argv[3] || 1);
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5) {
  console.error("runs must be an integer from 1 to 5");
  process.exit(2);
}

const allFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/cover-letter-quality.json", import.meta.url), "utf8")
);
const fixtures =
  fixtureFilter === "all"
    ? allFixtures
    : allFixtures.filter((fixture) => fixture.id === fixtureFilter);
if (fixtures.length === 0) {
  console.error(`Unknown fixture "${fixtureFilter}".`);
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });

function valuesFor(fixture) {
  return {
    candidate_name: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    recipient_name: fixture.recipientName,
    why_role: fixture.whyRole,
    lead_experience: fixture.leadExperience
  };
}

function selectedFor(plan, evidence) {
  const ids = new Set(
    plan.decisions
      .filter((decision) => decision.decision === "use")
      .map((decision) => decision.evidenceId)
  );
  return evidence.filter((item) => ids.has(item.id));
}

async function runFixture(fixture, run) {
  const preparationValues = valuesFor(fixture);
  const preflight = buildCoverLetterPreflight({
    text: fixture.sourceText,
    sourceMode: fixture.sourceMode,
    candidateName: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    values: preparationValues,
    date: "July 28, 2026"
  });
  if (!preflight.canPrepare) {
    return {
      fixture: fixture.id,
      run,
      error: "synthetic fixture failed preflight"
    };
  }
  const common = {
    provider: PROVIDER,
    model: MODEL,
    jobText: fixture.jobText,
    sourceContext: {
      rawTemplateText: fixture.sourceText,
      structuredTemplate: preflight.template.structuredTemplate,
      authoredProse: preflight.template.authoredProse,
      slots: preflight.template.slots
    },
    sourceMode: fixture.sourceMode,
    preparationValues,
    resolvedContext: preflight.resolved,
    customInstructions: ""
  };
  const preparation = await prepareCoverLetter({
    ...common,
    evidenceItems: fixture.evidence,
    clarificationAnswers: {}
  });
  if (preparation.status !== "ready") {
    return {
      fixture: fixture.id,
      run,
      error: "provider requested clarification",
      clarificationCount: preparation.clarifications.length
    };
  }
  const selectedEvidence = selectedFor(preparation.plan, fixture.evidence);
  const proposal = await draftPreparedCoverLetter({
    ...common,
    plan: preparation.plan,
    selectedEvidence
  });
  const pageCount = layoutCoverLetter(
    toTypesetSchema(parseCoverLetterText(proposal.coverLetterText)),
    coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
  ).pages.length;
  const report = gradeCoverLetterProposal({
    proposal,
    plan: preparation.plan,
    allEvidence: fixture.evidence,
    sourceMode: fixture.sourceMode,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: pageCount === 1
  });
  writeFileSync(
    join(OUT_DIR, `${fixture.id}-${PROVIDER.replace(/[^a-z0-9-]/gi, "_")}-run-${run}.json`),
    JSON.stringify({ fixture, preparation, proposal, pageCount, report }, null, 2)
  );
  return {
    fixture: fixture.id,
    run,
    score: report.score,
    passed: report.passed,
    selectedIds: selectedEvidence.map((item) => item.id),
    failedChecks: Object.entries(report.checks)
      .filter(([, result]) => !result.passed)
      .map(([name]) => name),
    pageCount
  };
}

console.log(
  `Cover-letter quality eval — provider=${PROVIDER} model=${MODEL || "(default)"} fixtures=${fixtures.length} runs=${RUNS}`
);
const results = [];
for (const fixture of fixtures) {
  for (let run = 1; run <= RUNS; run += 1) {
    try {
      results.push(await runFixture(fixture, run));
    } catch (error) {
      results.push({
        fixture: fixture.id,
        run,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }
}
for (const result of results) console.log(JSON.stringify(result));

const selectionSpread = new Map();
for (const result of results) {
  if (!result.selectedIds) continue;
  const choices = selectionSpread.get(result.fixture) ?? new Set();
  choices.add([...result.selectedIds].sort().join("|"));
  selectionSpread.set(result.fixture, choices);
}
for (const [fixture, choices] of selectionSpread) {
  if (choices.size > 1) {
    console.log(
      `WARN: ${fixture} selected ${choices.size} different evidence sets across identical runs.`
    );
  }
}

const failures = results.filter((result) => result.error || result.passed !== true);
console.log(`Result: ${results.length - failures.length}/${results.length} clean.`);
process.exit(failures.length ? 1 : 0);
