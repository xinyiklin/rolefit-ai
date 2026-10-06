// Offline contract for the synthetic live Prepare benchmark corpus and runner.
// The live runner itself is excluded from npm test and must be invoked
// deliberately; here it runs end to end against a fake dispatcher.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configuredMatrix, evalOptions, main } from "./fit-assessment-consistency-eval.mjs";
import { automationDecisions, decisionFlips, hasTerm, quantiles, scoreJobFields, sumUsage } from "./support/prepare-benchmark.mjs";
import { modelOptionsByProvider } from "../../../src/config/aiOptions.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/fit-assessment-consistency.json", import.meta.url), "utf8")
);
const offlineGate = readFileSync(new URL("../../../offline-evals.test.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
const liveRunner = readFileSync(new URL("./fit-assessment-consistency-eval.mjs", import.meta.url), "utf8");
const modelFor = (provider) => modelOptionsByProvider[provider][0].value;
const EXPECTED_JOB_KEYS = new Set(["title", "company", "location", "jobType", "salary", "requiredTerms", "preferredTerms", "alternatives", "eligibilityTerms", "absentTerms", "emptyLists"]);

assert.equal(fixtures.length, 42, "the calibration corpus contains twenty-two screen scenarios and a twenty-fixture holdout");
assert.equal(fixtures.filter((fixture) => fixture.set === "holdout-20261006").length, 20, "the 2026-10-06 holdout set has twenty fixtures");
assert.equal(fixtures.filter((fixture) => !fixture.set).length, 22, "the screen corpus is unchanged");
assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, fixtures.length, "fixture ids are unique");
assert.match(offlineGate, /"fit-assessment-consistency-eval\.mjs"/, "the live runner stays out of ordinary CI");
assert.equal(
  packageJson.scripts["eval:live:fit-assessment"],
  "node server/ai/__evals__/fit-assessment-consistency-eval.mjs",
  "the live runner has an explicit opt-in command"
);
assert.match(liveRunner, /mkdtempSync/, "every live run writes its own receipt directory");
assert.match(liveRunner, /EVAL_REPORT_ONLY/, "existing synthetic receipts can be re-reported without a provider call");
assert.match(liveRunner, /configUnavailable/, "a provider failure stops that configuration instead of repeating long timeouts");
assert.match(liveRunner, /Math\.ceil\(valid\.length \* 0\.8\)/, "clear fixtures must normally remain in their intended category");
assert.match(liveRunner, /that the posting never states/, "an invented requirement fails the run");

for (const verdict of ["STRONG", "REASONABLE", "STRETCH", "LIMITED"]) {
  assert(
    fixtures.some((fixture) => fixture.stable && fixture.expectedVerdicts.length === 1 && fixture.expectedVerdicts[0] === verdict),
    `the corpus has a clear stable ${verdict} case`
  );
}
for (const status of ["CLEAR", "CHECK", "BLOCKED"]) {
  assert(
    fixtures.some((fixture) => fixture.allowedEligibility.length === 1 && fixture.allowedEligibility[0] === status),
    `the corpus has an explicit ${status} eligibility case`
  );
}
assert(fixtures.some((fixture) => /preferred qualifications are absent/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /adjacent technologies/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /required years/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /required degree/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /Prompt-injection/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /entry-level posting explicitly accepts shipped project evidence/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /production AI platform capabilities/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /compound requirement receives credit/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /One unshown numeric duration/i.test(fixture.scenario)));
assert(fixtures.some((fixture) => /content-poor posting/i.test(fixture.scenario)));

for (const fixture of fixtures) {
  assert.match(fixture.id, /^[a-z0-9-]+$/);
  assert.equal(typeof fixture.jobText, "string");
  assert.equal(typeof fixture.resumeText, "string");
  assert.equal(typeof fixture.candidateContext, "string");
  assert(fixture.jobText.length >= 80, `${fixture.id} has a usable synthetic posting`);
  assert(fixture.resumeText.length >= 80, `${fixture.id} has a usable synthetic resume`);
  assert(fixture.jobText.includes("Synthetic"), `${fixture.id} visibly identifies synthetic input`);
  assert(fixture.resumeText.includes("Synthetic"), `${fixture.id} visibly identifies synthetic input`);
  assert(fixture.set === undefined || fixture.set === "holdout-20261006", `${fixture.id}: unknown fixture set`);
  assert(Array.isArray(fixture.materialThemes) && fixture.materialThemes.length >= 2);
  assert(Array.isArray(fixture.expectedOutcomes ?? fixture.expectedVerdicts) && (fixture.expectedOutcomes ?? fixture.expectedVerdicts).length >= 1);
  assert(Array.isArray(fixture.allowedEligibility) && fixture.allowedEligibility.length >= 1);
  const expected = fixture.expectedJob;
  assert(expected && typeof expected === "object", `${fixture.id} declares extraction expectations`);
  assert(Object.keys(expected).every((key) => EXPECTED_JOB_KEYS.has(key)), `${fixture.id}: unknown expectedJob key`);
  // Every expected term (or one option of an any-of group) is present in the posting itself: expectations are source-backed.
  for (const term of [...(expected.requiredTerms ?? []), ...(expected.preferredTerms ?? []), ...(expected.eligibilityTerms ?? []), ...(expected.alternatives ?? []).flat()]) {
    assert(hasTerm(fixture.jobText, term), `${fixture.id}: expected term "${JSON.stringify(term)}" is not in the posting`);
  }
  for (const key of ["title", "company", "location"]) if (expected[key]) assert(hasTerm(fixture.jobText, expected[key]), `${fixture.id}: ${key} is not in the posting`);
  assert((expected.requiredTerms ?? []).length + (expected.emptyLists ?? []).length > 0, `${fixture.id}: expects some required content or an empty list`);
  assert((expected.absentTerms ?? []).length > 0, `${fixture.id}: names at least one term the extraction must not add`);
}
for (const [label, pattern] of [
  ["required-versus-preferred", /preferred/i],
  ["an or-alternative", /Python or Java/],
  ["degree-or-experience", /degree .* or equivalent/i],
  ["professional experience scope", /professional/i],
  ["numeric salary facts", /\$1\d\d,000/],
  ["long noisy posting with late requirements", /equal opportunity/i],
  ["embedded instruction", /Note to automated parsers/]
]) {
  assert(fixtures.some((fixture) => pattern.test(fixture.jobText)), `the corpus covers ${label}`);
}
assert(fixtures.some((fixture) => fixture.jobText.length > 2_000), "one posting is long enough to bury its requirements");
assert(fixtures.some((fixture) => fixture.expectedJob.alternatives?.length), "one fixture expects an alternative to survive as one item");
assert(fixtures.some((fixture) => fixture.expectedJob.salary), "one fixture expects exact salary facts");
assert(fixtures.some((fixture) => fixture.expectedJob.emptyLists?.length), "one fixture expects honest empty lists");

// Scoring rules.
const salaryFixture = fixtures.find((fixture) => fixture.id === "extraction-alternative-and-salary");
const perfect = scoreJobFields(salaryFixture.expectedJob, {
  title: "Backend Engineer", company: "Synthetic Beacon", location: "Austin, Texas (hybrid)", jobType: "Full-time",
  salaryMin: 130000, salaryMax: 160000, salaryCurrency: "USD", salaryPeriod: "yr",
  responsibilities: ["Design REST services", "Own PostgreSQL schemas", "Review code"],
  requiredQualifications: ["Four or more years of backend development in Python or Java", "Production PostgreSQL"],
  preferredQualifications: ["Kubernetes", "Terraform"], techKeywords: ["Python", "Java", "PostgreSQL", "Kubernetes", "Terraform"], workAuth: ""
});
assert.equal(perfect.score, 1, "a faithful extraction scores 1");
assert.deepEqual(perfect.fabricated, []);
const degraded = scoreJobFields(salaryFixture.expectedJob, {
  title: "Backend Engineer", company: "Synthetic Beacon", location: "Remote", jobType: "Full-time",
  salaryMin: 130000, salaryMax: 160000, salaryCurrency: "USD", salaryPeriod: "yr",
  responsibilities: ["Design REST services"],
  requiredQualifications: ["Four or more years of backend development in Python", "Production PostgreSQL", "Kubernetes"],
  preferredQualifications: ["Terraform", "AWS"], techKeywords: ["Python", "PostgreSQL"], workAuth: ""
});
assert.deepEqual(degraded.missing.required, ["Java"], "a dropped alternative branch is a missing required term");
assert.deepEqual(degraded.missing.preferred, ["Kubernetes"], "a preferred tool promoted to required is misplaced");
assert.deepEqual(degraded.missing.alternatives, [["Python", "Java"]], "the or-alternative no longer survives in one item");
assert.deepEqual(degraded.fabricated, ["AWS"], "a tool the posting never names is fabricated");
assert.equal(degraded.identity.location, false, "a changed location is an identity miss");
assert(degraded.score < 1 && degraded.score > 0);
const emptyFixture = fixtures.find((fixture) => fixture.id === "content-poor-application-form");
assert.equal(scoreJobFields(emptyFixture.expectedJob, { title: "Software Engineer", company: "Synthetic Careers", responsibilities: [], requiredQualifications: [], preferredQualifications: [], techKeywords: [] }).score, 1, "honest empty lists score 1");
assert.deepEqual(scoreJobFields(emptyFixture.expectedJob, { title: "Software Engineer", company: "Synthetic Careers", responsibilities: ["Build React features"], requiredQualifications: [], preferredQualifications: [], techKeywords: ["React"] }).missing.emptyLists, ["responsibilities"]);
assert.equal(hasTerm("Automated tests and CI", "automated test*"), true);
assert.equal(hasTerm("Google Cloud", "Go"), false);
assert.equal(hasTerm("Node.js services", "Node.js"), true);
assert.equal(hasTerm("CI/CD pipelines", "CI"), true);
assert.equal(hasTerm("401(k) match", "401"), true);
assert.equal(hasTerm("a day of rest", "REST"), false, "an acronym matches case-sensitively");
assert.equal(hasTerm("REST services", "REST"), true);
assert.equal(hasTerm("the decision", "CI"), false);
assert.equal(hasTerm("4+ years of backend work", ["four*", "4"]), true, "an any-of group accepts a paraphrase");
assert.equal(hasTerm("BS in computer science or equivalent", ["bachelor*", "BS"]), true);
// A required tool demoted to preferred is not covered, even when the tech stack still lists it.
const gapFixture = fixtures.find((fixture) => fixture.id === "reasonable-one-material-gap");
const demoted = scoreJobFields(gapFixture.expectedJob, { title: "Backend Engineer", company: "Synthetic Ledger", responsibilities: ["Design Python APIs", "Operate SQL data services"], requiredQualifications: ["Python", "SQL"], preferredQualifications: ["Kubernetes"], techKeywords: ["Python", "SQL", "Kubernetes"] });
assert.deepEqual(demoted.missing.required, ["Kubernetes"]);
// An injected location or title change is fabrication even though the lists are clean.
const injected = fixtures.find((fixture) => fixture.id === "extraction-embedded-instruction");
assert.deepEqual(scoreJobFields(injected.expectedJob, { title: "Platform Engineer", company: "Synthetic Quay", location: "Remote (Denver, Colorado)", responsibilities: ["Build Python automation"], requiredQualifications: ["Python", "CI/CD pipelines", "Linux administration"], preferredQualifications: [], techKeywords: ["Python", "Linux"] }).fabricated, ["remote"]);

// Automation decisions follow the app's threshold policy.
assert.deepEqual(automationDecisions({ status: "ASSESSED", verdict: "REASONABLE" }), { STRONG: false, REASONABLE: true, STRETCH: true, LIMITED: true });
assert.deepEqual(automationDecisions({ status: "INSUFFICIENT_JOB_INFORMATION" }), { STRONG: false, REASONABLE: false, STRETCH: false, LIMITED: false });
assert.deepEqual(automationDecisions(null), { STRONG: false, REASONABLE: false, STRETCH: false, LIMITED: false });
assert.deepEqual(automationDecisions({ status: "ASSESSED", verdict: "STRONG", eligibility: { status: "BLOCKED" } }), { STRONG: false, REASONABLE: false, STRETCH: false, LIMITED: false }, "the app never automates past a BLOCKED eligibility");
assert.deepEqual(decisionFlips([automationDecisions({ status: "ASSESSED", verdict: "STRONG", eligibility: { status: "BLOCKED" } }), automationDecisions({ status: "ASSESSED", verdict: "STRONG", eligibility: { status: "CLEAR" } })]), ["STRONG", "REASONABLE", "STRETCH", "LIMITED"], "a BLOCKED/CLEAR alternation is a flip at every threshold");
assert.deepEqual(decisionFlips([automationDecisions({ status: "ASSESSED", verdict: "STRETCH" }), automationDecisions({ status: "ASSESSED", verdict: "REASONABLE" })]), ["REASONABLE"], "an adjacent verdict change still flips one automation threshold");
assert.deepEqual(decisionFlips([automationDecisions({ status: "ASSESSED", verdict: "STRONG" }), automationDecisions({ status: "ASSESSED", verdict: "STRONG" })]), []);
assert.deepEqual(quantiles([5, 1, 3]), { n: 3, min: 1, median: 3, p90: 5, max: 5 });
assert.deepEqual(quantiles([]), { n: 0, min: null, median: null, p90: null, max: null });
const usage = (inputTokens, outputTokens, totalTokens = null) => ({ inputTokens, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens, totalTokens, costUsd: null });
assert.deepEqual(sumUsage([usage(10, 2), usage(5, 1)]), { inputTokens: 15, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: 3, totalTokens: null, costUsd: null });
assert.equal(sumUsage([usage(10, 2), null]), null, "one unreported dispatch makes the sum unknown");

// CLI surface and matrix validation.
assert.equal(evalOptions([], {}).runs, 3);
assert.equal(evalOptions(["all", "1"], {}).runs, 1);
assert.throws(() => evalOptions(["all", "6"], {}), /runs must/);
assert.throws(() => evalOptions(["nope"], {}), /Unknown fixture/);
assert.equal(evalOptions(["strong-direct-fit,extraction-embedded-instruction"], {}).fixtures.length, 2);
assert.equal(evalOptions(["set:holdout-20261006"], {}).fixtures.length, 20, "a set filter selects the tagged holdout");
assert.throws(() => evalOptions(["set:nope"], {}), /Unknown fixture/);
for (const [label, pattern] of [
  ["an hourly contract rate", /per hour/],
  ["a GBP salary", /£/],
  ["a clearance condition", /clearance/],
  ["offered sponsorship", /sponsorship is available/i],
  ["an internship enrollment requirement", /enrollment/],
  ["a title-only incomplete posting", /No further details/]
]) {
  assert(fixtures.some((fixture) => fixture.set && pattern.test(fixture.jobText)), `the holdout covers ${label}`);
}
const [splitConfig] = configuredMatrix({ EVAL_MATRIX: JSON.stringify([{ provider: "openai", model: modelFor("openai"), fit: { provider: "anthropic", model: modelFor("anthropic") } }]) });
assert.equal(splitConfig.combined, false, "a differing Fit request is the split path");
assert.equal(configuredMatrix({ EVAL_MATRIX: JSON.stringify([{ provider: "openai", model: modelFor("openai") }]) })[0].combined, true, "a single request combines");
assert.throws(() => configuredMatrix({ EVAL_MATRIX: "[]" }), /at least one/);
assert.throws(() => configuredMatrix({ EVAL_MATRIX: JSON.stringify([{ provider: "nope" }]) }), /Unsupported eval provider/);
assert.throws(() => configuredMatrix({ EVAL_MATRIX: JSON.stringify([{ provider: "openai", model: modelFor("openai") }, { provider: "openai", model: modelFor("openai") }]) }), /twice/);

// End to end against a fake dispatcher: receipts, manifest, timing, usage, scores.
const fakeFit = (fixture) => fixture.expectedOutcomes?.[0] === "INSUFFICIENT_JOB_INFORMATION" || fixture.expectedVerdicts?.[0] === "INSUFFICIENT_JOB_INFORMATION"
  ? { status: "INSUFFICIENT_JOB_INFORMATION" }
  : {
      status: "ASSESSED", verdict: fixture.expectedVerdicts[0],
      matches: fixture.expectedVerdicts[0] === "LIMITED" ? [] : [{ jobExcerpt: fixture.jobText.slice(0, 40), candidateSource: "RESUME", candidateExcerpt: fixture.resumeText.slice(0, 40) }],
      gaps: fixture.expectedVerdicts[0] === "STRONG" ? [] : [{ jobExcerpt: fixture.jobText.slice(-40), status: "NOT_SHOWN", ...(fixture.expectedVerdicts[0] === "STRETCH" ? { relationship: "transferable", candidateSource: "RESUME", candidateExcerpt: fixture.resumeText.slice(-40) } : {}) }],
      // Eligibility excerpts must be exact source text, so copy them from the fixture.
      ...(fixture.allowedEligibility[0] === "BLOCKED" ? { eligibility: { status: "BLOCKED", jobExcerpt: excerptOf(fixture.jobText, /must be authorized to work[^.]*/), candidateExcerpt: excerptOf(fixture.candidateContext, /not currently authorized[^.]*/) } } : {}),
      ...(fixture.allowedEligibility[0] === "CHECK" ? { eligibility: { status: "CHECK", jobExcerpt: excerptOf(fixture.jobText, /authorized to work[^;.]*/) } } : {}),
      ...(fixture.allowedEligibility[0] === "CLEAR" && !fixture.allowedEligibility.includes("OMITTED") ? { eligibility: { status: "CLEAR", jobExcerpt: excerptOf(fixture.jobText, /(?:authorized to work|sponsorship)[^.]*/i), candidateExcerpt: excerptOf(fixture.candidateContext, /(?:authorized to work|sponsorship)[^.]*/i) } } : {})
    };
const excerptOf = (text, pattern) => (pattern.exec(text) ?? [""])[0];
// An any-of expectation is satisfied by its first option.
const pick = (term) => (Array.isArray(term) ? term[0] : term);
const preferredAlternative = (fixture, terms) => terms.every((term) => (fixture.expectedJob.preferredTerms ?? []).some((preferred) => JSON.stringify(preferred).includes(JSON.stringify(pick(term)).slice(1, -1))));
const fakeJob = (fixture) => ({
  title: pick(fixture.expectedJob.title ?? ""), company: fixture.expectedJob.company ?? "",
  location: fixture.expectedJob.location ?? "", jobType: fixture.expectedJob.jobType ?? "", ...(fixture.expectedJob.salary ?? {}),
  responsibilities: fixture.expectedJob.emptyLists ? [] : ["Do the work described in the posting"],
  // An alternative made only of preferred terms belongs in the preferred list.
  requiredQualifications: fixture.expectedJob.emptyLists ? [] : [...(fixture.expectedJob.requiredTerms ?? []).map((term) => pick(term).replace(/\*$/, "ing")), ...(fixture.expectedJob.alternatives ?? []).filter((terms) => !preferredAlternative(fixture, terms)).map((terms) => terms.map(pick).join(" or "))],
  preferredQualifications: [...(fixture.expectedJob.preferredTerms ?? []).map((term) => pick(term).replace(/\*$/, "s")), ...(fixture.expectedJob.alternatives ?? []).filter((terms) => preferredAlternative(fixture, terms)).map((terms) => terms.map(pick).join(" or "))],
  techKeywords: [], workAuth: (fixture.expectedJob.eligibilityTerms ?? []).map((term) => pick(term).replace(/\*$/, "ship")).join("; ")
});
let clock = 0;
const calls = [];
const fakeDispatch = async (args, stats) => {
  calls.push(args.provider);
  stats.attempts = 1;
  stats.usage = args.provider === "openai" ? { inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: null, outputTokens: 20, totalTokens: 120, costUsd: null } : null;
  clock += 10;
  const fixture = fixtures.find((candidate) => args.userPrompt.includes(candidate.jobText.slice(0, 60)));
  assert(fixture, "the fake dispatcher recognises the fixture from the prompt");
  const combined = /job-posting parser/.test(args.systemPrompt) && /Fit Assessment rules/.test(args.systemPrompt);
  if (combined) return { job: fakeJob(fixture), fitAssessment: fakeFit(fixture) };
  if (/job-posting parser/.test(args.systemPrompt)) return fakeJob(fixture);
  return fakeFit(fixture);
};
const outRoot = mkdtempSync(join(tmpdir(), "prepare-benchmark-contract-"));
const quiet = { log: console.log, error: console.error };
const logged = [];
const capture = () => { logged.length = 0; console.log = (line) => logged.push(String(line)); console.error = (line) => logged.push(String(line)); };
const release = () => { console.log = quiet.log; console.error = quiet.error; };
const MATRIX = JSON.stringify([
  { provider: "openai", model: modelFor("openai") },
  { provider: "openai", model: modelFor("openai"), fit: { provider: "anthropic", model: modelFor("anthropic") } }
]);
// API providers resolve only with a key; the fake dispatcher never uses it.
process.env.OPENAI_API_KEY = "synthetic-test-key";
process.env.ANTHROPIC_API_KEY = "synthetic-test-key";
let code;
try {
capture();
try {
  code = await main(["all", "1"], { EVAL_OUT_ROOT: outRoot, EVAL_MATRIX: MATRIX }, { dispatch: fakeDispatch, now: () => clock });
} finally {
  release();
}
assert.equal(code, 0, `the offline end-to-end run passes:\n${logged.filter((line) => !line.startsWith("{") && !line.startsWith("Completed")).join("\n")}`);
assert.equal(calls.length, fixtures.length * (2 + 2), "combined costs two calls per fixture run (prepare + standalone), split two (job + fit) with no duplicate standalone");
const [receiptDir] = readdirSync(outRoot);
const manifest = JSON.parse(readFileSync(join(outRoot, receiptDir, "manifest.json"), "utf8"));
assert.equal(manifest.configurations.length, 2);
assert.equal(manifest.configurations[1].combined, false);
assert.match(manifest.corpusHash, /^[0-9a-f]{64}$/);
assert.ok(Object.keys(manifest.sourceHashes).length >= 10, "the manifest hashes the prompt, sanitizer, and runner sources");
const summary = JSON.parse(readFileSync(join(outRoot, receiptDir, "summary.json"), "utf8"));
assert.equal(summary.failures.length, 0);
assert.equal(summary.configurations.length, 2);
assert.equal(summary.configurations[0].path, "combined");
assert.equal(summary.configurations[1].path, "split");
assert.equal(summary.configurations[0].calls, fixtures.length);
assert.equal(summary.configurations[1].calls, fixtures.length * 2);
assert.equal(summary.configurations[1].standaloneAutomationDiffers, null, "a split configuration has no standalone pairing");
assert.equal(summary.configurations[0].extractionScore, 1, "a faithful fake extraction scores 1 across the corpus");
assert.equal(summary.configurations[0].usage.inputTokens, 100 * fixtures.length, "API usage sums across the Prepare path");
assert.equal(summary.configurations[1].usage, null, "a split path with one unreporting provider has unknown usage");
assert.equal(summary.configurations[0].elapsedMs.n, fixtures.length);
assert.equal(summary.configurations[0].elapsedMs.median, 10);
assert.equal(summary.configurations[1].elapsedMs.median, 20, "the split path's time is the sum of its two calls");
assert.equal(summary.paired.length, fixtures.length, "only the combined configuration pairs with the standalone prompt");
assert.ok(summary.paired.every((row) => row.automationDiffers.length === 0));
const receipts = readdirSync(join(outRoot, receiptDir)).filter((name) => /-run-1\.json$/.test(name));
assert.equal(receipts.length, fixtures.length * 3, "one receipt per fixture and path: combined, standalone, split");
const sample = JSON.parse(readFileSync(join(outRoot, receiptDir, receipts.find((name) => name.includes("extraction-alternative-and-salary") && name.includes("combined"))), "utf8"));
assert.equal(sample.dispatches[0].role, "prepare");
assert.equal(typeof sample.dispatches[0].elapsedMs, "number");
assert.equal(sample.jobScore.score, 1);
assert.ok(!("apiKey" in sample.dispatches[0].request), "receipts carry no credentials");

// Report-only re-reads the same directory from its manifest, with no dispatch
// and without needing the matrix or runs again.
calls.length = 0;
const before = readdirSync(join(outRoot, receiptDir)).sort();
capture();
try {
  code = await main([], { EVAL_REPORT_ONLY: "1", EVAL_REPORT_DIR: join(outRoot, receiptDir) }, { dispatch: fakeDispatch });
} finally {
  release();
}
assert.equal(code, 0, `report-only passes from receipts:\n${logged.filter((line) => line.startsWith("FAIL")).join("\n")}`);
assert.equal(calls.length, 0, "report-only makes no provider call");
assert.deepEqual(readdirSync(join(outRoot, receiptDir)).sort(), before, "report-only writes nothing");

// A fabricating extractor fails the run, and nothing it says reaches the console.
const SENTINEL = "SENTINEL_LEAK_9c1f";
capture();
try {
  code = await main(["strong-direct-fit", "1"], { EVAL_OUT_ROOT: outRoot, EVAL_MATRIX: JSON.stringify([{ provider: "openai", model: modelFor("openai") }]) }, {
    dispatch: async (args, stats) => {
      stats.attempts = 1;
      const fixture = fixtures.find((candidate) => candidate.id === "strong-direct-fit");
      if (/job-posting parser/.test(args.systemPrompt)) return { job: { ...fakeJob(fixture), techKeywords: ["Kubernetes", SENTINEL] }, fitAssessment: fakeFit(fixture) };
      return fakeFit(fixture);
    }
  });
} finally {
  release();
}
assert.equal(code, 1, "an added requirement fails the run");
assert.ok(logged.some((line) => /never states/.test(line)), "the failure names the fabrication");
assert.ok(!logged.some((line) => line.includes(SENTINEL)), "extracted text never reaches the console");

// The first provider failure stops that configuration; the next still runs.
let dispatched = 0;
capture();
try {
  code = await main(["strong-direct-fit,reasonable-one-material-gap", "1"], { EVAL_OUT_ROOT: outRoot, EVAL_MATRIX: MATRIX }, {
    dispatch: async (args, stats) => {
      dispatched += 1;
      if (dispatched === 2) throw new Error("synthetic provider outage");
      return fakeDispatch(args, stats);
    }
  });
} finally {
  release();
}
assert.equal(code, 1);
assert.ok(logged.some((line) => line.startsWith("Stopped:")), "the stopped configuration is reported");
assert.ok(logged.some((line) => /\+ fit anthropic.*(combined|split)/.test(line)), "the second configuration still ran");
} finally {
  rmSync(outRoot, { recursive: true, force: true });
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

console.log("Prepare benchmark contracts passed: 22-fixture screen corpus plus 20-fixture holdout with extraction expectations, scoring rules, matrix validation, offline end-to-end receipts");
