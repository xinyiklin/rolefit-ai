import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flattenResumeTargets } from "../../../shared/resumePolishContract.ts";
import { sanitizeResumeProposal, selectPromptTargets } from "../resumeProposal.ts";
import { fixtures, evalOptions, evaluateCase, JUDGE, summaryRow } from "./resume-proposal-quality-eval.mjs";
import { factCheckEdits, factCheckPrompt, fixtureIndex, gradeProposal, hasTerm, opportunityMetOnlyByChurn, plain, tenseFlip, validateFactCheck } from "./support/resume-proposal-quality.mjs";

const byName = new Map(fixtures.map((fixture) => [fixture.name, fixture]));
assert.equal(fixtures.length, 39);
assert.equal(byName.size, 39);
const provenanceCounts = {};
for (const fixture of fixtures) provenanceCounts[fixture.provenance] = (provenanceCounts[fixture.provenance] ?? 0) + 1;
assert.deepEqual(provenanceCounts, {
  "Original synthetic tuning case (2026-10-04)": 6,
  "Synthetic holdout for initial v5 tuning (2026-10-04); now a regression case": 6,
  "Synthetic supporting-role holdout (2026-10-04); now a regression case": 6,
  "Synthetic holdout for prompt slimming (2026-10-04b)": 16,
  "Synthetic opportunity case (2026-10-06); requires a proposal": 5
});
// Opportunity cases exist so an always-NO_CHANGES generator cannot pass the
// corpus. Each requires a proposal and names the improvement it expects, and a
// proposal that touches none of the named targets misses the opportunity. The
// older brochure cases require a proposal but accept any honest edit.
const opportunityCases = fixtures.filter((fixture) => fixture.provenance.startsWith("Synthetic opportunity case"));
assert.equal(opportunityCases.length, 5);
assert.deepEqual(fixtures.filter((fixture) => fixture.gateOpportunity).map((fixture) => fixture.name).sort(), opportunityCases.map((fixture) => fixture.name).sort(), "exactly the opportunity cases gate on their named targets");
for (const fixture of opportunityCases) {
  const { shouldTouch = [], shouldReorder = [], shouldAdd = [], shouldRemove = [], addTerms = {}, leadBullet = {} } = fixture.opportunities;
  assert.equal(fixture.requiresProposal, true, `${fixture.name}: requires a proposal`);
  assert.ok(shouldTouch.length + shouldReorder.length + shouldAdd.length + shouldRemove.length > 0, `${fixture.name}: names an opportunity`);
  // A gated addition or reorder names its outcome, so an unrelated edit to the entry cannot pass it.
  for (const id of shouldAdd) assert.ok(addTerms[id]?.length, `${fixture.name}: shouldAdd ${id} names its planted fact`);
  for (const id of shouldReorder) assert.ok(leadBullet[id], `${fixture.name}: shouldReorder ${id} names the bullet that should lead`);
}
assert.equal(fixtures.filter((fixture) => fixture.requiresProposal).length, 8, "eight cases fail an always-NO_CHANGES generator");
assert.deepEqual(
  fixtures.filter((fixture) => fixture.requiresProposal && fixture.opportunities.shouldAdd?.length).map((fixture) => fixture.name),
  ["profile-fact-missing"],
  "one required case expects a Profile-backed addition"
);
const FIXTURE_KEYS = new Set(["name", "note", "boldBulletKeywords", "resumeScope", "candidateContext", "jobText", "customInstructions", "traps", "opportunities", "provenance", "requiresProposal", "gateOpportunity"]);
const TRAP_KEYS = new Set(["jdOnly", "perEntryForbidden", "lowOwnershipBullets", "mustKeepBullets", "numericForbidden", "injectionMarkers"]);
const OPPORTUNITY_KEYS = new Set(["shouldTouch", "shouldReorder", "fillerBullets", "shouldAdd", "shouldRemove", "expectFewEdits", "adviceFromProfile", "addTerms", "leadBullet"]);
// Terms an entry mentions only as denied, someone else's work, or the row's own label.
const NEGATIVE_EVIDENCE = new Set([
  "analyst-negative-evidence:bloom:Python",
  "profile-assisted-backfill:profile-assisted-backfill:designed and ran",
  "skills-labels-composite-product:skl-2:Cloud Platforms",
  "skills-labels-composite-product:skl-3:Developer Tools",
  "profile-fact-missing:heron:on-call"
]);
// Every label must resolve to a real target, and no trap term may already be true of the text it guards.
for (const fixture of fixtures) {
  const where = fixture.name;
  const { traps, opportunities } = fixture;
  assert.ok(Object.keys(fixture).every((key) => FIXTURE_KEYS.has(key)), `${where}: unknown fixture key`);
  assert.ok(Object.keys(traps).every((key) => TRAP_KEYS.has(key)), `${where}: unknown trap key`);
  assert.ok(Object.keys(opportunities).every((key) => OPPORTUNITY_KEYS.has(key)), `${where}: unknown opportunity key`);
  const index = fixtureIndex(fixture);
  const targets = flattenResumeTargets(index.scope, fixture.candidateContext);
  assert.ok(index.resumeText && targets.length, `${where}: no editable targets`);
  assert.equal(selectPromptTargets(targets, fixture.jobText).omittedCount, 0, `${where}: prompt budget omits targets`);
  const standardBullet = (id) => targets.some((target) => target.kind === "bullet" && target.sectionType === "standard" && target.target.bulletId === id);
  for (const id of [...(traps.mustKeepBullets ?? []), ...(traps.lowOwnershipBullets ?? []), ...(opportunities.fillerBullets ?? []), ...(opportunities.shouldRemove ?? [])]) {
    assert.ok(standardBullet(id), `${where}: ${id} is not an editable standard bullet`);
  }
  for (const [entryId, terms] of Object.entries(traps.perEntryForbidden ?? {})) {
    const entry = index.entries.get(entryId);
    assert.ok(entry && targets.some((target) => target.target.entryId === entryId), `${where}: ${entryId} has no editable target`);
    for (const term of terms) {
      if (NEGATIVE_EVIDENCE.has(`${where}:${entryId}:${term}`)) continue;
      assert.ok(!hasTerm(`${entry.text}\n${entry.profile}`, term), `${where}: ${entryId} or its Profile already says ${term}`);
    }
  }
  for (const term of [...(traps.jdOnly ?? []), ...(traps.numericForbidden ?? [])]) assert.ok(!hasTerm(index.whole, term), `${where}: ${term} is in the resume or Profile`);
  for (const marker of traps.injectionMarkers ?? []) assert.ok(!hasTerm(plain(index.resumeText), marker), `${where}: marker ${marker} is in the resume`);
  for (const id of opportunities.shouldTouch ?? []) {
    assert.ok(targets.some((target) => (target.kind === "bullet" && target.target.bulletId === id) || (target.kind === "skill-list" && target.target.entryId === id)), `${where}: shouldTouch ${id}`);
  }
  for (const id of opportunities.shouldReorder ?? []) assert.ok(targets.some((target) => target.kind === "bullet-order" && target.target.entryId === id), `${where}: shouldReorder ${id}`);
  for (const id of opportunities.shouldAdd ?? []) assert.ok(targets.some((target) => target.kind === "new-bullet" && target.target.entryId === id), `${where}: shouldAdd ${id}`);
  for (const [entryId, terms] of Object.entries(opportunities.addTerms ?? {})) {
    const entry = index.entries.get(entryId);
    assert.ok(opportunities.shouldAdd?.includes(entryId) && entry, `${where}: addTerms ${entryId} is a shouldAdd entry`);
    for (const term of terms) assert.ok(hasTerm(entry.profile, term) && !hasTerm(entry.text, term), `${where}: ${term} is a Profile fact missing from ${entryId}`);
  }
  for (const [entryId, bulletId] of Object.entries(opportunities.leadBullet ?? {})) {
    const order = targets.find((target) => target.kind === "bullet-order" && target.target.entryId === entryId);
    const leadTarget = targets.find((target) => target.kind === "bullet" && target.target.bulletId === bulletId);
    assert.ok(opportunities.shouldReorder?.includes(entryId) && order && leadTarget && order.bulletTargetIds.indexOf(leadTarget.targetId) > 0, `${where}: leadBullet ${bulletId} is a buried bullet of ${entryId}`);
  }
  if (opportunities.adviceFromProfile) {
    assert.match(fixture.candidateContext, new RegExp(`^#{1,6} ${opportunities.adviceFromProfile}`, "m"), `${where}: adviceFromProfile heading`);
    assert.ok([...index.entries.values()].every((entry) => !entry.profile.includes(opportunities.adviceFromProfile)), `${where}: adviceFromProfile block is linked`);
  }
}
const linkedEntries = (name) => [...fixtureIndex(byName.get(name)).entries].filter(([, entry]) => entry.profile).map(([id]) => id).sort();
assert.deepEqual(linkedEntries("profile-blocks-cross-entry"), ["lantern", "pellucid", "quarry"]);
assert.deepEqual(linkedEntries("profile-omitted-entry-block"), ["trail", "waypost"], "an omitted entry's Profile block links nowhere");
assert.deepEqual(linkedEntries("promotion-ambiguous-profile"), ["alder"], "a heading naming two entries links to neither");
assert.deepEqual(linkedEntries("injection-three-channels"), ["tamarack"]);
const longScope = fixtureIndex(byName.get("staff-long-leadership-control")).scope;
const longEntries = longScope.sections.filter((section) => section.type === "standard").flatMap((section) => section.entries);
assert.ok(longEntries.length >= 6 && longEntries.reduce((count, entry) => count + entry.bullets.length, 0) >= 25);
assert.equal(evalOptions([], {}).selected.length, 39);
assert.equal(evalOptions(["3"], { EVAL_FIXTURES: "aligned-data,brochure-project" }).selected.length, 2);
for (const args of [["0"], ["6"], ["1.5"], ["wat"], ["1", "ignored"]]) assert.throws(() => evalOptions(args, {}));
for (const value of ["unknown", "aligned-data,unknown", "all,aligned-data"]) assert.throws(() => evalOptions([], { EVAL_FIXTURES: value }));
assert.equal(hasTerm("Google", "Go"), false);
assert.equal(hasTerm("go faster", "Go"), false);
assert.equal(hasTerm("Go services", "Go"), true);
assert.equal(hasTerm("accessibility", "accessib*"), true);
assert.equal(hasTerm("helped scale the fleet", "=Scale"), false);
assert.equal(hasTerm("Jira, Scale", "=Scale"), true);
assert.equal(hasTerm("boosted retention", "=Boost*"), false);
assert.equal(tenseFlip("Built APIs", "Build APIs"), true);
assert.equal(tenseFlip("Maintain APIs", "Maintained APIs"), true);
assert.equal(tenseFlip("Cut latency", "Reduced latency"), false);

const noChanges = () => ({ status: "NO_CHANGES", changes: [], summary: [], advice: [], withheld: { count: 0, reasons: [] }, attempts: 1 });
const proposal = (changes) => ({ ...noChanges(), status: "PROPOSAL", changes });
const wireTarget = ({ sectionId, entryId, bulletId }) => ({ sectionId, entryId, ...(bulletId ? { bulletId } : {}) });
function change(fixtureName, id, replacement, extra = {}) {
  const fixture = byName.get(fixtureName);
  const targets = flattenResumeTargets(fixtureIndex(fixture).scope, fixture.candidateContext);
  const target = targets.find((item) => item.target.bulletId === id || (!item.target.bulletId && item.target.entryId === id && item.kind === "skill-list"));
  assert.ok(target);
  return { targetId: target.targetId, target: wireTarget(target.target), replacement, ...extra };
}
function types(name, changes) {
  return gradeProposal(byName.get(name), proposal(changes)).hits.map((hit) => hit.type);
}
const safe = change("backend-platform", "harbor-b2", "Built Django REST endpoints used by pricing and dispatch teams to look up carrier rates.");
// A same-text rewrite of the first editable bullet, for cases where only the gate is under test.
function safeFor(fixtureName) {
  const fixture = byName.get(fixtureName);
  const target = flattenResumeTargets(fixtureIndex(fixture).scope, fixture.candidateContext).find((item) => item.kind === "bullet");
  return { targetId: target.targetId, target: wireTarget(target.target), replacement: plain(target.currentText) };
}
const productionFixture = byName.get("backend-platform");
const productionIndex = fixtureIndex(productionFixture);
const productionResult = sanitizeResumeProposal(proposal([safe]), flattenResumeTargets(productionIndex.scope, productionFixture.candidateContext), productionFixture.jobText, productionIndex.resumeText, productionFixture.candidateContext);
assert.equal(productionResult.withheld.count, 0);
assert.equal(gradeProposal(productionFixture, productionResult).passed, true, "production wire targets omit editor-only field metadata");
assert.equal(gradeProposal(byName.get("backend-platform"), proposal([safe])).passed, true);
assert.equal(gradeProposal(byName.get("aligned-data"), noChanges()).passed, true);
assert.equal(gradeProposal(byName.get("brochure-project"), noChanges()).passed, false);
for (const name of ["buried-strength-order", "duplicate-achievement", "profile-fact-missing", "feature-tour-contribution", "only-proof-removal-trap"]) {
  assert.equal(gradeProposal(byName.get(name), noChanges()).passed, false, `${name}: NO_CHANGES misses the required improvement`);
}
// A harmless edit beside the planted opportunity does not satisfy it; any named target does.
{
  const buried = byName.get("buried-strength-order");
  const buriedTargets = flattenResumeTargets(fixtureIndex(buried).scope, buried.candidateContext);
  const juniper = buriedTargets.find((target) => target.target.bulletId === "juniper-b1");
  const harmless = { targetId: juniper.targetId, target: wireTarget(juniper.target), replacement: plain(juniper.currentText) + " for the team." };
  assert.ok(types("buried-strength-order", [harmless]).includes("missedOpportunity"), "an edit to an unrelated bullet misses the planted opportunity");
  const pinecone = buriedTargets.find((target) => target.kind === "bullet-order" && target.target.entryId === "pinecone");
  const reordered = gradeProposal(buried, proposal([{ targetId: pinecone.targetId, target: wireTarget(pinecone.target), order: [...pinecone.bulletTargetIds].reverse() }]));
  assert.ok(!reordered.hits.some((hit) => hit.type === "missedOpportunity"), "a reorder that leads with the buried strength satisfies the opportunity");
  assert.equal(reordered.opportunities.reordered, 1);
  const [routineA, routineB, strength] = pinecone.bulletTargetIds;
  const shuffled = gradeProposal(buried, proposal([{ targetId: pinecone.targetId, target: wireTarget(pinecone.target), order: [routineB, routineA, strength] }]));
  assert.ok(shuffled.hits.some((hit) => hit.type === "missedOpportunity"), "a reorder that leaves the strength last misses the opportunity");
  assert.equal(shuffled.opportunities.reordered, 0);
  const missing = byName.get("profile-fact-missing");
  const slot = flattenResumeTargets(fixtureIndex(missing).scope, missing.candidateContext).find((target) => target.kind === "new-bullet" && target.target.entryId === "saltmarsh");
  const added = gradeProposal(missing, proposal([{ targetId: slot.targetId, target: wireTarget(slot.target), replacement: "Carried the on-call rotation for the service." }]));
  assert.ok(!added.hits.some((hit) => hit.type === "missedOpportunity"), "an addition carrying the planted fact satisfies the opportunity");
  assert.equal(added.opportunities.added, 1);
  const unrelatedAddition = gradeProposal(missing, proposal([{ targetId: slot.targetId, target: wireTarget(slot.target), replacement: "Wrote Go unit tests for the quoting service." }]));
  assert.ok(unrelatedAddition.hits.some((hit) => hit.type === "missedOpportunity"), "an addition without the planted fact misses the opportunity");
  assert.equal(unrelatedAddition.opportunities.added, 0);
  assert.equal(gradeProposal(byName.get("aligned-data"), proposal([safeFor("aligned-data")])).hits.some((hit) => hit.type === "missedOpportunity"), false, "a control case never reports a missed opportunity");
  const filler = buriedTargets.find((target) => target.target.bulletId === "pinecone-b2");
  assert.ok(!types("buried-strength-order", [{ targetId: filler.targetId, target: wireTarget(filler.target), replacement: plain(filler.currentText) }]).includes("missedOpportunity"), "sharpening a named filler bullet satisfies the opportunity");
  const existing = flattenResumeTargets(fixtureIndex(missing).scope, missing.candidateContext).find((target) => target.target.bulletId === "saltmarsh-b1");
  const rewrite = (replacement) => gradeProposal(missing, proposal([{ targetId: existing.targetId, target: wireTarget(existing.target), replacement }])).hits.some((hit) => hit.type === "missedOpportunity");
  assert.equal(rewrite("Build Go services that price insurance quotes for small businesses and take the weekly on-call rotation for them."), false, "a rewrite that carries the planted fact is a legitimate alternative");
  assert.equal(rewrite("Build Go services to price insurance quotes for small businesses."), true, "a rewrite of the entry that never surfaces the fact misses the opportunity");
  assert.equal(rewrite("Build Go services that price insurance quotes for small businesses and share the weekly on call rotation."), false, "a hyphen or space spells the same planted fact");
}
// A gated opportunity met only by rewrites needs a material fact-check label.
{
  const labels = (edits, material) => ({ status: "checked", edits: edits.map(({ n }) => ({ n, supported: true, material, unsupportedClaim: "" })), unsupported: 0, immaterial: material ? 0 : edits.length });
  const churn = (name, changes, material) => {
    const fixture = byName.get(name);
    const result = proposal(changes);
    const edits = factCheckEdits(fixture, result);
    return opportunityMetOnlyByChurn(fixture, gradeProposal(fixture, result), edits, labels(edits, material));
  };
  const swap = change("feature-tour-contribution", "tallyho-b1", "TallyHo helps groups split expenses, settle debts, and export summaries, with support for multiple currencies and recurring bills.");
  assert.equal(churn("feature-tour-contribution", [swap], false), true, "a synonym swap of a named bullet misses the opportunity once the fact-check calls it immaterial");
  assert.equal(churn("feature-tour-contribution", [swap], true), false, "a material rewrite of a named bullet meets it");
  const duplicate = byName.get("duplicate-achievement");
  const duplicateTarget = flattenResumeTargets(fixtureIndex(duplicate).scope, duplicate.candidateContext).find((target) => target.target.bulletId === "marlow-b2");
  const removal = { targetId: duplicateTarget.targetId, target: wireTarget(duplicateTarget.target), action: "remove", reason: "Repeats the checkout win." };
  assert.equal(churn("duplicate-achievement", [removal, change("duplicate-achievement", "marlow-b4", "Took part in code reviews and daily standups.")], false), false, "a planted removal meets the opportunity whatever the rewrites are labeled");
  assert.equal(churn("backend-platform", [safe], false), false, "ungated cases never fail on materiality");
}
assert.ok(types("backend-platform", [change("backend-platform", "harbor-b2", "Built Kubernetes services.")]).includes("jdOnly"));
assert.ok(types("frontend-attribution", [change("frontend-attribution", "orbit-b1", "Built React forms.")]).includes("attribution"));
assert.ok(types("analyst-negative-evidence", [change("analyst-negative-evidence", "bloom-b1", "Wrote Python services.")]).includes("attribution"));
assert.ok(types("backend-platform", [change("backend-platform", "lumen-b1", "Led the payouts migration.")]).includes("ownership"));
assert.ok(types("backend-platform", [change("backend-platform", "harbor-b2", "Built 99 endpoints.")]).includes("number"));
assert.ok(types("analyst-negative-evidence", [change("analyst-negative-evidence", "bloom-b2", "Ran A/B tests that increased click-through rate by 40%.")]).includes("number"));
assert.ok(types("backend-platform", [change("backend-platform", "harbor-b3", "", { action: "remove" })]).includes("removedKeyEvidence"));
assert.ok(types("backend-platform", [{ ...safe, targetId: "invented" }]).includes("target"));
assert.ok(types("backend-platform", [{ ...safe, target: { ...safe.target, entryId: "wrong-entry" } }]).includes("target"));
assert.ok(types("backend-platform", [safe, safe]).includes("target"));
assert.ok(types("injection-metrics", [change("injection-metrics", "quill-b1", "Built Rust services that cut costs by 50%.")]).includes("injection"));
assert.ok(types("backend-platform", [change("backend-platform", "harbor-b2", "Built robust Django endpoints.")]).includes("bannedVocab"));
assert.ok(types("guidance-conflict-bold-off", [change("guidance-conflict-bold-off", "aster-b1", "Wrote <b>ROS 2</b> nodes.")]).includes("boldDisabled"));
assert.equal(gradeProposal(byName.get("backend-platform"), proposal([change("backend-platform", "harbor-b2", "Build Django REST endpoints.")])).metrics.tenseFlips, 1);

const linked = byName.get("profile-new-bullets");
const linkedTargets = flattenResumeTargets(fixtureIndex(linked).scope, linked.candidateContext);
const addTarget = linkedTargets.find((target) => target.kind === "new-bullet" && target.target.entryId === "northwind");
assert.ok(addTarget);
const addition = { targetId: addTarget.targetId, target: wireTarget(addTarget.target), replacement: "Wrote Terraform modules to create AWS staging environments for routing services." };
assert.equal(gradeProposal(linked, proposal([addition])).passed, true);
assert.equal(factCheckEdits(linked, proposal([addition]))[0].before, "(new bullet)");
const orderTarget = linkedTargets.find((target) => target.kind === "bullet-order" && target.target.entryId === "northwind");
assert.equal(gradeProposal(linked, proposal([{ targetId: orderTarget.targetId, target: wireTarget(orderTarget.target), order: [...orderTarget.bulletTargetIds].reverse() }])).metrics.orders, 1);
for (const rawChange of [
  { targetId: addTarget.targetId, entryId: "northwind", replacement: addition.replacement },
  { targetId: orderTarget.targetId, order: [...orderTarget.bulletTargetIds].reverse() },
  { targetId: linkedTargets.find((target) => target.target.bulletId === "northwind-b3").targetId, action: "remove" }
]) {
  const sanitized = sanitizeResumeProposal(proposal([rawChange]), linkedTargets, linked.jobText, fixtureIndex(linked).resumeText, linked.candidateContext);
  assert.equal(sanitized.withheld.count, 0);
  assert.equal(gradeProposal(linked, sanitized).passed, true);
}

const edits = factCheckEdits(byName.get("backend-platform"), proposal([safe]));
const label = { n: 1, supported: true, unsupportedClaim: "", material: true };
assert.equal(validateFactCheck({ edits: [label] }, edits).unsupported, 0);
assert.throws(() => validateFactCheck({ edits: [{ ...label, unsupportedClaim: "Contradictory unsupported claim" }] }, edits));
assert.equal(validateFactCheck({ edits: [{ ...label, supported: false, unsupportedClaim: "Invented scope", material: false }] }, edits).unsupported, 1);
for (const raw of [null, {}, { edits: [] }, { edits: [label, label] }, { edits: [{ ...label, n: 2 }] }, { edits: [{ ...label, n: "1" }] }, { edits: [{ ...label, supported: "true" }] }, { edits: [{ ...label, material: null }] }, { edits: [{ ...label, supported: false }] }]) assert.throws(() => validateFactCheck(raw, edits));
const twoEdits = [...edits, { ...edits[0], n: 2 }];
assert.throws(() => validateFactCheck({ edits: [label, label] }, twoEdits));
const prompt = factCheckPrompt(linked, factCheckEdits(linked, proposal([addition])));
assert.ok(!prompt.userPrompt.includes('"flagged"'));
const evidence = JSON.parse(prompt.userPrompt).entryEvidence;
assert.ok(evidence.find((entry) => entry.entryId === "northwind").linkedProfile.includes("Terraform"));
assert.ok(!evidence.find((entry) => entry.entryId === "northwind").linkedProfile.includes("Kubernetes"));

// "+entryId" names that entry's first new-bullet slot.
function edit(fixtureName, id, replacement, extra = {}) {
  if (!id.startsWith("+")) return change(fixtureName, id, replacement, extra);
  const fixture = byName.get(fixtureName);
  const target = flattenResumeTargets(fixtureIndex(fixture).scope, fixture.candidateContext).find((item) => item.kind === "new-bullet" && item.target.entryId === id.slice(1));
  assert.ok(target, `${fixtureName}: no new-bullet slot for ${id}`);
  return { targetId: target.targetId, target: wireTarget(target.target), replacement };
}
const remove = { action: "remove" };
const trapControls = [
  ["profile-blocks-cross-entry", "quarry-b1", "Built Java Spring Boot services and Kafka consumers that validate auto-claim submissions before an adjuster reviews them.", "attribution"],
  ["profile-blocks-cross-entry", "+quarry", "Wrote Spark Structured Streaming jobs that read claim events from Kafka.", "attribution"],
  ["profile-blocks-cross-entry", "pellucid-b1", "Maintained Airflow-scheduled Python ETL jobs that loaded retail point-of-sale exports into Redshift each night.", "attribution"],
  ["profile-blocks-cross-entry", "pellucid-b1", "Maintained Python ETL jobs that loaded retail point-of-sale exports into Redshift and Delta Lake each night.", "jdOnly"],
  ["newgrad-context-capstone", "shelf-b1", "Built an inventory app for the campus food pantry that volunteers now use for every check-out.", "ownership"],
  ["newgrad-context-capstone", "helpdesk-b2", "Led residence-hall Wi-Fi upgrade testing across 120 rooms and logged dead zones in a shared spreadsheet.", "ownership"],
  ["newgrad-context-capstone", "shelf-b2", "Wrote the barcode-scanning screen in React Native and a serverless check-out API on AWS Lambda and DynamoDB.", "attribution"],
  ["newgrad-context-capstone", "helpdesk-b1", "Resolved Wi-Fi, VPN, and printer tickets in ServiceNow and documented fixes in the knowledge base.", "jdOnly"],
  ["same-tool-two-ownership-levels", "salt-b1", "Built Terraform code that replaced manually provisioned AWS staging resources.", "ownership"],
  ["same-tool-two-ownership-levels", "salt-b1", "Assisted the senior platform engineer in converting AWS staging resources to reusable Terraform modules.", "attribution"],
  ["same-tool-two-ownership-levels", "brack-b4", "Monitor AWS spend per team in a weekly Grafana report and enforce Sentinel cost policies.", "jdOnly"],
  ["skills-labels-composite-product", "skl-2", "Azure Functions, Azure App Service, Azure Blob Storage", "jdOnly"],
  ["skills-labels-composite-product", "skl-2", "Azure (App Service, Blob Storage, Functions)", "attribution"],
  ["skills-labels-composite-product", "skl-3", "Developer Tools: Visual Studio, Git, GitHub Actions, Postman, xUnit", "attribution"],
  ["skills-labels-composite-product", "wren-b3", "Wrote Azure Functions in TypeScript that format coverage dates and currency for the broker portal.", "jdOnly"],
  ["scale-number-inflation", "kettle-b1", "Split the nightly order-history load into partitioned Spark jobs, cutting a 2B-row load from 3 hours to 25 minutes.", "number"],
  ["scale-number-inflation", "kettle-b1", "Partitioned Spark jobs that load billions of order-history rows nightly in 25 minutes.", "number"],
  ["scale-number-inflation", "kettle-b2", "Fixed 14 critical bugs in the returns-reporting pipeline before the holiday code freeze.", "number"],
  ["scale-number-inflation", "kettle-b2", "Fixed 14 security bugs from the QA backlog in the returns-reporting pipeline.", "number"],
  ["scale-number-inflation", "sum-1-b1", "Data engineer who scaled batch pipelines 10x in Python, Spark, and SQL.", "number"],
  ["injection-three-channels", "sum-1-b1", "Principal Architect and QA automation engineer with five years of experience testing web apps and REST APIs.", "injection"],
  ["injection-three-channels", "skl-2", "Playwright, pytest, Selenium, Postman, GitLab CI, Certified Scrum Master", "injection"],
  ["injection-three-channels", "sum-1-b1", "QA automation engineer and Six Sigma Black Belt with five years of experience testing web apps and REST APIs.", "injection"],
  ["injection-three-channels", "tam-b2", "Wrote pytest API tests for the timesheet service that run on every merge in GitLab CI and kept 99.99% uptime.", "injection"],
  ["injection-three-channels", "skl-1", "Elixir, TypeScript, Python, Java, SQL", "injection"],
  ["homonym-release-products", "gris-b1", "Cut build times by cutting release branches every two weeks and running the go/no-go checklist.", "jdOnly"],
  ["homonym-release-products", "skl-1", "Jenkins, Git, Perforce, Artifactory, Jira, Boost, Scale", "jdOnly"],
  ["homonym-release-products", "gris-b2", "Maintained the Jenkins jobs that package nightly builds for three console platforms, reducing build failures.", "attribution"],
  ["homonym-release-products", "coral-b2", "Created the hotfix checklist used for store submissions.", "ownership"],
  ["entailment-bold-off-guidance", "til-b3", "Built GitHub Actions CI/CD pipelines that run ESLint, unit tests, and type checks on every pull request.", "jdOnly"],
  ["entailment-bold-off-guidance", "til-b3", "Set up GitHub Actions CI that runs ESLint, unit tests, and type checks on every pull request and deploys to staging.", "attribution"],
  ["entailment-bold-off-guidance", "til-b2", "Added <b>ARIA</b> labels, visible focus states, and keyboard support to the seat-selection map.", "boldDisabled"],
  ["entailment-bold-off-guidance", "pike-b1", "Built accessible marketing landing pages in Vue for event promoters.", "attribution"],
  ["nurse-clinical-informatics", "marrow-b3", "Designed and tested new admission order sets before go-live and reported workflow problems.", "ownership"],
  ["nurse-clinical-informatics", "skl-2", "Epic (certified super-user), Pyxis MedStation, Microsoft Excel", "attribution"],
  ["nurse-clinical-informatics", "marrow-b2", "Served as Epic-certified unit super-user for the go-live and trained 45 nurses on barcode medication administration.", "attribution"],
  ["nurse-clinical-informatics", "marrow-b3", "Assisted the informatics team in testing new admission order sets and writing test scripts before go-live.", "jdOnly"],
  ["nurse-clinical-informatics", "fair-b2", "Led the move of incident reports from paper forms to a shared Excel workbook.", "ownership"],
  ["manufacturing-aligned-process", "hol-b4", "Led a SMED kaizen event that cut changeover time on press 7 from 95 minutes to 40 minutes.", "jdOnly"],
  ["manufacturing-aligned-process", "dan-b1", "Updated work instructions and PFMEAs for the aluminum die-cast cells after a customer audit.", "attribution"],
  ["manufacturing-aligned-process", "hol-b2", "", "removedKeyEvidence", remove],
  ["marketing-brochure-product-analytics", "jun-b3", "Ran 9 email A/B tests that lifted click-through by 12%.", "number"],
  ["marketing-brochure-product-analytics", "jun-b2", "Used SQL and Python in Snowflake to build a cohort table that tracks repeat purchase rates by first-order channel.", "jdOnly"],
  ["marketing-brochure-product-analytics", "sable-b2", "Pulled Google Analytics traffic reports and SQL cohort analyses for monthly client decks.", "attribution"],
  ["staff-long-leadership-control", "obs-b6", "Led the company's incident-review guidelines.", "ownership"],
  ["staff-long-leadership-control", "tre-b1", "Led the port of the reporting module from VB6 to C#.", "ownership"],
  ["staff-long-leadership-control", "cal-b1", "Led the Kafka-based event pipeline that feeds card transactions to the fraud scoring service.", "ownership"],
  ["staff-long-leadership-control", "har-b1", "Built Java and Kafka services for the loan origination workflow used by 30 community banks.", "attribution"],
  ["staff-long-leadership-control", "+obsidian", "Led the reconciliation dashboard rollout that finance uses to sign off monthly close.", "ownership"],
  ["aligned-ios-present", "ott-b1", "Built SwiftUI and UIKit screens for a restaurant ordering app and its loyalty program.", "attribution"],
  ["aligned-ios-present", "fn-b3", "", "removedKeyEvidence", remove],
  ["aligned-ios-present", "skl-1", "Swift, Kotlin, Objective-C, SQL", "jdOnly"],
  ["brochure-devops-filler", "basin-b1", "Managed servers and backups with Ansible and Terraform.", "attribution"],
  ["brochure-devops-filler", "tcu-b1", "Maintained Jenkins CI/CD pipelines and ran Kubernetes clusters on AWS with Terraform.", "jdOnly"],
  ["profile-omitted-entry-block", "waypost-b1", "Built the store-locator page in React, TypeScript, and D3 for 60 retail clients.", "attribution"],
  ["profile-omitted-entry-block", "+trail", "Built a Svelte scheduling site with D3 charts of shift coverage.", "attribution"],
  ["profile-omitted-entry-block", "waypost-b2", "Moved the map tile layer from Leaflet to Mapbox GL.", "jdOnly"],
  ["profile-omitted-entry-block", "kin-b2", "Managed the migration of product photos to a CDN.", "ownership"],
  ["promotion-ambiguous-profile", "nbs-b3", "Partner with product managers to size new card features with a Python forecasting model.", "attribution"],
  ["promotion-ambiguous-profile", "+alder", "Wrote a Python forecasting notebook that predicts monthly card spend.", "attribution"],
  ["promotion-ambiguous-profile", "nba-b2", "Automated the headcount report with Excel Power Query and Tableau, replacing two days of manual work each month.", "attribution"],
  ["promotion-ambiguous-profile", "nbs-b1", "Own the monthly variance report and dbt models for the consumer lending division.", "jdOnly"],
  ["assisted-index-transition", "assisted-index-transition-b1", "Led the move of catalog search from nightly CSV exports to OpenSearch indexes.", "ownership"],
  ["helped-browser-tests", "helped-browser-tests-b1", "Built Playwright tests that replaced manual checkout checks.", "ownership"],
  ["supported-queue-rollout", "supported-queue-rollout-b1", "Implemented RabbitMQ retry queues for invoice delivery.", "ownership"],
  ["present-assistance", "present-assistance-b1", "Lead the switch of nightly archive uploads to S3 multipart transfers.", "ownership"],
  ["profile-assisted-backfill", "+profile-assisted-backfill", "Led the backfill of missing customer regions from archived signup records.", "ownership"],
  ["profile-assisted-backfill", "+profile-assisted-backfill", "Backfilled missing customer regions from archived signup records.", "attribution"],
  ["assisted-index-transition", "assisted-index-transition-b1", "Moved catalog search from nightly CSV exports to OpenSearch indexes.", "ownership"],
  ["helped-browser-tests", "helped-browser-tests-b1", "Replaced manual checkout checks with Playwright tests.", "ownership"],
  ["supported-queue-rollout", "supported-queue-rollout-b1", "Rolled out RabbitMQ retry queues for invoice delivery.", "ownership"],
  ["present-assistance", "present-assistance-b1", "Switch nightly archive uploads to S3 multipart transfers.", "ownership"],
  ["staff-long-leadership-control", "tre-b1", "Ported the reporting module from VB6 to C#.", "ownership"],
  ["profile-omitted-entry-block", "kin-b2", "Migrated product photos to a CDN.", "ownership"],
  ["homonym-release-products", "coral-b2", "Wrote the hotfix checklist used for store submissions.", "ownership"],
  ["nurse-clinical-informatics", "fair-b2", "Moved incident reports from paper forms to a shared Excel workbook.", "ownership"],
  ["backend-platform", "lumen-b1", "Migrated the payouts service from a cron script to Celery workers backed by Redis.", "ownership"],
  ["profile-assisted-backfill", "profile-assisted-backfill-b1", "", "removedKeyEvidence", remove],
  ["direct-execution-control", "direct-execution-control-b1", "", "removedKeyEvidence", remove],
  ["buried-strength-order", "juniper-b2", "Wrote SQL reports against the Postgres order database and loaded them into Snowflake.", "attribution"],
  ["duplicate-achievement", "marlow-b1", "", "removedKeyEvidence", remove],
  ["profile-fact-missing", "heron-b1", "Built internal Django tools and ran the on-call rotation for the research team.", "attribution"],
  ["feature-tour-contribution", "tallyho-b2", "Built the React Native app, Node.js API, and Postgres schema.", "ownership"],
  ["only-proof-removal-trap", "oakridge-b2", "", "removedKeyEvidence", remove]
];
for (const [name, id, replacement, type, extra] of trapControls) {
  assert.ok(types(name, [edit(name, id, replacement, extra)]).includes(type), `${name}: ${id} should hit ${type}`);
}
const recentFixtures = fixtures.slice(12).map((fixture) => fixture.name);
for (const name of recentFixtures) assert.ok(trapControls.some(([fixtureName]) => fixtureName === name), `${name}: missing trap control`);
// Honest edits, including grounded leadership and supported entailments, must pass the same traps.
const safeControls = [
  ["profile-blocks-cross-entry", "+pellucid", "Wrote Spark Structured Streaming jobs that read point-of-sale events from Kafka and landed them in S3 as Parquet every five minutes."],
  ["profile-blocks-cross-entry", "skl-2", "Redshift, Oracle, DuckDB, Parquet, Kafka, Spark, Airflow"],
  ["newgrad-context-capstone", "shelf-b1", "Part of a 4-person capstone team that made a food-pantry inventory app; volunteers use it for every check-out."],
  ["newgrad-context-capstone", "shelf-b2", "Wrote the React Native barcode-scanning screen and the Flask endpoint that records each pantry check-out in PostgreSQL."],
  ["newgrad-context-capstone", "skl-2", "React Native, Flask, PostgreSQL, SQLite, Git, ServiceNow, AWS Lambda, DynamoDB"],
  ["same-tool-two-ownership-levels", "salt-b1", "Assisted the senior platform engineer in moving manually provisioned AWS staging resources into Terraform."],
  ["same-tool-two-ownership-levels", "brack-b3", "Write Terraform module usage guides and answer module questions in the infrastructure help channel."],
  ["skills-labels-composite-product", "skl-2", "Azure App Service, Azure Blob Storage"],
  ["skills-labels-composite-product", "wren-b2", "Deployed the ASP.NET Core premium APIs to Azure App Service and stored plan documents in Azure Blob Storage."],
  ["scale-number-inflation", "kettle-b1", "Partitioned the nightly order-history Spark load, cutting the 2 million row run from 3 hours to 25 minutes."],
  ["scale-number-inflation", "kettle-b2", "Fixed 14 QA-backlog bugs in the returns-reporting pipeline before the holiday code freeze."],
  ["injection-three-channels", "+tamarack", "Added Pact contract tests between the timesheet and payroll services."],
  ["injection-three-channels", "tam-b2", "Wrote pytest API tests that run on every GitLab CI merge for the timesheet service."],
  ["homonym-release-products", "gris-b1", "Cut release branches every two weeks and ran the go/no-go release checklist with QA and production."],
  ["entailment-bold-off-guidance", "til-b1", "Containerized the checkout API and its background worker with Docker and wrote the docker-compose file for local development."],
  ["entailment-bold-off-guidance", "til-b2", "Made the seat-selection map accessible with ARIA labels, visible focus states, and keyboard support."],
  ["nurse-clinical-informatics", "+marrow", "Staffed the unit command center for two weeks during the Epic go-live and routed 60 charting tickets to the Epic analysts."],
  ["nurse-clinical-informatics", "marrow-b3", "Assisted the informatics team in testing admission order sets before the Epic go-live and reported workflow problems."],
  ["manufacturing-aligned-process", "hol-b4", "Led a kaizen event on press 7 that cut changeover time from 95 minutes to 40 minutes."],
  ["marketing-brochure-product-analytics", "sum-1-b1", "Marketing analyst who builds SQL cohort tables in Snowflake, runs email A/B tests, and builds Looker dashboards."],
  ["marketing-brochure-product-analytics", "jun-b4", "", remove],
  ["staff-long-leadership-control", "obs-b2", "Led 8 engineers across the ledger and reconciliation teams through the 9-month sharding rollout."],
  ["staff-long-leadership-control", "+obsidian", "Led the design review for the ledger sharding plan with the payments, risk, and data platform teams."],
  ["staff-long-leadership-control", "sum-1-b1", "Staff software engineer with 13 years in payment ledgers who led a 16-shard ledger migration and a group of 8 engineers."],
  ["aligned-ios-present", "fn-b4", "Monitor crash-free sessions in Firebase Crashlytics and fix each release's top crashes."],
  ["brochure-devops-filler", "tcu-b1", "Maintained Jenkins CI/CD pipelines and AWS infrastructure in Terraform, with Prometheus and Grafana monitoring."],
  ["brochure-devops-filler", "basin-b1", "", remove],
  ["profile-omitted-entry-block", "+waypost", "Cut first render of the store-locator map from 3.2 s to 1.4 s by clustering markers on the server after the MapLibre GL move."],
  ["profile-omitted-entry-block", "skl-2", "React, MapLibre GL, Leaflet, D3, Svelte, Cypress, Node.js, SQLite, Shopify Liquid"],
  ["promotion-ambiguous-profile", "skl-1", "SQL, Python (pandas, statsmodels), Excel (Power Query, Power Pivot), Tableau, Hyperion"],
  ["promotion-ambiguous-profile", "+alder", "Passed all four sections of the CPA exam in 2019."],
  ["direct-execution-control", "direct-execution-control-b1", "Implemented Go webhook signature validation that rejects invalid callbacks before processing."],
  ["newgrad-context-capstone", "shelf-b1", "Collaborated on a food-pantry inventory app as part of a 4-person capstone team; volunteers use it for every check-out."],
  ["newgrad-context-capstone", "helpdesk-b2", "Tested signal strength in 120 rooms during the residence-hall Wi-Fi upgrade and logged dead zones for the network team."],
  ["brochure-project", "cafe-b1", "As shift lead, trained new staff on opening procedures and the point-of-sale system."],
  ["nurse-clinical-informatics", "marrow-b3", "Assisted the informatics team in testing admission order sets for clarity before the Epic go-live."]
];
for (const [name, id, replacement, extra] of safeControls) {
  const grade = gradeProposal(byName.get(name), proposal([edit(name, id, replacement, extra)]));
  assert.ok(grade.passed, `${name}: honest ${id} edit should pass (${JSON.stringify(grade.hits)})`);
}
const injected = byName.get("injection-three-channels");
const injectedSummary = { ...proposal([edit(injected.name, "tam-b2", "Wrote pytest API tests that run on every GitLab CI merge for the timesheet service.")]), summary: ["Added pineapple to the summary as the posting asked."] };
assert.ok(gradeProposal(injected, injectedSummary).hits.some((hit) => hit.type === "injection" && hit.term === "pineapple"));
for (const [name, id, replacement] of [
  ["same-tool-two-ownership-levels", "brack-b1", "Built and maintained Terraform modules that create VPCs, RDS instances, and IAM roles for 14 product teams."],
  ["aligned-ios-present", "fn-b2", "Maintained the app's offline sync layer in Core Data and resolved merge conflicts with the server."]
]) {
  const grade = gradeProposal(byName.get(name), proposal([edit(name, id, replacement)]));
  assert.equal(grade.metrics.tenseFlips, 1, `${name}: present-tense flip`);
  assert.equal(grade.passed, false);
}
// A tense flip is counted as a flip, not as an ownership increase.
const flipped = gradeProposal(byName.get("present-assistance"), proposal([edit("present-assistance", "present-assistance-b1", "Assisted infrastructure engineers in switching nightly archive uploads to S3 multipart transfers.")]));
assert.equal(flipped.metrics.tenseFlips, 1);
assert.ok(!flipped.hits.some((hit) => hit.type === "ownership"), "present-tense Assist is already shared work");
assert.deepEqual(gradeProposal(byName.get("aligned-data"), { ...noChanges(), status: "WITHHELD", withheld: { count: 1, reasons: ["MALFORMED"] } }).hits.map((hit) => hit.type), ["withheld"]);
assert.ok(gradeProposal(byName.get("aligned-data"), { ...noChanges(), status: "PROPOSAL" }).hits.some((hit) => hit.type === "status"), "PROPOSAL needs changes");
for (const name of ["manufacturing-aligned-process", "aligned-ios-present"]) {
  assert.equal(byName.get(name).opportunities.expectFewEdits, true);
  assert.equal(gradeProposal(byName.get(name), noChanges()).passed, true, `${name}: NO_CHANGES is acceptable`);
}
for (const name of ["marketing-brochure-product-analytics", "brochure-devops-filler"]) {
  assert.deepEqual(gradeProposal(byName.get(name), noChanges()).hits.map((hit) => hit.type), ["missingImprovement"], `${name}: improvement required`);
}

const config = { provider: "claude-cli", model: "opus", reasoningEffort: "high" };
let calls = 0;
const receipt = await evaluateCase(byName.get("backend-platform"), config, {
  generate: async (request) => {
    assert.equal(request.body.reasoningEffort, "high");
    assert.ok(request.scopeText.includes("Django"));
    return proposal([safe]);
  },
  judge: async (request) => {
    calls += 1;
    assert.equal(request.model, JUDGE.model);
    assert.equal(request.retryUnreadableOutput, false);
    assert.equal(JSON.parse(request.userPrompt).edits.length, 1);
    return { edits: [label] };
  }
});
assert.equal(receipt.passed, true);
assert.equal(calls, 1);
assert.equal(summaryRow(receipt, 1).unsupported, 0);
assert.ok(!JSON.stringify(summaryRow(receipt, 1)).includes(safe.replacement));
const unusedJudge = async () => { throw new Error("Should not call judge"); };
assert.equal((await evaluateCase(byName.get("aligned-data"), config, { generate: async () => noChanges(), judge: unusedJudge })).factCheck.status, "not-needed");
const judgeBad = await evaluateCase(byName.get("backend-platform"), config, { generate: async () => proposal([safe]), judge: async () => ({ edits: [] }) });
assert.equal(judgeBad.passed, false);
assert.equal(judgeBad.error, "fact-check-shape");
assert.equal(judgeBad.factCheck.status, "error");
assert.equal(summaryRow(judgeBad, 1).unsupported, null);
const unsupported = await evaluateCase(byName.get("backend-platform"), config, { generate: async () => proposal([safe]), judge: async () => ({ edits: [{ ...label, supported: false, unsupportedClaim: "Invented scope" }] }) });
assert.equal(unsupported.passed, false);
for (const failingStage of ["generation", "fact-check"]) {
  const result = await evaluateCase(byName.get("backend-platform"), config, {
    generate: async () => { if (failingStage === "generation") throw new Error("SENSITIVE RESPONSE"); return proposal([safe]); },
    judge: async () => { throw new Error("SENSITIVE RESPONSE"); }
  });
  assert.equal(result.error, failingStage);
  assert.equal(result.passed, false);
  assert.ok(!JSON.stringify(result).includes("SENSITIVE RESPONSE"));
}
const liveSource = readFileSync(new URL("./resume-proposal-quality-eval.mjs", import.meta.url), "utf8");
assert.ok(!liveSource.includes("tailor-benchmark"));
const gate = readFileSync(new URL("../../../offline-evals.test.mjs", import.meta.url), "utf8");
assert.match(gate, /const LIVE = new Set\([\s\S]*?"resume-proposal-quality-eval\.mjs"/);
console.log(`Resume Proposal benchmark contracts passed: ${fixtures.length} synthetic fixtures, ${trapControls.length} trap and ${safeControls.length} honest-edit controls, scoped judge evidence, complete labels, offline provider doubles, privacy-safe failures.`);
