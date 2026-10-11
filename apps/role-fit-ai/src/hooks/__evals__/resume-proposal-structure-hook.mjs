// Executes the production proposal-decision hook with a controlled hook
// scheduler: a removal cuts its bullet and Undo restores it in place; a reorder
// applies and undoes as a whole; group bulk actions touch only their group.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const scheduler = `
let slots=[],cursor=0;
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useMemo(factory){cursor++;return factory();}
export function useDeferredValue(value){return value;}
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

const text = { b1: "Built internal JavaScript tools.", b2: "Ran the team book club.", b3: "Cut CI time with GitHub Actions.", c1: "Shipped a Go API.", c2: "Wrote its docs." };
const initial = () => ({
  header: null,
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    items: [
      { id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: ["b1", "b2", "b3"].map((id) => ({ id, text: text[id] })) },
      { id: "beta", titleLeft: "Beta", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: ["c1", "c2"].map((id) => ({ id, text: text[id] })) }
    ]
  }]
});
let resume = initial();
const calls = [];
const mapBullets = (entryId, update) => {
  resume = {
    ...resume,
    sections: resume.sections.map((section) => ({
      ...section,
      items: section.items.map((entry) => (entry.id === entryId ? { ...entry, bullets: update(entry.bullets) } : entry))
    }))
  };
};
// Mirrors the shared reducer: addBullet appends, reorderBullets splices from -> to.
const actions = {
  getDocumentGeneration: () => 1,
  addBullet: (sectionId, entryId, bullet, viaSuggestion) => {
    calls.push(["addBullet", viaSuggestion]);
    mapBullets(entryId, (bullets) => [...bullets, bullet]);
  },
  removeBullet: (sectionId, entryId, bulletId, viaSuggestion) => {
    calls.push(["removeBullet", viaSuggestion]);
    mapBullets(entryId, (bullets) => bullets.filter((bullet) => bullet.id !== bulletId));
  },
  reorderBullets: (sectionId, entryId, from, to, viaSuggestion) => {
    calls.push(["reorderBullets", viaSuggestion]);
    mapBullets(entryId, (bullets) => {
      const next = bullets.slice();
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  },
  updateBullet: (sectionId, entryId, bulletId, value, viaSuggestion) => {
    calls.push(["updateBullet", viaSuggestion]);
    mapBullets(entryId, (bullets) => bullets.map((bullet) => (bullet.id === bulletId ? { ...bullet, text: value } : bullet)));
  },
  updateEntry: () => assert.fail("no skill rows in this proposal")
};

const removal = {
  id: "target-2",
  kind: "remove",
  target: { sectionId: "exp", entryId: "acme", bulletId: "b2", field: "bullet" },
  sectionHeading: "Experience",
  currentText: text.b2,
  proposedText: "",
  reason: "Not relevant to this job.",
  originalOrder: ["b1", "b2", "b3"]
};
const reorder = {
  id: "order-2",
  kind: "reorder",
  target: { sectionId: "exp", entryId: "beta", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "",
  proposedText: "",
  reason: "Lead with the API.",
  originalOrder: ["c1", "c2"],
  proposedOrder: ["c2", "c1"]
};
const rewrite = {
  id: "target-1",
  target: { sectionId: "exp", entryId: "acme", bulletId: "b1", field: "bullet" },
  sectionHeading: "Experience",
  currentText: text.b1,
  proposedText: "Built JavaScript tools for support teams.",
  reason: ""
};
let result = { runId: "run-1", polishOutcome: "PROPOSAL", documentGeneration: 1, suggestedChanges: [rewrite, removal, reorder], trimmedBulletGroups: 0, proposalBaselineText: "" };
const hook = () => render(() => useResumeProposalDecisions({ result, resume, actions }));
const ids = (entryId) => resume.sections[0].items.find((entry) => entry.id === entryId).bullets.map((bullet) => bullet.id);

let proposal = hook();
assert.equal(proposal.outstanding, 3);

proposal.accept(removal);
proposal = hook();
assert.deepEqual(ids("acme"), ["b1", "b3"], "Accept removes exactly the target bullet");
assert.equal(proposal.isPending(removal), false);
proposal.revert(removal);
proposal = hook();
assert.deepEqual(ids("acme"), ["b1", "b2", "b3"], "Undo restores the removed bullet at its original position");
assert.equal(resume.sections[0].items[0].bullets[1].text, text.b2, "with its original text");
assert.equal(proposal.isPending(removal), true, "the restored removal is pending again");

// Restore position survives a neighbouring removal: with b1 gone, b2 returns first.
proposal.accept(removal);
mapBullets("acme", (bullets) => bullets.filter((bullet) => bullet.id !== "b1"));
proposal = hook();
proposal.revert(removal);
proposal = hook();
assert.deepEqual(ids("acme"), ["b2", "b3"], "a restored bullet follows its nearest surviving predecessor");
resume = initial();
proposal = hook();
assert.equal(proposal.outstanding, 3, "decisions re-derive from the live document");

// A bullet deleted by hand settles its removal.
mapBullets("acme", (bullets) => bullets.filter((bullet) => bullet.id !== "b2"));
proposal = hook();
assert.equal(proposal.isPending(removal), false, "a manual delete settles the matching removal");
resume = initial();
proposal = hook();

proposal.accept(reorder);
proposal = hook();
assert.deepEqual(ids("beta"), ["c2", "c1"], "Accept applies the proposed order");
assert.equal(proposal.isPending(reorder), false);
proposal.revert(reorder);
proposal = hook();
assert.deepEqual(ids("beta"), ["c1", "c2"], "Undo restores the original order");
assert.equal(proposal.isPending(reorder), true);

// A reorder ignores bullets it never listed, such as an accepted addition.
mapBullets("beta", (bullets) => [...bullets, { id: "new", text: "Added later." }]);
proposal = hook();
proposal.accept(reorder);
proposal = hook();
assert.deepEqual(ids("beta"), ["c2", "c1", "new"], "unlisted bullets keep their slot");
mapBullets("beta", (bullets) => bullets.filter((bullet) => bullet.id !== "c1"));
proposal = hook();
assert.equal(proposal.isPending(reorder), false, "a reorder whose bullets changed reads as changed");
const before = calls.length;
proposal.revert(reorder);
assert.equal(calls.length, before, "Undo does nothing once the editor changed the reorder");
// A new run starts with no recorded decisions.
resume = initial();
result = { ...result, runId: "run-2" };
proposal = hook();

// Group bulk actions touch only their group; the footer pair covers every group.
proposal.applyAll([removal]);
proposal = hook();
assert.deepEqual(ids("acme"), ["b1", "b3"]);
assert.deepEqual(ids("beta"), ["c1", "c2"], "a group Accept leaves other groups pending");
assert.equal(resume.sections[0].items[0].bullets[0].text, text.b1);
assert.equal(proposal.outstanding, 2);
proposal.discardAll([reorder]);
proposal = hook();
assert.equal(proposal.outstanding, 1, "a group Discard settles only its rows");
assert.deepEqual(ids("beta"), ["c1", "c2"], "Discard never touches the document");
proposal.applyAll();
proposal = hook();
assert.equal(resume.sections[0].items[0].bullets[0].text, rewrite.proposedText, "Accept all applies what is left");
assert.equal(proposal.outstanding, 0);

// One batch that reorders and cuts in the same entry still lands both, because
// the index-based reorder runs before any id-based change.
resume = initial();
const sameEntry = { ...reorder, id: "order-1", target: { sectionId: "exp", entryId: "acme", field: "bullet" },
  originalOrder: ["b1", "b2", "b3"], proposedOrder: ["b3", "b2", "b1"] };
result = { ...result, runId: "run-3", suggestedChanges: [removal, sameEntry] };
proposal = hook();
proposal.applyAll();
proposal = hook();
assert.deepEqual(ids("acme"), ["b3", "b1"], "a same-entry removal and reorder both apply");

assert.ok(calls.every(([, viaSuggestion]) => viaSuggestion === true), "review decisions are never recorded as manual edits");

console.log("resume proposal structure-hook probes passed");
