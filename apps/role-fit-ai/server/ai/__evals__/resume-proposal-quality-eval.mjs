// Opt-in synthetic benchmark. Importing it and running npm test never calls a provider.
// Usage: npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs]
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { callConfiguredProvider } from "../clients.ts";
import { generateResumeProposal } from "../resumeProposal.ts";
import { resolveProviderRequest } from "../providers.ts";
import { factCheckEdits, factCheckPrompt, fixtureIndex, gradeProposal, opportunityMetOnlyByChurn, validateFactCheck } from "./support/resume-proposal-quality.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_URL = new URL("./fixtures/resume-proposal-quality.json", import.meta.url);
export const fixtures = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
export const JUDGE = { provider: "codex-cli", model: "gpt-6-astra", reasoningEffort: "high" };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const publicConfig = ({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort });

export function evalOptions(argv, env) {
  const runs = Number(argv[0] ?? 1);
  if (argv.length > 1 || !Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be an integer from 1 to 5");
  const names = (env.EVAL_FIXTURES || "all").split(",");
  const selected = names[0] === "all" && names.length === 1 ? fixtures : fixtures.filter((fixture) => names.includes(fixture.name));
  if (!selected.length || (names[0] !== "all" && new Set(names).size !== selected.length) || (names.includes("all") && names.length > 1)) throw new Error("EVAL_FIXTURES must be all or known comma-separated fixture names");
  return {
    runs, selected,
    config: {
      provider: env.EVAL_PROVIDER || "claude-cli",
      model: env.EVAL_MODEL ?? ((env.EVAL_PROVIDER || "claude-cli") === "claude-cli" ? "opus" : ""),
      ...(env.EVAL_REASONING_EFFORT ? { reasoningEffort: env.EVAL_REASONING_EFFORT } : {})
    }
  };
}

export async function evaluateCase(fixture, config, {
  generate = generateResumeProposal,
  judge = callConfiguredProvider
} = {}) {
  const started = Date.now();
  const receipt = { fixture: fixture.name, config: publicConfig(config), judge: JUDGE, humanReviewed: false };
  let stage = "generation";
  try {
    const { scope, resumeText } = fixtureIndex(fixture);
    receipt.result = await generate({
      body: config, resumeScope: scope, scopeText: resumeText, jobText: fixture.jobText,
      candidateContext: fixture.candidateContext, customInstructions: fixture.customInstructions,
      boldBulletKeywords: fixture.boldBulletKeywords ?? true
    });
    stage = "trap-check";
    receipt.grade = gradeProposal(fixture, receipt.result);
    const edits = factCheckEdits(fixture, receipt.result);
    receipt.factCheck = { status: "not-needed", edits: [], unsupported: 0, immaterial: 0 };
    if (edits.length) {
      stage = "fact-check";
      const stats = {};
      const raw = await judge({ ...JUDGE, ...factCheckPrompt(fixture, edits), retryUnreadableOutput: false }, stats);
      receipt.judgeAttempts = stats.attempts ?? 1;
      stage = "fact-check-shape";
      receipt.factCheck = validateFactCheck(raw, edits);
      if (opportunityMetOnlyByChurn(fixture, receipt.grade, edits, receipt.factCheck)) {
        receipt.grade.hits.push({ type: "missedOpportunity" });
        receipt.grade.passed = false;
      }
    }
    receipt.passed = receipt.grade.passed && receipt.factCheck.unsupported === 0;
  } catch {
    // Provider errors can contain response excerpts. Keep only the failing stage.
    receipt.error = stage;
    if (stage.startsWith("fact-check")) receipt.factCheck = { status: "error", edits: [], unsupported: null, immaterial: null };
    receipt.passed = false;
  }
  receipt.seconds = (Date.now() - started) / 1000;
  return receipt;
}

export function summaryRow(receipt, run) {
  const hits = {};
  for (const hit of receipt.grade?.hits ?? []) hits[hit.type] = (hits[hit.type] ?? 0) + 1;
  return {
    fixture: receipt.fixture, run, passed: receipt.passed, status: receipt.result?.status ?? "ERROR",
    ...(receipt.error ? { error: receipt.error } : {}),
    metrics: receipt.grade?.metrics ?? null, opportunities: receipt.grade?.opportunities ?? null,
    trapHits: hits, factCheck: receipt.error?.startsWith("fact-check") ? "error" : receipt.factCheck?.status ?? "unverified",
    unsupported: receipt.error?.startsWith("fact-check") ? null : receipt.factCheck?.unsupported ?? null,
    immaterial: receipt.error?.startsWith("fact-check") ? null : receipt.factCheck?.immaterial ?? null,
    providerAttempts: receipt.result?.attempts ?? null, judgeAttempts: receipt.judgeAttempts ?? 0,
    seconds: receipt.seconds
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs:1-5]\nEVAL_PROVIDER, EVAL_MODEL, EVAL_REASONING_EFFORT select the generator; EVAL_FIXTURES selects all or comma-separated names.\nEvery run includes GPT-6 Astra/high per-edit fact-checks via Codex CLI. Both providers must be configured.\nFixtures: " + fixtures.map((fixture) => fixture.name).join(", "));
    return 0;
  }
  let options;
  try {
    options = evalOptions(argv, env);
    options.config = publicConfig(resolveProviderRequest(options.config));
    resolveProviderRequest(JUDGE);
  } catch {
    console.error("Invalid eval configuration or unavailable provider. Check --help and the generator/Astra provider settings.");
    return 2;
  }
  const root = join(APP_ROOT, "workspace/resume-proposal-eval");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const out = mkdtempSync(join(root, new Date().toISOString().replace(/[:.]/g, "-") + "-"));
  chmodSync(out, 0o700);
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const sourceHashes = Object.fromEntries([
    "../resumeProposal.ts", "../prompts.ts", "../grounding.ts", "../sanitize.ts", "../resumeScope.ts", "../json.ts", "../clients.ts",
    "../claimEvidence.ts", "../../../shared/resumePolishContract.ts", "../../../shared/candidateProfileContract.ts",
    "../../../shared/evidencePolarity.ts", "../../../shared/contentWarnings.ts", "../../../src/lib/coverLetterTemplate.ts",
    "../../../src/resume/terminology.ts", "./support/resume-proposal-quality.mjs", "./resume-proposal-quality-eval.mjs"
  ].map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
  save("manifest.json", {
    createdAt: new Date().toISOString(), config: options.config, judge: JUDGE, runs: options.runs,
    fixtures: options.selected.map((fixture) => fixture.name), corpusHash: hash(readFileSync(FIXTURE_URL)), sourceHashes,
    labelProvenance: "Agent-authored synthetic traps; Astra labels are model judgments, not human factual certification.",
    fixtureProvenance: Object.entries(Object.groupBy(options.selected, (fixture) => fixture.provenance)).map(([provenance, group]) => ({ provenance, count: group.length })),
    humanReviewed: false
  });
  save("fixtures.json", options.selected);
  console.log(`Resume Proposal benchmark: ${options.selected.length} fixtures x ${options.runs} runs; Astra/high fact-check enabled.`);
  const rows = [];
  outer: for (let run = 1; run <= options.runs; run += 1) {
    for (const fixture of options.selected) {
      const receipt = await evaluateCase(fixture, options.config);
      save(`${fixture.name}-run-${run}.json`, receipt);
      const row = summaryRow(receipt, run);
      rows.push(row);
      console.log(JSON.stringify(row));
      if (receipt.error) break outer;
    }
  }
  const expected = options.selected.length * options.runs;
  const passed = rows.filter((row) => row.passed).length;
  save("summary.json", { expected, completed: rows.length, passed, unrun: expected - rows.length, rows });
  console.log(`Result: ${passed}/${expected} passed; ${expected - rows.length} unrun. Materiality and length metrics are diagnostic; a required case must touch a named opportunity. Receipts: ${out}`);
  return passed === expected ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch {
    console.error("Could not complete the eval or write its receipts; no success recorded.");
    process.exitCode = 1;
  }
}
