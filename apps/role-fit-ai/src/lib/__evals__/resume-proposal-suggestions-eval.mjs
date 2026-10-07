// The client maps a Resume Polish response onto its own targets. A new bullet
// gets a fresh bullet id; any change whose server target echo disagrees with
// the client's target fails the whole proposal instead of editing another field.

import assert from "node:assert/strict";

import { heldBackSuggestions, proposalSuggestions } from "../resumeProposalSuggestions.ts";

const scope = {
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: [], omittedEntryNames: [] },
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    entries: [{ id: "acme", titleLeft: "Acme Corp", titleRight: "", subtitleLeft: "Intern", subtitleRight: "", bullets: [{ id: "b1", text: "Built tools." }] }]
  }],
  contextSections: []
};
const profile = "## Acme Corp (internship, 2024)\nAutomated release notes with GitHub Actions.";
const wire = (changes) => ({ status: "PROPOSAL", changes, summary: [], omittedTargetCount: 0, withheld: { count: 0, reasons: [] } });

const [edit, added] = proposalSuggestions(wire([
  { targetId: "target-1", target: { sectionId: "exp", entryId: "acme", bulletId: "b1" }, replacement: "Built JavaScript tools." },
  { targetId: "add-1", target: { sectionId: "exp", entryId: "acme" }, replacement: "Automated release notes.", evidence: "profile" }
]), scope, profile);
assert.equal(edit.target.bulletId, "b1");
assert.equal(edit.kind, undefined);
assert.equal(added.kind, "add", "a new-bullet change becomes an addition");
assert.equal(added.currentText, "");
assert.equal(added.evidence, "profile");
assert.equal(added.profileSource, "Acme Corp (internship, 2024)", "a Profile row shows the whole heading its text came from, qualifiers included");
assert.equal(edit.profileSource, undefined, "a resume-only edit names no Profile heading");
assert.equal(edit.profileEvidence, profile, "every row on a linked entry carries the linked Profile text, Profile-evidenced or not");
assert.equal(added.profileEvidence, profile);
const [unlinked] = proposalSuggestions(wire([
  { targetId: "target-1", target: { sectionId: "exp", entryId: "acme", bulletId: "b1" }, replacement: "Built JavaScript tools." }
]), scope, "## Somewhere else\nUnrelated.");
assert.equal(unlinked.profileEvidence, undefined, "an entry with no linked block carries no evidence text");
assert.ok(added.target.bulletId && added.target.bulletId !== "b1", "an addition gets a fresh bullet id");
const [again] = proposalSuggestions(wire([
  { targetId: "add-1", target: { sectionId: "exp", entryId: "acme" }, replacement: "Automated release notes." }
]), scope, profile);
assert.notEqual(again.target.bulletId, added.target.bulletId, "each mapping assigns a new id");

for (const [label, change, context] of [
  ["a missing echo", { targetId: "target-1", replacement: "x" }, profile],
  ["another entry", { targetId: "target-1", target: { sectionId: "exp", entryId: "beta", bulletId: "b1" }, replacement: "x" }, profile],
  ["another bullet", { targetId: "target-1", target: { sectionId: "exp", entryId: "acme", bulletId: "b9" }, replacement: "x" }, profile],
  ["an unknown target", { targetId: "target-7", target: { sectionId: "exp", entryId: "acme", bulletId: "b1" }, replacement: "x" }, profile],
  ["an add the client never derived", { targetId: "add-1", target: { sectionId: "exp", entryId: "acme" }, replacement: "x" }, ""]
]) {
  assert.throws(() => proposalSuggestions(wire([change]), scope, context), /invalid outcome/, `${label} fails the proposal`);
}

const twoBlocks = "## Acme Corp (internship, 2024)\nAutomated release notes.\n\n## Intern (freelance, not on resume)\nBuilt Kafka consumers.";
const [fromBoth] = proposalSuggestions(wire([
  { targetId: "add-1", target: { sectionId: "exp", entryId: "acme" }, replacement: "Built Kafka consumers.", evidence: "profile" }
]), scope, twoBlocks);
assert.equal(fromBoth.profileSource, "Acme Corp (internship, 2024); Intern (freelance, not on resume)",
  "every heading linked to the entry is shown, so a role-only link stays visible");

// Removals and reorders map their target ids onto the entry's bullet ids.
const threeBullets = {
  ...scope,
  sections: [{
    ...scope.sections[0],
    entries: [{ ...scope.sections[0].entries[0], bullets: [{ id: "b1", text: "Built tools." }, { id: "b2", text: "Ran a club." }, { id: "b3", text: "Cut CI time." }] }]
  }]
};
const acmeEcho = { sectionId: "exp", entryId: "acme" };
const [removal, reorder] = proposalSuggestions(wire([
  { targetId: "target-2", target: { ...acmeEcho, bulletId: "b2" }, action: "remove", reason: "Off-target." },
  { targetId: "order-1", target: acmeEcho, order: ["target-3", "target-1", "target-2"] }
]), threeBullets, "");
assert.equal(removal.kind, "remove");
assert.equal(removal.currentText, "Ran a club.");
assert.equal(removal.proposedText, "");
assert.deepEqual(removal.originalOrder, ["b1", "b2", "b3"], "a removal remembers its entry's order for Undo");
assert.equal(reorder.kind, "reorder");
assert.deepEqual(reorder.originalOrder, ["b1", "b2", "b3"]);
assert.deepEqual(reorder.proposedOrder, ["b3", "b1", "b2"]);

for (const [label, change] of [
  ["an order on a bullet target", { targetId: "target-1", target: { ...acmeEcho, bulletId: "b1" }, order: ["target-1"] }],
  ["a partial order", { targetId: "order-1", target: acmeEcho, order: ["target-3", "target-1"] }],
  ["a repeated id", { targetId: "order-1", target: acmeEcho, order: ["target-3", "target-3", "target-1"] }],
  ["a removal of an order target", { targetId: "order-1", target: acmeEcho, action: "remove" }],
  ["a replacement for an order target", { targetId: "order-1", target: acmeEcho, replacement: "x" }]
]) {
  assert.throws(() => proposalSuggestions(wire([change]), threeBullets, ""), /invalid outcome/, `${label} fails the proposal`);
}

// Held-back edits from the opt-in review map through the same checks, with ids
// assigned on arrival and their reason and note carried.
const reviewedWire = (heldBack) => ({ ...wire([]), status: "NO_CHANGES", review: { outcome: "REVIEWED", attempts: 1, heldBack } });
const held = heldBackSuggestions(reviewedWire([
  { change: { targetId: "target-1", target: { sectionId: "exp", entryId: "acme", bulletId: "b1" }, replacement: "Built JavaScript tools.", warnings: ["Not supported by provided evidence. Example."] }, reason: "LOW_IMPACT", note: "Swaps one word." },
  { change: { targetId: "add-1", target: { sectionId: "exp", entryId: "acme" }, replacement: "Automated release notes.", evidence: "profile" }, reason: "INCORRECT" }
]), scope, profile);
assert.deepEqual(held.map(({ suggestion, reason, note }) => [suggestion.id, reason, note]), [["target-1", "LOW_IMPACT", "Swaps one word."], ["add-1", "INCORRECT", undefined]]);
assert.deepEqual(held[0].suggestion.warnings, ["Not supported by provided evidence. Example."], "a held-back edit keeps its warnings");
assert.equal(held[1].suggestion.kind, "add");
assert.ok(held[1].suggestion.target.bulletId && held[1].suggestion.target.bulletId !== "b1", "a held-back addition gets its bullet id on arrival");
assert.equal("note" in held[1], false);
assert.deepEqual(heldBackSuggestions(wire([]), scope, profile), [], "no review, nothing held back");
assert.throws(
  () => heldBackSuggestions(reviewedWire([{ change: { targetId: "target-1", target: { sectionId: "exp", entryId: "beta", bulletId: "b1" }, replacement: "x" }, reason: "LOW_IMPACT" }]), scope, profile),
  /invalid outcome/,
  "a held-back change whose echo disagrees fails the proposal like a kept one"
);

console.log("resume-proposal-suggestions probes passed");
