// Bullet removal and reorder proposals: shared target derivation, prompt
// budgeting, server sanitizing, and the client wire shape.
import assert from "node:assert/strict";

import { flattenResumeTargets, sanitizeResumePolishWireResult } from "../../../shared/resumePolishContract.ts";
import { buildResumeProposalPrompts, sanitizeResumeProposal, selectPromptTargets } from "../resumeProposal.ts";

const entry = (id, bullets) => ({ id, titleLeft: id, titleRight: "", subtitleLeft: "", subtitleRight: "", bullets });
const scope = {
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] },
  sections: [
    { id: "summary", heading: "Summary", type: "summary", entries: [entry("sum", [{ id: "s1", text: "Engineer." }, { id: "s2", text: "Builder." }])] },
    {
      id: "exp",
      heading: "Experience",
      type: "standard",
      entries: [
        entry("acme", [
          { id: "b1", text: "Built JavaScript tools for internal teams." },
          { id: "b2", text: "Organized the team book club." },
          { id: "b3", text: "Cut CI time with GitHub Actions." }
        ]),
        entry("solo", [{ id: "c1", text: "Shipped a SQL report." }])
      ]
    },
    { id: "skills", heading: "Skills", type: "skills", entries: [{ ...entry("langs", []), titleLeft: "Languages", subtitleLeft: "JavaScript, SQL" }] }
  ],
  contextSections: []
};
const targets = flattenResumeTargets(scope);
const byId = new Map(targets.map((target) => [target.targetId, target]));

// target-1..2 summary, target-3..5 acme, target-6 solo, target-7 skills.
assert.deepEqual(targets.map((target) => target.targetId), [
  "target-1", "target-2", "target-3", "target-4", "target-5", "target-6", "target-7", "order-1"
], "existing targets keep their ids; order targets follow them");
assert.deepEqual(byId.get("order-1").bulletTargetIds, ["target-3", "target-4", "target-5"]);
assert.equal(byId.get("order-1").target.entryId, "acme", "only standard entries with two or more bullets get an order target");
assert.deepEqual(flattenResumeTargets(scope, "").map((target) => target.targetId), targets.map((target) => target.targetId),
  "client and server derive identical ids");

const jobText = "Build JavaScript tools and CI pipelines with GitHub Actions.";
const scopeText = "Experience\nBuilt JavaScript tools for internal teams.\nOrganized the team book club.\nCut CI time with GitHub Actions.\nShipped a SQL report.";
const sanitize = (changes) => sanitizeResumeProposal({ status: "PROPOSAL", changes }, targets, jobText, scopeText, "");
const echo = (bulletId) => ({ sectionId: "exp", entryId: "acme", bulletId });

let result = sanitize([
  { targetId: "target-4", action: "remove", reason: "Not relevant." },
  { targetId: "target-6", action: "remove" }
]);
assert.deepEqual(result.changes, [{ targetId: "target-4", target: echo("b2"), action: "remove", reason: "Not relevant." }],
  "a removal keeps its echo and reason");
assert.equal(result.withheld.count, 1);
assert.deepEqual(result.withheld.reasons, ["INVALID_TARGET"], "removing an entry's only bullet is invalid");

result = sanitize([
  { targetId: "target-1", action: "remove" },
  { targetId: "target-7", action: "remove" },
  { targetId: "order-1", action: "remove" }
]);
assert.equal(result.changes.length, 0, "summary, skills, and order targets cannot be removed");
assert.equal(result.status, "WITHHELD");

result = sanitize([
  { targetId: "target-3", action: "remove" },
  { targetId: "target-4", action: "remove" },
  { targetId: "target-5", action: "remove" }
]);
assert.equal(result.changes.length, 2, "an entry always keeps at least one bullet");

result = sanitize([
  { targetId: "target-4", action: "remove" },
  { targetId: "target-4", replacement: "Organized a weekly JavaScript study group." }
]);
assert.equal(result.changes.length, 1);
assert.ok(result.changes[0].replacement, "a bullet both removed and rewritten keeps its rewrite");
assert.deepEqual(result.withheld.reasons, ["MALFORMED"]);

for (const [label, change] of [
  ["a removal that also carries a replacement", { targetId: "target-4", action: "remove", replacement: "Organized a JavaScript study group." }],
  ["an order that also carries a replacement", { targetId: "order-1", order: ["target-5", "target-3", "target-4"], replacement: "x" }],
  ["a change with no operation", { targetId: "target-4", reason: "?" }]
]) {
  result = sanitize([change]);
  assert.equal(result.changes.length, 0, `${label} is never read as one of its operations`);
  assert.deepEqual(result.withheld.reasons, ["MALFORMED"], label);
}

for (const rewrite of [
  { targetId: "target-4", replacement: "Organized the team book club." },
  { targetId: "target-4", replacement: "Organized the [club name] book club." }
]) {
  result = sanitize([{ targetId: "target-4", action: "remove" }, rewrite]);
  assert.equal(result.changes.some((change) => change.action === "remove"), false,
    "a dropped rewrite of a bullet still blocks its removal");
}

result = sanitize([{ targetId: "order-1", order: ["target-5", "target-3", "target-4"], reason: "Lead with CI." }]);
assert.deepEqual(result.changes, [{
  targetId: "order-1",
  target: { sectionId: "exp", entryId: "acme" },
  order: ["target-5", "target-3", "target-4"],
  reason: "Lead with CI."
}]);

for (const [label, order] of [
  ["a partial order", ["target-5", "target-3"]],
  ["a duplicate id", ["target-5", "target-5", "target-3"]],
  ["another entry's bullet", ["target-5", "target-3", "target-6"]],
  ["a non-array", "target-5,target-3,target-4"]
]) {
  result = sanitize([{ targetId: "order-1", order }]);
  assert.equal(result.changes.length, 0, `${label} is withheld`);
  assert.deepEqual(result.withheld.reasons, ["MALFORMED"], label);
}
result = sanitize([{ targetId: "order-1", order: ["target-3", "target-4", "target-5"] }]);
assert.equal(result.status, "NO_CHANGES", "an unchanged order is a no-op");

result = sanitize([
  { targetId: "order-1", order: ["target-5", "target-3", "target-4"] },
  { targetId: "target-4", action: "remove" }
]);
assert.deepEqual(result.changes.map((change) => change.action ?? "order"), ["remove"],
  "an entry with a removal cannot also be reordered, whatever the response order");

result = sanitize([{ targetId: "target-3", order: ["target-3"] }, { targetId: "target-5", action: "rewrite", replacement: "x" }]);
assert.equal(result.changes.length, 0, "operation fields on the wrong target kind are malformed");

// Budgeting: an order target is sent only when all of its bullets are.
const tight = selectPromptTargets(targets, jobText);
assert.ok(tight.selectedTargets.some((target) => target.targetId === "order-1"));
assert.equal(tight.omittedCount, 0);
const partial = selectPromptTargets(targets.filter((target) => target.targetId !== "target-4"), jobText);
assert.equal(partial.selectedTargets.some((target) => target.targetId === "order-1"), false,
  "an order whose bullets were not all sent is never offered");
assert.equal(partial.omittedCount, 0, "an unsent order target is not an omitted field");

const prompts = buildResumeProposalPrompts({ jobText, targets, scopeText, candidateContext: "", customInstructions: "" });
assert.match(prompts.userPrompt, /"action": "remove"/);
assert.match(prompts.userPrompt, /bullet-order target lists/);
assert.match(prompts.userPrompt, /never every bullet of an entry/);
const skillsOnly = flattenResumeTargets({ ...scope, sections: [scope.sections[2]] });
const plain = buildResumeProposalPrompts({ jobText, targets: skillsOnly, scopeText, candidateContext: "", customInstructions: "" });
assert.doesNotMatch(plain.userPrompt, /"action": "remove"|bullet-order/, "structural rules appear only when a target allows them");

// Client wire shape.
const wire = (changes) => sanitizeResumePolishWireResult({ status: "PROPOSAL", changes, summary: [], omittedTargetCount: 0, withheld: { count: 0, reasons: [] } });
assert.deepEqual(wire([{ targetId: "target-4", target: echo("b2"), action: "remove" }]).changes[0], { targetId: "target-4", target: echo("b2"), action: "remove" });
assert.deepEqual(wire([{ targetId: "order-1", order: ["target-5", "target-3"] }]).changes[0].order, ["target-5", "target-3"]);
assert.equal(wire([{ targetId: "order-1", order: [] }]), null, "an empty order invalidates the response");
assert.equal(wire([{ targetId: "order-1", order: ["target-1", 7] }]), null, "a non-string id invalidates the response");
assert.equal(wire([{ targetId: "target-4", action: "rewrite" }]), null, "an unknown action without a replacement invalidates the response");
assert.equal(wire([{ targetId: "target-4", action: "remove", replacement: "x" }]), null, "two operations on one change invalidate the response");
assert.equal(wire([{ targetId: "target-4", action: "rewrite", replacement: "x" }]), null, "an unknown action invalidates the response");

console.log("resume proposal structure probes passed");
