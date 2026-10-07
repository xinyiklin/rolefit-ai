// Executes the production proposal-decision hook for edits the opt-in Polish
// review held back: Restore returns one to the proposal without changing the
// proposal key, so earlier decisions and their Undo survive; Accept all never
// reaches an unrestored edit; a restored addition keeps the id it arrived with.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const scheduler = `
let slots=[],cursor=0;
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useMemo(factory){cursor++;return factory();}
export function useCallback(callback){cursor++;return callback;}
export function render(callback){cursor=0;return callback();}
`;
const bundle = await build({
  stdin: {
    contents: `export {useResumeProposalDecisions} from './src/hooks/useResumeProposalDecisions.ts';export {render} from 'react';`,
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url))
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "controlled-hooks",
    setup(api) {
      api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
      api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
    }
  }]
});
const { useResumeProposalDecisions, render } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

let resume = {
  header: null,
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    items: [{
      id: "acme",
      titleLeft: "Acme Corp",
      titleRight: "2024",
      subtitleLeft: "Software Engineer Intern",
      subtitleRight: "",
      bullets: [
        { id: "b1", text: "Built internal JavaScript tools." },
        { id: "b2", text: "Attended weekly team meetings." },
        { id: "b3", text: "Wrote SQL reports." }
      ]
    }]
  }]
};
let generation = 1;
const mapBullets = (update) => {
  resume = { ...resume, sections: resume.sections.map((section) => ({ ...section, items: section.items.map((entry) => ({ ...entry, bullets: update(entry.bullets) })) })) };
};
const actions = {
  getDocumentGeneration: () => generation,
  addBullet: (sectionId, entryId, bullet) => mapBullets((bullets) => [...bullets, bullet]),
  removeBullet: (sectionId, entryId, bulletId) => mapBullets((bullets) => bullets.filter((bullet) => bullet.id !== bulletId)),
  updateBullet: (sectionId, entryId, bulletId, value) => mapBullets((bullets) => bullets.map((bullet) => (bullet.id === bulletId ? { ...bullet, text: value } : bullet))),
  reorderBullets: (sectionId, entryId, from, to) => mapBullets((bullets) => {
    const next = [...bullets];
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  }),
  updateEntry: () => assert.fail("no skill rows in this proposal")
};

const kept = {
  id: "target-1",
  target: { sectionId: "exp", entryId: "acme", bulletId: "b1", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "Built internal JavaScript tools.",
  proposedText: "Built JavaScript tools for internal support teams.",
  reason: ""
};
const heldAddition = {
  id: "add-1",
  kind: "add",
  // Assigned when the proposal arrived, before any Restore.
  target: { sectionId: "exp", entryId: "acme", bulletId: "bullet-new", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "",
  proposedText: "Joined the on-call rotation for the payments API.",
  reason: "",
  evidence: "profile",
  warnings: ["Not supported by provided evidence. Example concern."]
};
const heldRemoval = {
  id: "target-2",
  kind: "remove",
  target: { sectionId: "exp", entryId: "acme", bulletId: "b2", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "Attended weekly team meetings.",
  proposedText: "",
  reason: "",
  originalOrder: ["b1", "b2", "b3"]
};
const reviewed = (overrides = {}) => ({
  runId: "run-1",
  polishOutcome: "PROPOSAL",
  documentGeneration: 1,
  suggestedChanges: [kept],
  review: "REVIEWED",
  heldBack: [{ suggestion: heldAddition, reason: "LOW_IMPACT", note: "Adds little." }, { suggestion: heldRemoval, reason: "INCORRECT" }],
  trimmedBulletGroups: 0,
  proposalBaselineText: "",
  ...overrides
});
let result = reviewed();
const hook = () => render(() => useResumeProposalDecisions({ result, resume, actions }));
const bulletIds = () => resume.sections[0].items[0].bullets.map((bullet) => bullet.id);
const textOf = (id) => resume.sections[0].items[0].bullets.find((bullet) => bullet.id === id)?.text;

let proposal = hook();
const key = proposal.proposalKey;
assert.deepEqual(proposal.suggestions.map((item) => item.id), ["target-1"], "held-back edits are not decidable rows");
assert.deepEqual(proposal.heldBack.map((item) => item.suggestion.id), ["add-1", "target-2"]);
assert.equal(proposal.outstanding, 1);
assert.equal(proposal.total, 1);

proposal.applyAll();
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "b2", "b3"], "Accept all never applies an unrestored held-back edit");
assert.equal(textOf("b1"), kept.proposedText);
assert.equal(proposal.decisionsSettled, true, "with nothing restored the proposal is settled");

proposal.restore("add-1");
proposal = hook();
assert.equal(proposal.proposalKey, key, "Restore never changes the proposal key");
assert.deepEqual(proposal.decisions, { "target-1": { kind: "accepted", text: kept.proposedText } }, "earlier decisions survive a Restore");
assert.deepEqual(proposal.suggestions.map((item) => item.id), ["target-1", "add-1"]);
assert.deepEqual(proposal.heldBack.map((item) => item.suggestion.id), ["target-2"]);
assert.equal(proposal.isRestored("add-1"), true);
assert.equal(proposal.isRestored("target-1"), false);
assert.equal(proposal.outstanding, 1, "a restored edit is pending");
assert.equal(proposal.decisionsSettled, false);
assert.deepEqual(proposal.suggestions[1].warnings, heldAddition.warnings, "a restored edit keeps its warnings");

proposal.accept(proposal.suggestions[1]);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "b2", "b3", "bullet-new"], "a restored addition inserts with the id it arrived with");
proposal.revert(proposal.suggestions[1]);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "b2", "b3"], "Undo removes exactly the restored addition");

proposal.revert(kept);
proposal = hook();
assert.equal(textOf("b1"), kept.currentText, "Undo of a decision made before the Restore still works");

proposal.restore("target-2");
proposal = hook();
proposal.accept(heldRemoval);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "b3"], "a restored removal removes its bullet");
proposal.revert(heldRemoval);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "b2", "b3"], "and Undo restores it in place");
assert.deepEqual(proposal.heldBack, [], "every held-back edit restored");

proposal.restore("target-99");
proposal = hook();
assert.equal(proposal.suggestions.length, 3, "an unknown id restores nothing");

result = reviewed({ runId: "run-2" });
proposal = hook();
assert.notEqual(proposal.proposalKey, key);
assert.deepEqual(proposal.heldBack.map((item) => item.suggestion.id), ["add-1", "target-2"], "a new run starts with its own held-back list");
assert.deepEqual(proposal.suggestions.map((item) => item.id), ["target-1"]);

generation = 2;
proposal.restore("add-1");
proposal = hook();
assert.equal(proposal.isRestored("add-1"), false, "Restore is refused once the document was replaced");
generation = 1;

// Every edit held back: reads as no changes, and a Restore makes one decidable.
result = reviewed({ runId: "run-3", polishOutcome: "NO_CHANGES", suggestedChanges: [] });
proposal = hook();
assert.deepEqual([proposal.total, proposal.outstanding, proposal.decisionsSettled], [0, 0, true]);
proposal.restore("add-1");
proposal = hook();
assert.deepEqual([proposal.total, proposal.outstanding, proposal.decisionsSettled], [1, 1, false]);

console.log("resume proposal restore-hook probes passed");
