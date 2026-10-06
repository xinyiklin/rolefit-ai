// Live, synthetic-only quality harness for the one-call cover-letter workflow.
// It never reads a user's workspace or prints generated prose. Each invocation
// writes an immutable receipt directory under the gitignored
// workspace/cover-letter-eval/: a manifest (generator configuration, corpus and
// source hashes), the fixture snapshot, one receipt per fixture run, and a
// summary, so two models never overwrite each other's results.
//
// Usage:
//   npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs]
//   EVAL_PROVIDER=codex-cli EVAL_MODEL=gpt-6.1-sol EVAL_REASONING_EFFORT=medium npm run eval:live:cover-letter --workspace apps/role-fit-ai
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { CoverLetterBlockedError } from "../coverLetterIssues.ts";
import { gradeCoverLetterResult } from "../coverLetterQuality.ts";
import { resolveProviderRequest } from "../providers.ts";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_URL = new URL("./fixtures/cover-letter-quality.json", import.meta.url);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const publicConfig = ({ provider, model, reasoningEffort }) => ({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
const allFixtures = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

export function evalOptions(argv, env) {
  const fixtureFilter = argv[0] || "all";
  const runs = Number(argv[1] || 1);
  if (argv.length > 2 || !Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be an integer from 1 to 5");
  const fixtures = fixtureFilter === "all" ? allFixtures : allFixtures.filter((fixture) => fixture.id === fixtureFilter);
  if (fixtures.length === 0) throw new Error(`Unknown fixture "${fixtureFilter}".`);
  const provider = env.EVAL_PROVIDER || "claude-cli";
  return {
    runs, fixtures,
    config: {
      provider,
      model: env.EVAL_MODEL ?? (provider === "claude-cli" ? "opus" : ""),
      ...(env.EVAL_REASONING_EFFORT ? { reasoningEffort: env.EVAL_REASONING_EFFORT } : {})
    }
  };
}

async function runFixture(fixture, run, config, stage) {
  stage.current = "preflight";
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
  stage.current = "generation";
  const result = await tailorCoverLetter(
    {
      ...config,
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
  stage.current = "layout";
  const pageCount = layoutCoverLetter(
    toTypesetSchema(parseCoverLetterText(result.coverLetterText)),
    coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
  ).pages.length;
  stage.current = "grade";
  const report = gradeCoverLetterResult({
    result,
    allEvidence: fixture.evidence,
    sourceText: preflight.template.authoredProse,
    resolved: preflight.resolved,
    onePage: pageCount === 1
  });
  return {
    receipt: { fixture, result, pageCount, report, labelProvenance: "Repository-authored synthetic cases; human factual/writing-quality review not recorded", factualAccuracy: null, coverageAccuracy: null, persuasiveness: null },
    row: {
      fixture: fixture.id,
      run,
      structuralScore: report.structuralScore,
      structuralChecksPassed: report.passed,
      factualAccuracy: null,
      coverageAccuracy: null,
      humanReviewed: false,
      // The whole point of the rework: the model picks these, and drift across
      // identical runs is worth seeing.
      evidenceUsed: result.evidenceUsed.map((item) => item.id),
      warnings: result.warnings.length,
      concerns: result.concerns.length,
      repaired: result.repaired === true,
      providerRequests: stats.attempts ?? 1,
      failedChecks: Object.entries(report.checks)
        .filter(([, check]) => !check.passed)
        .map(([name]) => name),
      pageCount
    }
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs:1-5]\nEVAL_PROVIDER, EVAL_MODEL, EVAL_REASONING_EFFORT select the generator.\nFixtures: " + allFixtures.map((fixture) => fixture.id).join(", "));
    return 0;
  }
  let options;
  try {
    options = evalOptions(argv, env);
    options.config = publicConfig(resolveProviderRequest(options.config));
  } catch (error) {
    console.error(error instanceof Error && /runs must|Unknown fixture/.test(error.message) ? error.message : "Invalid eval configuration or unavailable provider. Check --help and the provider settings.");
    return 2;
  }
  const root = join(APP_ROOT, "workspace/cover-letter-eval");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const out = mkdtempSync(join(root, new Date().toISOString().replace(/[:.]/g, "-") + "-"));
  chmodSync(out, 0o700);
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const sourceHashes = Object.fromEntries([
    "../coverLetter.ts", "../coverLetterContracts.ts", "../coverLetterParagraphEvidence.ts", "../coverLetterGroundingIssues.ts",
    "../coverLetterIssues.ts", "../coverLetterQuality.ts", "../prompts.ts", "../grounding.ts", "../sanitize.ts", "../claimEvidence.ts",
    "../clients.ts", "../../../shared/contentWarnings.ts", "../../../shared/evidencePolarity.ts", "../../../src/lib/coverLetterTemplate.ts",
    "../../../src/lib/coverLetterPreflight.ts", "../../../src/lib/coverLetterEvidence.ts", "./cover-letter-quality-eval.mjs"
  ].map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
  save("manifest.json", {
    createdAt: new Date().toISOString(), config: options.config, runs: options.runs,
    fixtures: options.fixtures.map((fixture) => fixture.id), corpusHash: hash(readFileSync(FIXTURE_URL)), sourceHashes,
    labelProvenance: "Repository-authored synthetic cases; the structural grader measures neither factual support nor writing quality.",
    humanReviewed: false
  });
  save("fixtures.json", options.fixtures);
  console.log(`Cover-letter quality eval — ${JSON.stringify(options.config)} fixtures=${options.fixtures.length} runs=${options.runs}`);
  const rows = [];
  let unrun = 0;
  outer: for (const fixture of options.fixtures) {
    for (let run = 1; run <= options.runs; run += 1) {
      const stage = { current: "preflight" };
      try {
        const outcome = await runFixture(fixture, run, options.config, stage);
        if (outcome.receipt) {
          stage.current = "receipt";
          save(`${fixture.id}-run-${run}.json`, outcome.receipt);
        }
        rows.push(outcome.row ?? outcome);
      } catch (error) {
        // A letter still unusable after repair is that case's own failure.
        if (error instanceof CoverLetterBlockedError) {
          rows.push({ fixture: fixture.id, run, error: "blocked", repaired: error.repairAttempted });
          continue;
        }
        // Provider errors can contain response excerpts; record only the stage.
        rows.push({ fixture: fixture.id, run, error: stage.current });
        // A provider, auth, or usage-limit failure would repeat for every later case.
        if (stage.current === "generation") {
          unrun = options.fixtures.length * options.runs - rows.length;
          break outer;
        }
      }
    }
  }
  for (const row of rows) console.log(JSON.stringify(row));

  const selectionSpread = new Map();
  for (const row of rows) {
    if (!row.evidenceUsed) continue;
    const choices = selectionSpread.get(row.fixture) ?? new Set();
    choices.add([...row.evidenceUsed].sort().join("|"));
    selectionSpread.set(row.fixture, choices);
  }
  for (const [fixture, choices] of selectionSpread) {
    if (choices.size > 1) console.log(`NOTE: ${fixture} used ${choices.size} different evidence sets across identical runs.`);
  }
  const repairs = rows.filter((row) => row.repaired).length;
  if (repairs > 0) console.log(`NOTE: ${repairs}/${rows.length} runs needed the repair pass.`);

  const failures = rows.filter((row) => row.error || row.structuralChecksPassed !== true);
  const expected = options.fixtures.length * options.runs;
  save("summary.json", { expected, completed: rows.length, passed: rows.length - failures.length, unrun, rows });
  console.log(`Result: ${rows.length - failures.length}/${expected} structural checks passed; ${unrun} unrun; factual accuracy and persuasiveness unmeasured. Receipts: ${out}`);
  return failures.length || unrun ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch {
    console.error("Could not complete the eval or write its receipts; no success recorded.");
    process.exitCode = 1;
  }
}
