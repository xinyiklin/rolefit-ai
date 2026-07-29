// Live, synthetic-only quality harness for the one-call cover-letter workflow.
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
import { tailorCoverLetter } from "../coverLetter.ts";
import { gradeCoverLetterResult } from "../coverLetterQuality.ts";
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

async function runFixture(fixture, run) {
  const preflight = buildCoverLetterPreflight({
    text: fixture.sourceText,
    candidateName: "Jordan Lee",
    role: fixture.role,
    company: fixture.company,
    date: "July 28, 2026"
  });
  // A synthetic fixture that cannot tailor in one click is itself the defect.
  if (!preflight.canTailor) {
    return { fixture: fixture.id, run, error: "fixture failed one-click preflight" };
  }
  const stats = {};
  const result = await tailorCoverLetter(
    {
      provider: PROVIDER,
      model: MODEL,
      jobText: fixture.jobText,
      sourceContext: {
        rawTemplateText: fixture.sourceText,
        structuredTemplate: preflight.template.structuredTemplate,
        authoredProse: preflight.template.authoredProse,
        slots: preflight.template.slots
      },
      evidenceItems: fixture.evidence,
      resolvedContext: preflight.resolved,
      employerContext: [],
      customInstructions: ""
    },
    stats
  );
  const pageCount = layoutCoverLetter(
    toTypesetSchema(parseCoverLetterText(result.coverLetterText)),
    coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
  ).pages.length;
  const report = gradeCoverLetterResult({
    result,
    allEvidence: fixture.evidence,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: pageCount === 1
  });
  writeFileSync(
    join(OUT_DIR, `${fixture.id}-${PROVIDER.replace(/[^a-z0-9-]/gi, "_")}-run-${run}.json`),
    JSON.stringify({ fixture, result, pageCount, report }, null, 2)
  );
  return {
    fixture: fixture.id,
    run,
    score: report.score,
    passed: report.passed,
    // The whole point of the rework: the model picks these, and drift across
    // identical runs is worth seeing.
    evidenceUsed: result.evidenceUsed.map((item) => item.id),
    repaired: result.repaired === true,
    providerRequests: stats.attempts ?? 1,
    failedChecks: Object.entries(report.checks)
      .filter(([, check]) => !check.passed)
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
  if (!result.evidenceUsed) continue;
  const choices = selectionSpread.get(result.fixture) ?? new Set();
  choices.add([...result.evidenceUsed].sort().join("|"));
  selectionSpread.set(result.fixture, choices);
}
for (const [fixture, choices] of selectionSpread) {
  if (choices.size > 1) {
    console.log(
      `NOTE: ${fixture} used ${choices.size} different evidence sets across identical runs.`
    );
  }
}

const repairs = results.filter((result) => result.repaired).length;
if (repairs > 0) console.log(`NOTE: ${repairs}/${results.length} runs needed the repair pass.`);

const failures = results.filter((result) => result.error || result.passed !== true);
console.log(`Result: ${results.length - failures.length}/${results.length} clean.`);
process.exit(failures.length ? 1 : 0);
