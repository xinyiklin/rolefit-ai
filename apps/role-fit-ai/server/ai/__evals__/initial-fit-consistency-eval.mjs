// Manual, live-provider calibration for Initial Fit. The tracked fixtures are
// synthetic, console output is aggregate-only, and full synthetic receipts are
// written beneath the gitignored workspace/initial-fit-eval/ directory.
//
// Usage:
//   npm run eval:live:initial-fit --workspace apps/role-fit-ai -- [fixture-id|all] [runs]
//   EVAL_PROVIDER=codex-cli EVAL_MODEL=gpt-5.6-sol EVAL_REASONING_EFFORT=medium npm run eval:live:initial-fit --workspace apps/role-fit-ai
//   EVAL_MATRIX='[{"provider":"codex-cli","model":"gpt-5.6-sol","reasoningEffort":"medium"}]' npm run eval:live:initial-fit --workspace apps/role-fit-ai
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  modelOptionsByProvider,
  providerOptions
} from "../../../src/config/aiOptions.ts";
import { callConfiguredProvider } from "../clients.ts";
import {
  buildJobAnalysisPrompts,
  sanitizePrepareAnalysisResponse
} from "../jobAnalysis.ts";
import {
  buildQuickFitPrompts,
  sanitizeQuickFitResponse
} from "../quickFit.ts";
import { resolveProviderRequest } from "../providers.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(APP_ROOT, "workspace/initial-fit-eval");
const fixtureFilter = process.argv[2] || "all";
const RUNS = Number(process.argv[3] || 3);
const REPORT_ONLY = process.env.EVAL_REPORT_ONLY === "1";

if (!Number.isInteger(RUNS) || RUNS < 3 || RUNS > 5) {
  console.error("runs must be an integer from 3 to 5");
  process.exit(2);
}

const allFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/initial-fit-consistency.json", import.meta.url), "utf8")
);
const requestedFixtureIds = new Set(fixtureFilter.split(",").map((id) => id.trim()).filter(Boolean));
const fixtures = fixtureFilter === "all"
  ? allFixtures
  : allFixtures.filter((fixture) => requestedFixtureIds.has(fixture.id));
if (fixtures.length === 0) {
  console.error(`Unknown fixture "${fixtureFilter}".`);
  process.exit(2);
}
if (fixtureFilter !== "all" && fixtures.length !== requestedFixtureIds.size) {
  const known = new Set(fixtures.map((fixture) => fixture.id));
  const unknown = [...requestedFixtureIds].filter((id) => !known.has(id));
  console.error(`Unknown fixture(s): ${unknown.join(", ")}.`);
  process.exit(2);
}

function configuredMatrix() {
  let raw;
  if (process.env.EVAL_MATRIX) {
    try {
      raw = JSON.parse(process.env.EVAL_MATRIX);
    } catch {
      throw new Error("EVAL_MATRIX must be a JSON array of provider/model/reasoningEffort objects.");
    }
  } else {
    raw = [{
      provider: process.env.EVAL_PROVIDER || "claude-cli",
      ...(process.env.EVAL_MODEL ? { model: process.env.EVAL_MODEL } : {}),
      ...(process.env.EVAL_REASONING_EFFORT
        ? { reasoningEffort: process.env.EVAL_REASONING_EFFORT }
        : {})
    }];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("EVAL_MATRIX must contain at least one provider configuration.");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`EVAL_MATRIX entry ${index + 1} must be an object.`);
    }
    const provider = String(entry.provider ?? "").trim();
    const providerOption = providerOptions.find((option) => option.value === provider);
    if (!providerOption) throw new Error(`Unsupported eval provider "${provider}".`);
    const model = String(entry.model ?? providerOption.model).trim();
    if (!modelOptionsByProvider[provider].some((option) => option.value === model)) {
      throw new Error(`Model "${model}" is not exposed for ${provider}.`);
    }
    const effortOptions = cliReasoningEffortOptionsFor(provider, model);
    const reasoningEffort = String(
      entry.reasoningEffort ?? defaultCliReasoningEffort(provider)
    ).trim();
    if (effortOptions && !effortOptions.some((option) => option.value === reasoningEffort)) {
      throw new Error(`Reasoning effort "${reasoningEffort}" is not exposed for ${provider}/${model}.`);
    }
    if (!effortOptions && reasoningEffort) {
      throw new Error(`Reasoning effort is not supported for ${provider}/${model}.`);
    }
    return { provider, model, reasoningEffort };
  });
}

let matrix;
try {
  matrix = configuredMatrix();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid evaluation configuration.");
  process.exit(2);
}

const FIT_RANK = { LIMITED: 0, STRETCH: 1, REASONABLE: 2, STRONG: 3 };
const safeSlug = (value) => String(value || "default").replace(/[^a-z0-9-]/gi, "_");
const configId = (config) => [config.provider, config.model, config.reasoningEffort || "default"].join("/");
const receiptFile = ({ config, fixture, path, run }) => join(
  OUT_DIR,
  [
    safeSlug(config.provider),
    safeSlug(config.model),
    safeSlug(config.reasoningEffort),
    safeSlug(fixture.id),
    path,
    `run-${run}.json`
  ].join("-")
);

function representedThemes(fixture, result) {
  if (!result) return [];
  const findings = [...result.matches, ...result.gaps].join("\n").toLowerCase();
  return fixture.materialThemes
    .filter((theme) => theme.terms.some((term) => findings.includes(term.toLowerCase())))
    .map((theme) => theme.id);
}

function themeOverlap(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  const intersection = left.filter((theme) => right.includes(theme));
  return intersection.length / union.size;
}

async function dispatchPath({ config, fixture, path, run }) {
  const resolved = resolveProviderRequest(config);
  const stats = {};
  let prompts;
  let parsed;
  let result;
  if (path === "standalone") {
    prompts = buildQuickFitPrompts(fixture);
    parsed = await callConfiguredProvider({ ...resolved, ...prompts }, stats);
    result = sanitizeQuickFitResponse(parsed, fixture);
  } else {
    const fitInput = {
      resumeText: fixture.resumeText,
      candidateContext: fixture.candidateContext
    };
    prompts = buildJobAnalysisPrompts({ jobText: fixture.jobText, initialFit: fitInput });
    parsed = await callConfiguredProvider({ ...resolved, ...prompts }, stats);
    result = sanitizePrepareAnalysisResponse(parsed, fixture.jobText, fitInput).initialFit ?? null;
  }
  const themes = representedThemes(fixture, result);
  writeFileSync(
    receiptFile({ config, fixture, path, run }),
    JSON.stringify({
      fixture,
      config,
      path,
      run,
      providerAttempts: stats.attempts ?? 1,
      parsed,
      sanitized: result,
      representedThemes: themes
    }, null, 2)
  );
  return {
    config: configId(config),
    fixture: fixture.id,
    path,
    run,
    result,
    themes,
    providerAttempts: stats.attempts ?? 1
  };
}

function loadReceipt({ config, fixture, path, run }) {
  const file = receiptFile({ config, fixture, path, run });
  if (!existsSync(file)) return null;
  const receipt = JSON.parse(readFileSync(file, "utf8"));
  return {
    config: configId(config),
    fixture: fixture.id,
    path,
    run,
    result: receipt.sanitized ?? null,
    themes: Array.isArray(receipt.representedThemes) ? receipt.representedThemes : [],
    providerAttempts: receipt.providerAttempts ?? 1
  };
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(
  `Initial Fit consistency eval — mode=${REPORT_ONLY ? "report" : "live"} configs=${matrix.length} fixtures=${fixtures.length} runs=${RUNS} paths=combined,standalone`
);

const records = [];
for (const config of matrix) {
  console.log(`Config: ${configId(config)}`);
  let configUnavailable = false;
  for (const fixture of fixtures) {
    for (let run = 1; run <= RUNS; run += 1) {
      for (const path of ["combined", "standalone"]) {
        if (REPORT_ONLY) {
          const record = loadReceipt({ config, fixture, path, run });
          if (record) records.push(record);
          continue;
        }
        try {
          records.push(await dispatchPath({ config, fixture, path, run }));
        } catch (error) {
          records.push({
            config: configId(config),
            fixture: fixture.id,
            path,
            run,
            error: error instanceof Error ? error.message : "unknown error"
          });
          configUnavailable = true;
          break;
        }
      }
      if (configUnavailable) break;
    }
    if (configUnavailable) {
      console.error(`Stopped: ${configId(config)} after its first provider failure.`);
      break;
    }
    console.log(REPORT_ONLY
      ? `Loaded available receipts: ${configId(config)} ${fixture.id}`
      : `Completed: ${configId(config)} ${fixture.id} (${RUNS * 2} calls)`);
  }
}

const failures = [];
for (const record of records) {
  const fixture = fixtures.find((candidate) => candidate.id === record.fixture);
  if (record.error) {
    failures.push(`${record.config} ${record.fixture} ${record.path} run ${record.run}: ${record.error}`);
    continue;
  }
  if (!record.result) {
    failures.push(`${record.config} ${record.fixture} ${record.path} run ${record.run}: invalid or ungrounded response`);
    continue;
  }
  const eligibility = record.result.eligibility?.status ?? "OMITTED";
  if (!fixture.allowedEligibility.includes(eligibility)) {
    failures.push(`${record.config} ${record.fixture} ${record.path} run ${record.run}: unexpected eligibility ${eligibility}`);
  }
}

for (const config of matrix.map(configId)) {
  for (const fixture of fixtures) {
    const valid = records.filter((record) =>
      record.config === config && record.fixture === fixture.id && record.result
    );
    const expectedCount = valid.filter((record) =>
      fixture.expectedVerdicts.includes(record.result.verdict)
    ).length;
    if (fixture.stable) {
      const required = Math.max(1, Math.ceil(valid.length * 0.8));
      if (expectedCount < required) {
        failures.push(`${config} ${fixture.id}: expected category appeared in ${expectedCount}/${valid.length} valid runs; required ${required}`);
      }
    } else if (expectedCount !== valid.length) {
      failures.push(`${config} ${fixture.id}: ${valid.length - expectedCount} verdicts fell outside the allowed adjacent categories`);
    }
  }
}

const aggregate = [];
for (const config of matrix.map(configId)) {
  for (const fixture of fixtures) {
    for (const path of ["combined", "standalone"]) {
      const attempted = records.filter((record) =>
        record.config === config && record.fixture === fixture.id && record.path === path
      );
      const group = attempted.filter((record) => record.result);
      const verdicts = group.map((record) => record.result.verdict);
      const eligibility = group.map((record) => record.result.eligibility?.status ?? "OMITTED");
      const ranks = verdicts.map((verdict) => FIT_RANK[verdict]);
      const spread = ranks.length ? Math.max(...ranks) - Math.min(...ranks) : null;
      if (group.length !== RUNS) {
        failures.push(`${config} ${fixture.id} ${path}: completed ${group.length}/${RUNS} required runs`);
      }
      if (spread !== null && spread > 1) {
        failures.push(`${config} ${fixture.id} ${path}: non-adjacent repeated verdict spread`);
      }
      if (eligibility.includes("BLOCKED") && eligibility.some((status) => status !== "BLOCKED")) {
        failures.push(`${config} ${fixture.id} ${path}: eligibility alternated between BLOCKED and another status`);
      }
      aggregate.push({
        config,
        fixture: fixture.id,
        path,
        verdictDistribution: Object.fromEntries([...new Set(verdicts)].map((verdict) => [verdict, verdicts.filter((item) => item === verdict).length])),
        eligibilityDistribution: Object.fromEntries([...new Set(eligibility)].map((status) => [status, eligibility.filter((item) => item === status).length])),
        invalidResponses: attempted.filter((record) => !record.result && !record.error).length,
        providerErrors: attempted.filter((record) => record.error).length,
        missingRuns: RUNS - attempted.length,
        repairs: 0,
        repeatedVerdictSpread: spread
      });
    }
  }
}

const paired = [];
for (const config of matrix.map(configId)) {
  for (const fixture of fixtures) {
    for (let run = 1; run <= RUNS; run += 1) {
      const combined = records.find((record) =>
        record.config === config && record.fixture === fixture.id && record.path === "combined" && record.run === run
      );
      const standalone = records.find((record) =>
        record.config === config && record.fixture === fixture.id && record.path === "standalone" && record.run === run
      );
      if (!combined?.result || !standalone?.result) continue;
      const verdictDistance = Math.abs(
        FIT_RANK[combined.result.verdict] - FIT_RANK[standalone.result.verdict]
      );
      const overlap = themeOverlap(combined.themes, standalone.themes);
      if (verdictDistance > 1) {
        failures.push(`${config} ${fixture.id} run ${run}: combined/standalone verdicts differ by ${verdictDistance} levels`);
      }
      if (combined.themes.length > 0 && standalone.themes.length > 0 && overlap === 0) {
        failures.push(`${config} ${fixture.id} run ${run}: combined/standalone findings have no material-theme overlap`);
      }
      paired.push({ config, fixture: fixture.id, run, verdictDistance, themeOverlap: overlap });
    }
  }
}

for (const row of aggregate) console.log(JSON.stringify(row));
const pairCount = paired.length;
const averageThemeOverlap = pairCount
  ? paired.reduce((sum, row) => sum + row.themeOverlap, 0) / pairCount
  : 0;
const nonAdjacentPairs = paired.filter((row) => row.verdictDistance > 1).length;
console.log(JSON.stringify({
  pairedRuns: pairCount,
  averageThemeOverlap: Number(averageThemeOverlap.toFixed(3)),
  nonAdjacentPairs,
  invalidResponses: records.filter((record) => !record.result && !record.error).length,
  providerErrors: records.filter((record) => record.error).length,
  missingRuns: matrix.length * fixtures.length * RUNS * 2 - records.length,
  repairAttempts: 0
}));

for (const failure of failures) console.error(`FAIL: ${failure}`);
console.log(`Result: ${failures.length ? "failed" : "passed"}; records=${records.length} failures=${failures.length}.`);
process.exit(failures.length ? 1 : 0);
