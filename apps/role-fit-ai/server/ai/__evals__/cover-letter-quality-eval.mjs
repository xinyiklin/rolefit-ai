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
//   EVAL_FIT_FINDINGS=off omits each fixture's frozen Fit findings (sent by default);
//   EVAL_JUDGE=panel adds the whole-letter judge stage with the recorded Astra + Opus panel;
//   EVAL_JUDGE='[{"provider":"codex-cli","model":"gpt-6-astra","reasoningEffort":"high"}]' names the judges.
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
import { callConfiguredProvider } from "../clients.ts";
import { tailorCoverLetter } from "../coverLetter.ts";
import { CoverLetterBlockedError } from "../coverLetterIssues.ts";
import { COVER_LETTER_JUDGE_PANEL, buildCoverLetterJudgePrompts, coverLetterJudgeConfigError, panelUnsupportedSentenceCount, parseCoverLetterJudgment } from "../coverLetterJudge.ts";
import { gradeCoverLetterResult } from "../coverLetterQuality.ts";
import { resolveProviderRequest } from "../providers.ts";
import { fitGapFailures, gradeFitGaps, polishFitFindings } from "./support/fit-findings.mjs";
import { buildCoverLetterPreflight } from "../../../src/lib/coverLetterPreflight.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_URL = new URL("./fixtures/cover-letter-quality.json", import.meta.url);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const publicConfig = ({ provider, model, reasoningEffort }) => ({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
const allFixtures = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

// Judges are evaluation-only; a Sol model is a generator under test, never a judge.
export function judgeMatrix(env) {
  if (!env.EVAL_JUDGE) return [];
  let raw;
  if (env.EVAL_JUDGE === "panel") raw = COVER_LETTER_JUDGE_PANEL;
  else {
    try { raw = JSON.parse(env.EVAL_JUDGE); } catch { throw new Error("EVAL_JUDGE must be \"panel\" or a JSON array of judge configurations."); }
  }
  if (!Array.isArray(raw) || !raw.length) throw new Error("EVAL_JUDGE must name at least one judge.");
  return raw.map((entry) => {
    // Resolve first: an omitted model would otherwise fall to a provider default.
    const config = publicConfig(resolveProviderRequest(entry ?? {}));
    const error = coverLetterJudgeConfigError(config);
    if (error) throw new Error(error);
    return config;
  });
}

export function evalOptions(argv, env) {
  const fixtureFilter = argv[0] || "all";
  const runs = Number(argv[1] || 1);
  if (argv.length > 2 || !Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be an integer from 1 to 5");
  const fixtures = fixtureFilter === "all" ? allFixtures : allFixtures.filter((fixture) => fixture.id === fixtureFilter);
  if (fixtures.length === 0) throw new Error(`Unknown fixture "${fixtureFilter}".`);
  const provider = env.EVAL_PROVIDER || "claude-cli";
  // "off" reproduces a request from before Fit findings reached Polish.
  const fitFindings = env.EVAL_FIT_FINDINGS || "on";
  if (!["on", "off"].includes(fitFindings)) throw new Error("EVAL_FIT_FINDINGS must be on or off");
  return {
    runs, fixtures, fitFindings: fitFindings === "on",
    judges: judgeMatrix(env),
    config: {
      provider,
      model: env.EVAL_MODEL ?? (provider === "claude-cli" ? "opus" : ""),
      ...(env.EVAL_REASONING_EFFORT ? { reasoningEffort: env.EVAL_REASONING_EFFORT } : {})
    }
  };
}

// One judge reads the whole letter; the receipt keeps the judgment and the
// judge's identity, never the judge's raw reply.
export async function judgeLetter({ fixture, preflight, result, judges, dispatch = callConfiguredProvider }) {
  const prompts = buildCoverLetterJudgePrompts({
    letterText: result.coverLetterText,
    baseLetterText: preflight.template.authoredProse,
    jobText: fixture.jobText,
    evidence: fixture.evidence,
    role: fixture.role,
    company: fixture.company
  });
  const judgments = [];
  for (const judge of judges) {
    const stats = {};
    const started = Date.now();
    try {
      const raw = await dispatch({ ...resolveProviderRequest(judge), ...prompts, retryUnreadableOutput: false }, stats);
      judgments.push({ judge, judgment: parseCoverLetterJudgment(raw), attempts: stats.attempts ?? 1, elapsedMs: Date.now() - started });
    } catch {
      // A judge that fails or answers unreadably is recorded as absent for this
      // letter; the structural grade and receipt stand on their own.
      judgments.push({ judge, error: "judge", attempts: stats.attempts ?? 1, elapsedMs: Date.now() - started });
    }
  }
  return judgments;
}

const mean = (values) => {
  const numbers = values.filter((value) => typeof value === "number");
  return numbers.length ? Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(2)) : null;
};

async function runFixture(fixture, run, config, stage, judges, fitFindings = true) {
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
      customInstructions: "",
      fitFindings: fitFindings ? polishFitFindings(fixture) : null
    },
    stats
  );
  const fitGaps = fitFindings ? gradeFitGaps(fixture, result) : null;
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
  let judgments = [];
  if (judges.length) {
    stage.current = "judge";
    judgments = await judgeLetter({ fixture, preflight, result, judges });
  }
  const judged = (dimension) => mean(judgments.filter((item) => item.judgment).map((item) => item.judgment[dimension]));
  return {
    receipt: { fixture, result, pageCount, report, judgments, ...(fitGaps ? { fitGaps } : {}), labelProvenance: "Repository-authored synthetic cases; judge scores are model judgments, not human review", factualAccuracy: null, coverageAccuracy: null, persuasiveness: null },
    row: {
      fixture: fixture.id,
      run,
      structuralScore: report.structuralScore,
      structuralChecksPassed: report.passed,
      // Judge means across the panel, or null when no judge ran.
      judgeOverall: judged("overall"),
      judgeSupport: judged("support"),
      judgeImprovementOverBase: judged("improvementOverBase"),
      judgeUnsupportedSentences: panelUnsupportedSentenceCount(judgments),
      judgeErrors: judgments.filter((item) => item.error).length,
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
      ...(fitGaps ? { fitGaps: { addressed: fitGaps.addressed, noEvidence: fitGaps.noEvidence, notReported: fitGaps.notReported, failures: fitGapFailures(fitGaps) } } : {}),
      failedChecks: Object.entries(report.checks)
        .filter(([, check]) => !check.passed)
        .map(([name]) => name),
      pageCount
    }
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs:1-5]\nEVAL_PROVIDER, EVAL_MODEL, EVAL_REASONING_EFFORT select the generator. EVAL_JUDGE=panel (Astra + Opus) or a JSON array adds the whole-letter judge stage.\nFixtures: " + allFixtures.map((fixture) => fixture.id).join(", "));
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
    "../coverLetterIssues.ts", "../coverLetterQuality.ts", "../coverLetterJudge.ts", "../prompts.ts", "../grounding.ts", "../sanitize.ts", "../claimEvidence.ts",
    "../clients.ts", "../../../shared/contentWarnings.ts", "../../../shared/evidencePolarity.ts", "../../../src/lib/coverLetterTemplate.ts",
    "../../../src/lib/coverLetterPreflight.ts", "../../../src/lib/coverLetterEvidence.ts", "../../../shared/polishFitFindings.ts",
    "./support/fit-findings.mjs", "./cover-letter-quality-eval.mjs"
  ].map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
  save("manifest.json", {
    createdAt: new Date().toISOString(), config: options.config, judges: options.judges, runs: options.runs, fitFindingsArm: options.fitFindings ? "on" : "off",
    fixtures: options.fixtures.map((fixture) => fixture.id), corpusHash: hash(readFileSync(FIXTURE_URL)), sourceHashes,
    labelProvenance: "Repository-authored synthetic cases; the structural grader measures neither factual support nor writing quality.",
    humanReviewed: false
  });
  save("fixtures.json", options.fixtures);
  console.log(`Cover-letter quality eval — ${JSON.stringify(options.config)} fixtures=${options.fixtures.length} runs=${options.runs} judges=${options.judges.length}`);
  const rows = [];
  let unrun = 0;
  outer: for (const fixture of options.fixtures) {
    for (let run = 1; run <= options.runs; run += 1) {
      const stage = { current: "preflight" };
      try {
        const outcome = await runFixture(fixture, run, options.config, stage, options.judges, options.fitFindings);
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
  const judgeNote = options.judges.length
    ? `judge overall mean ${mean(rows.map((row) => row.judgeOverall))} over ${rows.filter((row) => typeof row.judgeOverall === "number").length} letters`
    : "factual accuracy and persuasiveness unmeasured (no judge)";
  console.log(`Result: ${rows.length - failures.length}/${expected} structural checks passed; ${unrun} unrun; ${judgeNote}. Receipts: ${out}`);
  return failures.length || unrun ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch {
    console.error("Could not complete the eval or write its receipts; no success recorded.");
    process.exitCode = 1;
  }
}
