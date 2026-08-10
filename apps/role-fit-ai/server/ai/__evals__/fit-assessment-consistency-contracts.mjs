// Offline contract for the synthetic live Fit Assessment calibration corpus. The
// live runner itself is excluded from npm test and must be invoked deliberately.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/fit-assessment-consistency.json", import.meta.url), "utf8")
);
const offlineGate = readFileSync(new URL("../../../offline-evals.test.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
const liveRunner = readFileSync(new URL("./fit-assessment-consistency-eval.mjs", import.meta.url), "utf8");

assert.equal(fixtures.length, 17, "the calibration corpus contains seventeen synthetic scenarios");
assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, fixtures.length, "fixture ids are unique");
assert.match(offlineGate, /"fit-assessment-consistency-eval\.mjs"/, "the live runner stays out of ordinary CI");
assert.equal(
  packageJson.scripts["eval:live:fit-assessment"],
  "node server/ai/__evals__/fit-assessment-consistency-eval.mjs",
  "the live runner has an explicit opt-in command"
);
assert.match(liveRunner, /RUNS < 3 \|\| RUNS > 5/, "the runner requires three to five repetitions");
assert.match(liveRunner, /EVAL_REPORT_ONLY/, "existing synthetic receipts can be re-reported without a provider call");
assert.match(liveRunner, /configUnavailable/, "a provider failure stops that configuration instead of repeating long timeouts");
assert.match(liveRunner, /Math\.ceil\(valid\.length \* 0\.8\)/, "clear fixtures must normally remain in their intended category");

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
  assert(Array.isArray(fixture.materialThemes) && fixture.materialThemes.length >= 2);
  assert(Array.isArray(fixture.expectedVerdicts) && fixture.expectedVerdicts.length >= 1);
  assert(Array.isArray(fixture.allowedEligibility) && fixture.allowedEligibility.length >= 1);
}

console.log("fit-assessment consistency contracts passed");
