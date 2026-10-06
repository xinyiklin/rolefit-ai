// Manual, live-provider Prepare benchmark: Fit Assessment consistency plus Job
// analysis extraction, timing, and provider usage per configuration. The
// tracked fixtures are synthetic, console output is aggregate-only, and every
// invocation writes an immutable receipt directory beneath the gitignored
// workspace/fit-assessment-eval/: a manifest (configurations, corpus and
// source hashes), the fixture snapshot, one receipt per dispatch set, and
// summary.json, so two configurations never overwrite each other's results.
//
// Usage:
//   npm run eval:live:fit-assessment --workspace apps/role-fit-ai -- [fixture-id[,fixture-id]|all] [runs:1-5]
//   EVAL_PROVIDER=codex-cli EVAL_MODEL=gpt-6.1-sol EVAL_REASONING_EFFORT=medium npm run eval:live:fit-assessment --workspace apps/role-fit-ai
//   EVAL_MATRIX='[{"provider":"claude-cli","model":"opus","reasoningEffort":"high","fit":{"provider":"codex-cli","model":"gpt-6.1-sol","reasoningEffort":"medium"}}]' ...
//   EVAL_REPORT_ONLY=1 EVAL_REPORT_DIR=workspace/fit-assessment-eval/<receipt-dir> ...
//
// A matrix entry is one Prepare configuration: the Job analysis request, plus an
// optional `fit` request when the user's Fit stage is configured differently.
// Matching requests take Prepare's one-call "combined" path and are paired with
// the standalone Retry prompt; differing requests take the app's "split" path
// (Job analysis, then standalone Fit), so a cheaper extractor that breaks the
// combination is measured as the two calls it costs. The split path's Fit call
// already is the standalone prompt, so it is not dispatched a second time.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  modelOptionsByProvider,
  providerOptions
} from "../../../src/config/aiOptions.ts";
import { aiRequestFieldsMatch } from "../../../src/lib/aiRequest.ts";
import { callConfiguredProvider } from "../clients.ts";
import { buildJobAnalysisPrompts, sanitizePrepareAnalysisResponse } from "../jobAnalysis.ts";
import { buildFitAssessmentPrompts, sanitizeFitAssessmentResponse } from "../fitAssessment.ts";
import { resolveProviderRequest } from "../providers.ts";
import { automationDecisions, decisionFlips, hasTerm, quantiles, scoreJobFields, sumUsage, THRESHOLDS } from "./support/prepare-benchmark.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_URL = new URL("./fixtures/fit-assessment-consistency.json", import.meta.url);
const SOURCE_FILES = [
  "../jobAnalysis.ts", "../fitAssessment.ts", "../fitEvidence.ts", "../prompts.ts", "../clients.ts", "../providerUsage.ts",
  "../../../shared/fitAssessmentContract.ts", "../../../shared/candidateProfileContract.ts", "../../../src/lib/autoPolishPolicy.ts",
  "./support/prepare-benchmark.mjs", "./fit-assessment-consistency-eval.mjs"
];
const hash = (text) => createHash("sha256").update(text).digest("hex");
const sourceHashes = () => Object.fromEntries(SOURCE_FILES.map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
const allFixtures = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
const outcome = (result) => (result?.status === "INSUFFICIENT_JOB_INFORMATION" ? "INSUFFICIENT_JOB_INFORMATION" : result?.verdict);
const FIT_RANK = { LIMITED: 0, STRETCH: 1, REASONABLE: 2, STRONG: 3 };
const safeSlug = (value) => String(value || "default").replace(/[^a-z0-9-]/gi, "_");
const publicRequest = ({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort: reasoningEffort || "" });
const requestId = (request) => [request.provider, request.model, request.reasoningEffort || "default"].join("/");
const configId = (config) => (config.combined ? requestId(config.job) : `${requestId(config.job)} + fit ${requestId(config.fit)}`);
const configSlug = (config) => [config.job, ...(config.combined ? [] : [config.fit])]
  .map((request) => [request.provider, request.model, request.reasoningEffort].map(safeSlug).join("-")).join("--");

function validatedRequest(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object.`);
  const provider = String(entry.provider ?? "").trim();
  const providerOption = providerOptions.find((option) => option.value === provider);
  if (!providerOption) throw new Error(`Unsupported eval provider "${provider}".`);
  const model = String(entry.model ?? providerOption.model).trim();
  if (!modelOptionsByProvider[provider].some((option) => option.value === model)) throw new Error(`Model "${model}" is not exposed for ${provider}.`);
  const effortOptions = cliReasoningEffortOptionsFor(provider, model);
  const reasoningEffort = String(entry.reasoningEffort ?? defaultCliReasoningEffort(provider)).trim();
  if (effortOptions && !effortOptions.some((option) => option.value === reasoningEffort)) throw new Error(`Reasoning effort "${reasoningEffort}" is not exposed for ${provider}/${model}.`);
  if (!effortOptions && reasoningEffort) throw new Error(`Reasoning effort is not supported for ${provider}/${model}.`);
  return { provider, model, reasoningEffort };
}

export function configuredMatrix(env) {
  let raw;
  if (env.EVAL_MATRIX) {
    try {
      raw = JSON.parse(env.EVAL_MATRIX);
    } catch {
      throw new Error("EVAL_MATRIX must be a JSON array of provider/model/reasoningEffort objects.");
    }
  } else {
    raw = [{
      provider: env.EVAL_PROVIDER || "claude-cli",
      ...(env.EVAL_MODEL ? { model: env.EVAL_MODEL } : {}),
      ...(env.EVAL_REASONING_EFFORT ? { reasoningEffort: env.EVAL_REASONING_EFFORT } : {})
    }];
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("EVAL_MATRIX must contain at least one provider configuration.");
  const matrix = raw.map((entry, index) => {
    const job = validatedRequest(entry, `EVAL_MATRIX entry ${index + 1}`);
    const fit = entry && typeof entry === "object" && entry.fit ? validatedRequest(entry.fit, `EVAL_MATRIX entry ${index + 1} fit`) : job;
    return { job, fit, combined: aiRequestFieldsMatch(job, fit) };
  });
  if (new Set(matrix.map(configId)).size !== matrix.length) throw new Error("EVAL_MATRIX lists the same Prepare configuration twice.");
  return matrix;
}

// The paths one configuration runs: combined Prepare plus the standalone Retry
// prompt, or the split path alone.
const pathsFor = (config) => (config.combined ? ["combined", "standalone"] : ["split"]);
const preparePathOf = (config) => (config.combined ? "combined" : "split");

export function evalOptions(argv, env) {
  if (argv.length > 2) throw new Error("Usage: [fixture-id[,fixture-id]|all] [runs:1-5]");
  const fixtureFilter = argv[0] || "all";
  const runs = Number(argv[1] || 3);
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be an integer from 1 to 5");
  // "set:<name>" selects a tagged fixture set (for example a disjoint holdout).
  const requested = new Set(fixtureFilter.split(",").map((id) => id.trim()).filter(Boolean));
  const fixtures = fixtureFilter === "all"
    ? allFixtures
    : fixtureFilter.startsWith("set:")
      ? allFixtures.filter((fixture) => fixture.set === fixtureFilter.slice(4))
      : allFixtures.filter((fixture) => requested.has(fixture.id));
  if (fixtures.length === 0) throw new Error(`Unknown fixture "${fixtureFilter}".`);
  if (fixtureFilter !== "all" && !fixtureFilter.startsWith("set:") && fixtures.length !== requested.size) {
    const known = new Set(fixtures.map((fixture) => fixture.id));
    throw new Error(`Unknown fixture(s): ${[...requested].filter((id) => !known.has(id)).join(", ")}.`);
  }
  return { fixtures, runs, matrix: configuredMatrix(env), reportOnly: env.EVAL_REPORT_ONLY === "1", reportDir: env.EVAL_REPORT_DIR || "", outRoot: env.EVAL_OUT_ROOT || join(APP_ROOT, "workspace/fit-assessment-eval") };
}

function representedThemes(fixture, result) {
  if (!result) return [];
  const findings = [
    ...result.matches.flatMap((match) => [match.jobExcerpt, match.candidateExcerpt]),
    ...result.gaps.map((gap) => (typeof gap === "string" ? gap : [gap.jobExcerpt, gap.note, gap.candidateExcerpt].filter(Boolean).join(" ")))
  ].join("\n");
  return fixture.materialThemes
    .filter((theme) => theme.terms.some((term) => hasTerm(findings, term)))
    .map((theme) => theme.id);
}

function themeOverlap(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return left.filter((theme) => right.includes(theme)).length / union.size;
}

// One provider call with its own timing and usage. `role` names what the call
// did: "prepare" (Job analysis + Fit), "job" (Job analysis alone), or "fit".
async function timedDispatch(dispatch, request, prompts, role, now) {
  const stats = {};
  const started = now();
  const parsed = await dispatch({ ...resolveProviderRequest(request), ...prompts }, stats);
  return { parsed, dispatch: { role, request: publicRequest(request), attempts: stats.attempts ?? 1, elapsedMs: now() - started, usage: stats.usage ?? null } };
}

async function runPath({ config, fixture, path, run, dispatch, now }) {
  const fitInput = { resumeText: fixture.resumeText, candidateContext: fixture.candidateContext };
  const dispatches = [];
  let result = null;
  let jobFields = null;
  if (path === "standalone") {
    const fit = await timedDispatch(dispatch, config.fit, buildFitAssessmentPrompts(fixture), "fit", now);
    dispatches.push(fit.dispatch);
    result = sanitizeFitAssessmentResponse(fit.parsed, fixture);
  } else if (config.combined) {
    const prepare = await timedDispatch(dispatch, config.job, buildJobAnalysisPrompts({ jobText: fixture.jobText, fitAssessment: fitInput }), "prepare", now);
    dispatches.push(prepare.dispatch);
    const prepared = sanitizePrepareAnalysisResponse(prepare.parsed, fixture.jobText, fitInput);
    jobFields = prepared.fields;
    result = prepared.fitAssessment ?? null;
  } else {
    const job = await timedDispatch(dispatch, config.job, buildJobAnalysisPrompts({ jobText: fixture.jobText }), "job", now);
    dispatches.push(job.dispatch);
    jobFields = sanitizePrepareAnalysisResponse(job.parsed, fixture.jobText, null).fields;
    const fit = await timedDispatch(dispatch, config.fit, buildFitAssessmentPrompts(fixture), "fit", now);
    dispatches.push(fit.dispatch);
    result = sanitizeFitAssessmentResponse(fit.parsed, fixture);
  }
  return {
    config: configId(config), fixture: fixture.id, path, run, combined: path === "standalone" ? null : config.combined,
    result, jobFields,
    jobScore: jobFields && fixture.expectedJob ? scoreJobFields(fixture.expectedJob, jobFields) : null,
    themes: representedThemes(fixture, result),
    decisions: automationDecisions(result),
    dispatches,
    elapsedMs: dispatches.reduce((sum, item) => sum + item.elapsedMs, 0),
    providerAttempts: dispatches.reduce((sum, item) => sum + item.attempts, 0),
    usage: sumUsage(dispatches.map((item) => item.usage))
  };
}

const receiptName = (config, fixture, path, run) => `${configSlug(config)}-${safeSlug(fixture.id)}-${path}-run-${run}.json`;

// Replay re-derives everything computed from the stored result and job fields,
// so a receipt written by an older runner is scored by the current rules.
function loadReceipt(dir, config, fixture, path, run) {
  const file = join(dir, receiptName(config, fixture, path, run));
  if (!existsSync(file)) return null;
  const { labelProvenance: _label, humanReviewed: _human, ...record } = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...record,
    jobScore: record.jobFields && fixture.expectedJob ? scoreJobFields(fixture.expectedJob, record.jobFields) : null,
    themes: representedThemes(fixture, record.result),
    decisions: automationDecisions(record.result)
  };
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const dispatch = deps.dispatch ?? callConfiguredProvider;
  const now = deps.now ?? Date.now;
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(`Usage: npm run eval:live:fit-assessment --workspace apps/role-fit-ai -- [fixture-id[,fixture-id]|all] [runs:1-5]
EVAL_PROVIDER, EVAL_MODEL, EVAL_REASONING_EFFORT select one Prepare configuration; EVAL_MATRIX takes a JSON array of
{provider, model, reasoningEffort, fit?: {provider, model, reasoningEffort}} entries (a differing fit request measures the split path).
EVAL_REPORT_ONLY=1 with EVAL_REPORT_DIR re-reports an existing receipt directory without provider calls.
Sets: ${[...new Set(allFixtures.map((fixture) => fixture.set).filter(Boolean))].map((name) => `set:${name}`).join(", ") || "none"}
Fixtures: ${allFixtures.map((fixture) => fixture.id).join(", ")}`);
    return 0;
  }
  let options;
  try {
    options = evalOptions(argv, env);
    for (const config of options.matrix) {
      resolveProviderRequest(config.job);
      resolveProviderRequest(config.fit);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid evaluation configuration.");
    return 2;
  }
  let { fixtures, runs: RUNS, matrix } = options;
  const { reportOnly } = options;
  const corpusHash = hash(readFileSync(FIXTURE_URL));
  let out;
  if (reportOnly) {
    out = resolve(options.reportDir);
    if (!options.reportDir || !existsSync(join(out, "manifest.json"))) {
      console.error("EVAL_REPORT_ONLY=1 needs EVAL_REPORT_DIR pointing at a receipt directory with a manifest.json.");
      return 2;
    }
    // The receipts define the run: configurations, repetitions, and the fixture
    // snapshot they were scored against, whatever the current env says.
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    matrix = manifest.configurations.map(({ job, fit, combined }) => ({ job, fit, combined }));
    RUNS = manifest.runs;
    fixtures = JSON.parse(readFileSync(join(out, "fixtures.json"), "utf8"));
    if (manifest.corpusHash !== corpusHash) console.log("WARNING: the tracked fixture corpus changed since these receipts were written; stored scores follow the snapshot.");
    const current = sourceHashes();
    const drifted = Object.entries(manifest.sourceHashes ?? {}).filter(([path, value]) => current[path] !== value).map(([path]) => path);
    if (drifted.length) console.log(`WARNING: source changed since these receipts were written: ${drifted.join(", ")}.`);
  } else {
    mkdirSync(options.outRoot, { recursive: true, mode: 0o700 });
    out = mkdtempSync(join(options.outRoot, new Date().toISOString().replace(/[:.]/g, "-") + "-"));
    chmodSync(out, 0o700);
  }
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (!reportOnly) {
    save("manifest.json", {
      createdAt: new Date().toISOString(),
      configurations: matrix.map((config) => ({ id: configId(config), job: config.job, fit: config.fit, combined: config.combined })),
      runs: RUNS, paths: ["combined + standalone for a matching Fit request", "split for a differing one"],
      fixtures: fixtures.map((fixture) => fixture.id), corpusHash, sourceHashes: sourceHashes(),
      labelProvenance: "Repository-authored synthetic expectations; human review not recorded",
      usageNote: "Token usage is the provider's own report: Claude Code and the API adapters report counts, Codex reports one total, Antigravity reports none (null).",
      humanReviewed: false
    });
    save("fixtures.json", fixtures);
  }
  console.log(`Prepare benchmark — mode=${reportOnly ? "report" : "live"} configs=${matrix.length} fixtures=${fixtures.length} runs=${RUNS}`);

  const records = [];
  for (const config of matrix) {
    console.log(`Config: ${configId(config)} (${pathsFor(config).join("+")})`);
    let configUnavailable = false;
    for (const fixture of fixtures) {
      for (let run = 1; run <= RUNS; run += 1) {
        for (const path of pathsFor(config)) {
          if (reportOnly) {
            const record = loadReceipt(out, config, fixture, path, run);
            if (record) records.push(record);
            continue;
          }
          let record;
          try {
            record = await runPath({ config, fixture, path, run, dispatch, now });
          } catch (error) {
            // Provider messages are user-safe by design; keep only their head.
            records.push({ config: configId(config), fixture: fixture.id, path, run, error: error instanceof Error ? error.message.slice(0, 160) : "unknown error" });
            configUnavailable = true;
            break;
          }
          save(receiptName(config, fixture, path, run), { ...record, labelProvenance: "Repository-authored synthetic expectations; human review not recorded", humanReviewed: false });
          records.push(record);
        }
        if (configUnavailable) break;
      }
      if (configUnavailable) {
        console.error(`Stopped: ${configId(config)} after its first provider failure.`);
        break;
      }
      if (!reportOnly) console.log(`Completed: ${configId(config)} ${fixture.id} (${RUNS * 2} calls)`);
    }
  }

  const failures = [];
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  for (const record of records) {
    const fixture = byId.get(record.fixture);
    const where = `${record.config} ${record.fixture} ${record.path} run ${record.run}`;
    if (record.error) { failures.push(`${where}: ${record.error}`); continue; }
    if (!record.result) { failures.push(`${where}: invalid or ungrounded response`); continue; }
    const eligibility = record.result.eligibility?.status ?? "OMITTED";
    if (!fixture.allowedEligibility.includes(eligibility)) failures.push(`${where}: unexpected eligibility ${eligibility}`);
    if (record.jobScore?.fabricated?.length) failures.push(`${where}: extraction added ${record.jobScore.fabricated.join(", ")} that the posting never states`);
  }

  const configIds = matrix.map(configId);
  for (const config of configIds) {
    for (const fixture of fixtures) {
      const valid = records.filter((record) => record.config === config && record.fixture === fixture.id && record.result);
      const expectedCount = valid.filter((record) => (fixture.expectedOutcomes ?? fixture.expectedVerdicts).includes(outcome(record.result))).length;
      if (fixture.stable) {
        const required = Math.max(1, Math.ceil(valid.length * 0.8));
        if (expectedCount < required) failures.push(`${config} ${fixture.id}: expected category appeared in ${expectedCount}/${valid.length} valid runs; required ${required}`);
      } else if (expectedCount !== valid.length) {
        failures.push(`${config} ${fixture.id}: ${valid.length - expectedCount} verdicts fell outside the allowed adjacent categories`);
      }
    }
  }

  const aggregate = [];
  for (const [index, config] of configIds.entries()) {
    for (const fixture of fixtures) {
      for (const path of pathsFor(matrix[index])) {
        const attempted = records.filter((record) => record.config === config && record.fixture === fixture.id && record.path === path);
        const group = attempted.filter((record) => record.result);
        const verdicts = group.map((record) => outcome(record.result));
        const eligibility = group.map((record) => record.result.eligibility?.status ?? "OMITTED");
        const ranks = verdicts.map((verdict) => FIT_RANK[verdict]).filter(Number.isFinite);
        const spread = ranks.length ? Math.max(...ranks) - Math.min(...ranks) : null;
        if (group.length !== RUNS) failures.push(`${config} ${fixture.id} ${path}: completed ${group.length}/${RUNS} required runs`);
        if (spread !== null && spread > 1) failures.push(`${config} ${fixture.id} ${path}: non-adjacent repeated verdict spread`);
        if (eligibility.includes("BLOCKED") && eligibility.some((status) => status !== "BLOCKED")) failures.push(`${config} ${fixture.id} ${path}: eligibility alternated between BLOCKED and another status`);
        const scores = group.map((record) => record.jobScore?.score).filter((score) => typeof score === "number");
        aggregate.push({
          config, fixture: fixture.id, path,
          verdictDistribution: Object.fromEntries([...new Set(verdicts)].map((verdict) => [verdict, verdicts.filter((item) => item === verdict).length])),
          eligibilityDistribution: Object.fromEntries([...new Set(eligibility)].map((status) => [status, eligibility.filter((item) => item === status).length])),
          invalidResponses: attempted.filter((record) => !record.result && !record.error).length,
          providerErrors: attempted.filter((record) => record.error).length,
          missingRuns: RUNS - attempted.length,
          repeatedVerdictSpread: spread,
          automationFlips: decisionFlips(group.map((record) => record.decisions)),
          extractionScore: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3)) : null,
          fabricatedRuns: group.filter((record) => record.jobScore?.fabricated?.length).length,
          elapsedMs: quantiles(attempted.map((record) => record.elapsedMs)),
          // Every dispatched reply cost tokens, valid or not.
          usage: sumUsage(attempted.filter((record) => !record.error).map((record) => record.usage))
        });
      }
    }
  }

  // Only a combined configuration has a distinct standalone prompt to pair with.
  const paired = [];
  for (const [index, config] of configIds.entries()) {
    if (!matrix[index].combined) continue;
    for (const fixture of fixtures) {
      for (let run = 1; run <= RUNS; run += 1) {
        const prepare = records.find((record) => record.config === config && record.fixture === fixture.id && record.path === "combined" && record.run === run);
        const standalone = records.find((record) => record.config === config && record.fixture === fixture.id && record.path === "standalone" && record.run === run);
        if (!prepare?.result || !standalone?.result) continue;
        const insufficient = prepare.result.status === "INSUFFICIENT_JOB_INFORMATION" || standalone.result.status === "INSUFFICIENT_JOB_INFORMATION";
        const verdictDistance = outcome(prepare.result) === outcome(standalone.result) ? 0 : insufficient ? Infinity : Math.abs(FIT_RANK[prepare.result.verdict] - FIT_RANK[standalone.result.verdict]);
        const overlap = themeOverlap(prepare.themes, standalone.themes);
        if (verdictDistance > 1) failures.push(`${config} ${fixture.id} run ${run}: prepare/standalone verdicts differ by ${verdictDistance} levels`);
        if (prepare.themes.length > 0 && standalone.themes.length > 0 && overlap === 0) failures.push(`${config} ${fixture.id} run ${run}: prepare/standalone findings have no material-theme overlap`);
        paired.push({ config, fixture: fixture.id, run, verdictDistance, themeOverlap: overlap, automationDiffers: decisionFlips([prepare.decisions, standalone.decisions]) });
      }
    }
  }

  // Per-configuration totals: the Prepare path is what the user waits for.
  const configSummary = configIds.map((config, index) => {
    const preparePath = preparePathOf(matrix[index]);
    const prepareRecords = records.filter((record) => record.config === config && record.path === preparePath && !record.error);
    const scored = prepareRecords.filter((record) => typeof record.jobScore?.score === "number");
    const flips = {};
    for (const threshold of THRESHOLDS) flips[threshold] = aggregate.filter((row) => row.config === config && row.automationFlips.includes(threshold)).length;
    return {
      config, path: preparePath, calls: prepareRecords.reduce((sum, record) => sum + record.dispatches.length, 0),
      providerAttempts: prepareRecords.reduce((sum, record) => sum + record.providerAttempts, 0),
      elapsedMs: quantiles(prepareRecords.map((record) => record.elapsedMs)),
      usage: sumUsage(prepareRecords.map((record) => record.usage)),
      extractionScore: scored.length ? Number((scored.reduce((sum, record) => sum + record.jobScore.score, 0) / scored.length).toFixed(3)) : null,
      extractionRuns: scored.length,
      fabricatedRuns: scored.filter((record) => record.jobScore.fabricated.length).length,
      automationFlipGroups: flips,
      standaloneAutomationDiffers: matrix[index].combined ? paired.filter((row) => row.config === config && row.automationDiffers.length).length : null
    };
  });

  for (const row of aggregate) console.log(JSON.stringify(row));
  for (const row of configSummary) console.log(JSON.stringify(row));
  const totals = {
    pairedRuns: paired.length,
    averageThemeOverlap: paired.length ? Number((paired.reduce((sum, row) => sum + row.themeOverlap, 0) / paired.length).toFixed(3)) : 0,
    nonAdjacentPairs: paired.filter((row) => row.verdictDistance > 1).length,
    invalidResponses: records.filter((record) => !record.result && !record.error).length,
    providerErrors: records.filter((record) => record.error).length,
    missingRuns: matrix.reduce((sum, config) => sum + pathsFor(config).length, 0) * fixtures.length * RUNS - records.length
  };
  console.log(JSON.stringify(totals));
  if (!reportOnly) save("summary.json", { configurations: configSummary, aggregate, paired, totals, failures });
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.log(`Result: ${failures.length ? "failed" : "passed"}; records=${records.length} failures=${failures.length}. Receipts: ${out}`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
