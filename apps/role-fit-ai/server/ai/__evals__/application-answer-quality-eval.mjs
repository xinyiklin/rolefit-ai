// Opt-in production-path benchmark. All fixtures are synthetic; no workspace inputs are read.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateApplicationAnswer } from "../applicationAnswerConversation.ts";
import { callConfiguredProvider } from "../clients.ts";
import { resolveProviderRequest } from "../providers.ts";
import { recordProviderUsage } from "../providerUsage.ts";
import { answerQualityFixtures } from "./fixtures/application-answer-quality.mjs";
import { answerHoldoutFixtures } from "./fixtures/application-answer-holdout.mjs";
import { answerExpandedFixtures } from "./fixtures/application-answer-expanded.mjs";
import { ANSWER_BENCHMARK_ARMS, ANSWER_BENCHMARK_JUDGES, answerControlChecks, blindAnswers, fixtureRequest, hash, judgePrompts, parseAnswerJudgment, summarizeAnswers, compareAnswerSettings } from "./support/application-answer-quality.mjs";
import { ANSWER_JUDGE_PROTOCOL } from "./support/application-answer-judge-protocol.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCES = ["shared/applicationAnswersContract.ts", "shared/cliReasoning.ts", "server/ai/applicationAnswerConversation.ts", "server/ai/applicationAnswers.ts", "server/ai/prompts.ts", "server/ai/clients.ts", "server/ai/providers.ts", "server/ai/providerUsage.ts", "server/ai-cli/index.ts", "src/lib/coverLetterEvidence.ts", "server/ai/__evals__/application-answer-quality-eval.mjs", "server/ai/__evals__/fixtures/application-answer-quality.mjs", "server/ai/__evals__/fixtures/application-answer-holdout.mjs", "server/ai/__evals__/fixtures/application-answer-expanded.mjs", "server/ai/__evals__/support/application-answer-quality.mjs", "server/ai/__evals__/support/application-answer-judge-protocol.mjs"];
const category = (error) => /auth|login|sign.?in/i.test(String(error?.message)) ? "authentication" : /quota|rate.limit/i.test(String(error?.message)) ? "quota" : /abort/i.test(String(error?.name)) ? "cancelled" : "provider-or-response";

export async function evaluateAnswer(fixture, arm, generate = generateApplicationAnswer) {
  const stats = {};
  const started = Date.now();
  const record = { fixture: fixture.id, arm: arm.id, humanReviewed: false };
  try {
    record.answer = await generate(fixtureRequest(fixture, arm), { stats });
    record.checks = answerControlChecks(fixture, record.answer);
  } catch (error) {
    record.error = category(error);
  }
  return { ...record, elapsedMs: Date.now() - started, attempts: stats.attempts ?? 0, usage: stats.usage ?? null };
}

export async function evaluateAnswerJudge(fixture, records, judge, dispatch = callConfiguredProvider) {
  const blind = blindAnswers(fixture.id, records, judge.id);
  const stats = {};
  const started = Date.now();
  const receipt = { fixture: fixture.id, judge: judge.id, order: blind.map(({ label, arm }) => ({ label, arm })), humanReviewed: false };
  if (!blind.length) return { ...receipt, error: "no-answers", attempts: 0, elapsedMs: 0 };
  try {
    const raw = await dispatch({ ...resolveProviderRequest(judge), ...judgePrompts(fixture, blind), retryUnreadableOutput: false }, stats);
    receipt.ratings = parseAnswerJudgment(raw, blind);
  } catch (error) {
    receipt.error = category(error);
  }
  return { ...receipt, attempts: stats.attempts ?? 0, usage: stats.usage ?? null, elapsedMs: Date.now() - started };
}

async function pool(jobs, run, concurrency = 2) {
  let next = 0;
  const result = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const index = next++;
      result[index] = await run(jobs[index]);
    }
  }));
  return result;
}

export function benchmarkSelection(argv) {
  const options = argv.slice(1);
  const resume = options.find((value) => value.startsWith("--resume="))?.slice(9);
  if (!["--run", "--dry-run"].includes(argv[0]) || new Set(options).size !== options.length
    || options.some((value) => !["--holdout", "--expanded"].includes(value) && !/^--resume=[A-Za-z0-9-]+$/.test(value))
    || options.filter((value) => value.startsWith("--resume=")).length > 1
    || (options.includes("--holdout") && options.includes("--expanded")) || (resume && argv[0] !== "--run")) {
    throw new Error("Use --dry-run or --run, optionally --holdout or --expanded, and --resume=<run-id> for live recovery.");
  }
  const corpus = options.includes("--expanded") ? "expanded-20261007" : options.includes("--holdout") ? "holdout-20261007" : "screen";
  const prior = [...answerQualityFixtures, ...answerHoldoutFixtures];
  const fixtures = corpus === "expanded-20261007"
    ? [...prior.map((fixture) => ({ ...fixture, cohort: "regression" })), ...answerExpandedFixtures.map((fixture) => ({ ...fixture, cohort: "fresh" }))]
    : corpus === "holdout-20261007" ? answerHoldoutFixtures : answerQualityFixtures;
  return { corpus, fixtures, resume };
}

export function carryFailedAttempt(previous, next) {
  if (!previous?.error) return next;
  const stats = {};
  if (previous.attempts !== 0) recordProviderUsage(stats, previous.usage ?? null);
  if (next.attempts !== 0) recordProviderUsage(stats, next.usage ?? null);
  return { ...next, elapsedMs: previous.elapsedMs === null || next.elapsedMs === null ? null : (previous.elapsedMs ?? 0) + (next.elapsedMs ?? 0),
    attempts: previous.attempts === null || next.attempts === null ? null : (previous.attempts ?? 0) + (next.attempts ?? 0), usage: stats.usage ?? null,
    priorErrors: [...(previous.priorErrors ?? []), previous.error] };
}

export async function main(argv = process.argv.slice(2)) {
  const { corpus, fixtures, resume } = benchmarkSelection(argv);
  const plan = { corpus, cases: fixtures.length, arms: ANSWER_BENCHMARK_ARMS, judges: ANSWER_BENCHMARK_JUDGES, judgeProtocol: ANSWER_JUDGE_PROTOCOL.version, generations: fixtures.length * ANSWER_BENCHMARK_ARMS.length, maximumRepairRequests: fixtures.length * ANSWER_BENCHMARK_ARMS.length, judgeRequests: fixtures.length * ANSWER_BENCHMARK_JUDGES.length, providerConcurrency: 2, generationOrder: "cyclic arm rotation by case" };
  if (argv[0] === "--dry-run") { console.log(JSON.stringify(plan, null, 2)); return; }
  const root = join(APP_ROOT, "workspace/application-answer-eval");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = resume ? join(root, resume) : mkdtempSync(join(root, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  const sourceHashes = Object.fromEntries(SOURCES.map((path) => [path, hash(readFileSync(join(APP_ROOT, path), "utf8"))]));
  if (resume) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    if (manifest.version !== 3 || hash(manifest.plan) !== hash(plan) || manifest.corpusHash !== hash(fixtures) || hash(manifest.sourceHashes) !== hash(sourceHashes)) throw new Error("Resume requires the exact original plan, fixtures and source hashes.");
  }
  chmodSync(dir, 0o700);
  let sequence = 0;
  const save = (name, value) => {
    const temporary = join(dir, `.${name}.${process.pid}-${sequence++}.tmp`);
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, join(dir, name));
  };
  const read = (name) => resume && existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), "utf8")) : undefined;
  if (!resume) {
    save("manifest.json", { version: 3, createdAt: new Date().toISOString(), plan, corpusHash: hash(fixtures), sourceHashes, judgeConsensus: ANSWER_JUDGE_PROTOCOL, labels: "Synthetic comparison; model judgments, not human certification or statistically precise equivalence.", costBasis: "Provider-reported counts/estimates only, including repairs and resumed failed attempts. Unknown cost stays null. Subscription/CLI charges are not inferred from API list prices." });
    save("fixtures.json", fixtures);
  }
  console.log(`Receipts: ${dir}`);
  const stoppedProviders = new Set();
  const jobs = fixtures.flatMap((fixture, index) => ANSWER_BENCHMARK_ARMS.map((_, offset) => ({ fixture, arm: ANSWER_BENCHMARK_ARMS[(index + offset) % ANSWER_BENCHMARK_ARMS.length] })));
  const records = await pool(jobs, async ({ fixture, arm }) => {
    const name = `${fixture.id}-${arm.id}.json`;
    const previous = read(name);
    if (previous?.answer) return previous;
    if (previous) save(`${name}.before-resume-${Date.now()}.json`, previous);
    if (!stoppedProviders.has(arm.provider)) save(name, carryFailedAttempt(previous, { fixture: fixture.id, arm: arm.id, error: "interrupted-in-flight", startedAt: new Date().toISOString(), attempts: null, usage: null, elapsedMs: null, humanReviewed: false }));
    const next = stoppedProviders.has(arm.provider)
      ? { fixture: fixture.id, arm: arm.id, error: "provider-stopped", elapsedMs: 0, attempts: 0, usage: null, humanReviewed: false }
      : await evaluateAnswer(fixture, arm);
    const record = carryFailedAttempt(previous, next);
    if (["authentication", "quota"].includes(record.error)) stoppedProviders.add(arm.provider);
    save(name, record);
    console.log(`${fixture.id} / ${arm.id}: ${record.answer?.status ?? record.error}`);
    return record;
  });
  save("generations.json", records);
  const judgeJobs = fixtures.flatMap((fixture) => ANSWER_BENCHMARK_JUDGES.map((judge) => ({ fixture, judge })));
  const judgments = await pool(judgeJobs, async ({ fixture, judge }) => {
    const name = `judge-${fixture.id}-${judge.id}.json`;
    const previous = read(name);
    // A changed candidate set needs a fresh judgment even after a partial run.
    const candidateRecords = records.filter((record) => record.fixture === fixture.id);
    const candidateHash = hash(candidateRecords.map(({ arm, answer }) => ({ arm, answer })));
    if (previous?.ratings && previous.candidateHash === candidateHash) return previous;
    const prior = previous?.ratings ? { ...previous, error: "candidate-set-changed" } : previous;
    if (previous) save(`${name}.before-resume-${Date.now()}.json`, previous);
    if (!stoppedProviders.has(judge.provider)) save(name, carryFailedAttempt(prior, { fixture: fixture.id, judge: judge.id, error: "interrupted-in-flight", candidateHash, startedAt: new Date().toISOString(), attempts: null, usage: null, elapsedMs: null, humanReviewed: false }));
    const next = stoppedProviders.has(judge.provider)
      ? { fixture: fixture.id, judge: judge.id, error: "provider-stopped", attempts: 0, humanReviewed: false }
      : await evaluateAnswerJudge(fixture, candidateRecords, judge);
    const judgment = { ...carryFailedAttempt(prior, next), candidateHash };
    if (["authentication", "quota"].includes(judgment.error)) stoppedProviders.add(judge.provider);
    save(name, judgment);
    console.log(`judge ${fixture.id} / ${judge.id}: ${judgment.ratings ? "rated" : judgment.error}`);
    return judgment;
  });
  save("judgments.json", judgments);
  const cohorts = corpus === "expanded-20261007" ? Object.fromEntries(["regression", "fresh"].map((cohort) => {
    const ids = new Set(fixtures.filter((fixture) => fixture.cohort === cohort).map(({ id }) => id));
    return [cohort, { cases: ids.size, arms: summarizeAnswers(records.filter((record) => ids.has(record.fixture)), judgments.filter((judgment) => ids.has(judgment.fixture))) }];
  })) : undefined;
  const summary = { arms: summarizeAnswers(records, judgments), cohorts, comparisons: compareAnswerSettings(judgments), judgeRequests: judgments.some((judgment) => judgment.attempts === null) ? null : judgments.reduce((sum, judgment) => sum + judgment.attempts, 0), judgeFailures: judgments.filter((judgment) => judgment.error).length, humanReviewed: false, limitations: ["One run per scenario; related cases share candidate contexts and are not independent population samples.", "Fresh cases become regression data after inspection; no human calibration.", "Both judges approved the same rubric before grading independently; Opus also participates as a candidate, and both family judgments remain separate.", "Changed judges and rubric mean scores are not directly comparable with prior low-judge rounds.", "Interrupted in-flight calls make resumed total attempts, usage and elapsed time unknown rather than zero."] };
  save("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  if (records.some((record) => record.error) || summary.judgeFailures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Answer benchmark did not complete; inspect local receipts. No success recorded."); process.exitCode = 1; });
}
