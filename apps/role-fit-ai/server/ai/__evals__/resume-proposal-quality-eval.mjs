// Opt-in synthetic benchmark. Importing it and running npm test never calls a provider.
// Usage: npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs]
// EVAL_POLISH_REVIEW=paired also reviews each generated proposal (the opt-in Polish
// review) and grades the kept edits beside the full proposal. Each fixture's
// frozen Fit findings are sent by default; EVAL_FIT_FINDINGS=off omits them.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { flattenResumeTargets } from "../../../shared/resumePolishContract.ts";
import { callConfiguredProvider } from "../clients.ts";
import { generateResumeProposal, selectPromptTargets } from "../resumeProposal.ts";
import { reviewResumeProposal } from "../resumeProposalReview.ts";
import { resolveProviderRequest } from "../providers.ts";
import {
  factCheckEdits, factCheckPrompt, fixtureIndex, gradeProposal, gradeReviewProbe, opportunityMetOnlyByChurn,
  pairedReview, reviewProbeProposal, reviewSummary, validateFactCheck
} from "./support/resume-proposal-quality.mjs";
import { fitGapFailures, gradeFitGaps, polishFitFindings } from "./support/fit-findings.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_URL = new URL("./fixtures/resume-proposal-quality.json", import.meta.url);
export const fixtures = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
const REVIEW_PROBE_URL = new URL("./fixtures/resume-proposal-review-probes.json", import.meta.url);
export const reviewProbes = JSON.parse(readFileSync(REVIEW_PROBE_URL, "utf8"));
export const JUDGE = { provider: "codex-cli", model: "gpt-6-astra", reasoningEffort: "high" };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const publicConfig = ({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort });

export function evalOptions(argv, env) {
  const runs = Number(argv[0] ?? 1);
  if (argv.length > 1 || !Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be an integer from 1 to 5");
  const names = (env.EVAL_FIXTURES || "all").split(",");
  const selected = names[0] === "all" && names.length === 1 ? fixtures : fixtures.filter((fixture) => names.includes(fixture.name));
  if (!selected.length || (names[0] !== "all" && new Set(names).size !== selected.length) || (names.includes("all") && names.length > 1)) throw new Error("EVAL_FIXTURES must be all or known comma-separated fixture names");
  const review = env.EVAL_POLISH_REVIEW || "off";
  if (!["off", "paired"].includes(review)) throw new Error("EVAL_POLISH_REVIEW must be off or paired");
  // "off" reproduces a request from before Fit findings reached Polish.
  const fitFindings = env.EVAL_FIT_FINDINGS || "on";
  if (!["on", "off"].includes(fitFindings)) throw new Error("EVAL_FIT_FINDINGS must be on or off");
  return {
    runs, selected, review, fitFindings: fitFindings === "on",
    config: {
      provider: env.EVAL_PROVIDER || "claude-cli",
      model: env.EVAL_MODEL ?? ((env.EVAL_PROVIDER || "claude-cli") === "claude-cli" ? "opus" : ""),
      ...(env.EVAL_REASONING_EFFORT ? { reasoningEffort: env.EVAL_REASONING_EFFORT } : {})
    }
  };
}

// The production review over one already-generated proposal, on the generator's
// own provider settings (the Resume Polish stage's, in the product).
export async function reviewWithProduction(fixture, config, changes, stats = {}) {
  const { scope, resumeText } = fixtureIndex(fixture);
  const targets = selectPromptTargets(flattenResumeTargets(scope, fixture.candidateContext), fixture.jobText).selectedTargets;
  return reviewResumeProposal({
    changes, targets, jobText: fixture.jobText, scopeText: resumeText, candidateContext: fixture.candidateContext,
    customInstructions: fixture.customInstructions ?? "", config: resolveProviderRequest(config), stats
  });
}

// A provider failure (limit, auth, timeout) may clear, so the review waits and
// retries; an unreadable reply is a review result in its own right and is counted.
export const REVIEW_RETRY_DELAYS_MS = [60_000, 300_000, 900_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runReview(review, subject, config, changes, { retryDelays = REVIEW_RETRY_DELAYS_MS, wait = sleep } = {}) {
  for (let retries = 0; ; retries += 1) {
    const stats = {};
    let outcome;
    try {
      outcome = await review(subject, config, changes, stats);
    } catch {
      outcome = { outcome: "UNAVAILABLE", attempts: stats.attempts ?? 0, failure: "provider" };
    }
    if (outcome.outcome === "REVIEWED") return { outcome, stats, retries };
    if (outcome.failure === "unreadable") return { status: "unreadable", attempts: outcome.attempts, retries };
    if (retries >= retryDelays.length) return { status: "error", retries };
    await wait(retryDelays[retries]);
  }
}

export async function evaluateCase(fixture, config, {
  generate = generateResumeProposal,
  judge = callConfiguredProvider,
  review = null,
  retry = {},
  fitFindings = true
} = {}) {
  const started = Date.now();
  const receipt = { fixture: fixture.name, config: publicConfig(config), judge: JUDGE, humanReviewed: false };
  let stage = "generation";
  try {
    const { scope, resumeText } = fixtureIndex(fixture);
    receipt.result = await generate({
      body: config, resumeScope: scope, scopeText: resumeText, jobText: fixture.jobText,
      candidateContext: fixture.candidateContext, customInstructions: fixture.customInstructions,
      boldBulletKeywords: fixture.boldBulletKeywords ?? true,
      fitFindings: fitFindings ? polishFitFindings(fixture) : null
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
    if (fitFindings) receipt.fitGaps = gradeFitGaps(fixture, receipt.result, edits, receipt.factCheck);
    receipt.passed = receipt.grade.passed && receipt.factCheck.unsupported === 0 && fitGapFailures(receipt.fitGaps) === 0;
  } catch {
    // Provider errors can contain response excerpts. Keep only the failing stage.
    receipt.error = stage;
    if (stage.startsWith("fact-check")) receipt.factCheck = { status: "error", edits: [], unsupported: null, immaterial: null };
    receipt.passed = false;
  }
  // The reviewed arm never rewrites the unreviewed arm's result. The product fails
  // open; here a failed review is unreadable (counted) or an execution failure,
  // never a review that kept everything.
  if (review && !receipt.error) {
    if (!receipt.result.changes.length) receipt.review = { status: "not-needed" };
    else {
      const run = await runReview(review, fixture, config, receipt.result.changes, retry);
      receipt.review = run.outcome
        ? { ...pairedReview(fixture, receipt, run.outcome), usage: run.stats.usage ?? null, retries: run.retries }
        : { status: run.status, ...(run.attempts !== undefined ? { attempts: run.attempts } : {}), retries: run.retries };
      if (run.status === "error") receipt.error = "review";
    }
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
    ...(receipt.fitGaps ? { fitGaps: Object.fromEntries(Object.entries(receipt.fitGaps).filter(([key]) => key !== "rows")) } : {}),
    ...(receipt.review ? {
      review: receipt.review.status === "reviewed"
        ? { status: "reviewed", passed: receipt.review.passed, heldBack: receipt.review.heldBack.map(({ reason, kind, class: label }) => ({ reason, kind, class: label })),
            opportunityLost: receipt.review.opportunityLost, trapHitsCaught: receipt.review.trapHitsCaught, attempts: receipt.review.attempts }
        : { status: receipt.review.status }
    } : {}),
    ...(receipt.review?.heldBack?.some((item) => item.keyEvidence) ? { keyEvidenceHeldBack: receipt.review.heldBack.filter((item) => item.keyEvidence).map(({ class: label }) => label) } : {}),
    seconds: receipt.seconds
  };
}

export async function evaluateReviewProbe(probe, config, { review = reviewWithProduction, retry = {} } = {}) {
  const receipt = { probe: probe.name, config: publicConfig(config), humanReviewed: false };
  const run = await runReview(review, probe, config, reviewProbeProposal(probe).result.changes, retry);
  if (run.outcome) Object.assign(receipt, gradeReviewProbe(probe, run.outcome), { attempts: run.outcome.attempts, usage: run.stats.usage ?? null, retries: run.retries });
  else Object.assign(receipt, { status: run.status, agreed: false, retries: run.retries, ...(run.status === "error" ? { error: "review" } : {}) });
  return receipt;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs:1-5]\nEVAL_PROVIDER, EVAL_MODEL, EVAL_REASONING_EFFORT select the generator; EVAL_FIXTURES selects all or comma-separated names.\nEVAL_POLISH_REVIEW=paired also runs the opt-in Polish review on each generated proposal (same provider settings) plus the review probes, and grades both arms; off is the default.\nEVAL_FIT_FINDINGS=off omits each fixture's frozen Fit findings (on by default) to reproduce the earlier request.\nEvery run includes GPT-6 Astra/high per-edit fact-checks via Codex CLI. Both providers must be configured.\nFixtures: " + fixtures.map((fixture) => fixture.name).join(", ") + "\nReview probes: " + reviewProbes.map((probe) => probe.name).join(", "));
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
    "../resumeProposal.ts", "../resumeProposalReview.ts", "../prompts.ts", "../grounding.ts", "../sanitize.ts", "../resumeScope.ts", "../json.ts", "../clients.ts",
    "../claimEvidence.ts", "../../../shared/resumePolishContract.ts", "../../../shared/candidateProfileContract.ts",
    "../../../shared/evidencePolarity.ts", "../../../shared/contentWarnings.ts", "../../../shared/polishFitFindings.ts", "../../../src/lib/coverLetterTemplate.ts",
    "../../../src/resume/terminology.ts", "./support/resume-proposal-quality.mjs", "./resume-proposal-quality-eval.mjs"
  ].map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
  save("manifest.json", {
    createdAt: new Date().toISOString(), config: options.config, judge: JUDGE, runs: options.runs, reviewArm: options.review, fitFindingsArm: options.fitFindings ? "on" : "off",
    fixtures: options.selected.map((fixture) => fixture.name), corpusHash: hash(readFileSync(FIXTURE_URL)), sourceHashes,
    ...(options.review === "paired" ? { reviewProbesHash: hash(readFileSync(REVIEW_PROBE_URL)) } : {}),
    labelProvenance: "Agent-authored synthetic traps; Astra labels are model judgments, not human factual certification.",
    fixtureProvenance: Object.entries(Object.groupBy(options.selected, (fixture) => fixture.provenance)).map(([provenance, group]) => ({ provenance, count: group.length })),
    humanReviewed: false
  });
  save("fixtures.json", options.selected);
  const paired = options.review === "paired";
  if (paired) save("review-probes.json", reviewProbes);
  console.log(`Resume Proposal benchmark: ${options.selected.length} fixtures x ${options.runs} runs; Astra/high fact-check enabled${paired ? "; paired Polish review on" : ""}.`);
  const rows = [];
  const receipts = [];
  const probeReceipts = [];
  outer: for (let run = 1; run <= options.runs; run += 1) {
    for (const fixture of options.selected) {
      const receipt = await evaluateCase(fixture, options.config, { fitFindings: options.fitFindings, ...(paired ? { review: reviewWithProduction } : {}) });
      receipts.push(receipt);
      save(`${fixture.name}-run-${run}.json`, receipt);
      const row = summaryRow(receipt, run);
      rows.push(row);
      console.log(JSON.stringify(row));
      if (receipt.error) break outer;
    }
    for (const probe of paired ? reviewProbes : []) {
      const receipt = await evaluateReviewProbe(probe, options.config);
      save(`review-probe-${probe.name}-run-${run}.json`, receipt);
      probeReceipts.push(receipt);
      console.log(JSON.stringify({ probe: probe.name, run, agreed: receipt.agreed, ...(receipt.status ? { status: receipt.status } : {}), ...(receipt.error ? { error: receipt.error } : {}) }));
      if (receipt.error) break outer;
    }
  }
  const expected = options.selected.length * options.runs;
  const passed = rows.filter((row) => row.passed).length;
  const review = paired ? reviewSummary(receipts, probeReceipts) : undefined;
  const fitGaps = options.fitFindings ? Object.fromEntries(["addressed", "noEvidence", "notReported", "addressedNoEvidenceGap", "addressedByUnsupported"]
    .map((key) => [key, rows.reduce((total, row) => total + (row.fitGaps?.[key] ?? 0), 0)])) : undefined;
  save("summary.json", { expected, completed: rows.length, passed, unrun: expected - rows.length, rows, ...(review ? { review } : {}), ...(fitGaps ? { fitGaps } : {}) });
  if (fitGaps) console.log(`Fit gaps: ${JSON.stringify(fitGaps)}`);
  if (review) console.log(`Review arm: ${JSON.stringify(review)}`);
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
