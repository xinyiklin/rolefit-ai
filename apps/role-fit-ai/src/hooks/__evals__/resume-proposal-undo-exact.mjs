// Executes the production proposal-decision hook with a controlled hook
// scheduler: Undo on a settled row restores byte for byte the text its accept
// replaced, even where the proposal's original reads whitespace-collapsed.
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

// Live bullet text the proposal's flattened targets collapse and trim.
const text = { b1: "  Built  internal JavaScript tools.", b2: " Ran the  team book club.", b3: "Cut CI time with GitHub Actions.", b4: "Clean bullet." };
const collapse = (value) => value.replace(/\s+/g, " ").trim();
const initial = () => ({
  header: null,
  sections: [{
    id: "exp",
    heading: "Experience",
    type: "standard",
    items: [{ id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "",
      bullets: ["b1", "b2", "b3", "b4"].map((id) => ({ id, text: text[id] })) }]
  }]
});
let resume = initial();
const mapBullets = (update) => {
  resume = { ...resume, sections: resume.sections.map((section) => ({ ...section,
    items: section.items.map((entry) => ({ ...entry, bullets: update(entry.bullets) })) })) };
};
// Mirrors the shared reducer: addBullet appends, reorderBullets splices from -> to.
const actions = {
  getDocumentGeneration: () => 1,
  addBullet: (sectionId, entryId, bullet) => mapBullets((bullets) => [...bullets, bullet]),
  removeBullet: (sectionId, entryId, bulletId) => mapBullets((bullets) => bullets.filter((bullet) => bullet.id !== bulletId)),
  reorderBullets: (sectionId, entryId, from, to) => mapBullets((bullets) => {
    const next = bullets.slice();
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  }),
  updateBullet: (sectionId, entryId, bulletId, value) =>
    mapBullets((bullets) => bullets.map((bullet) => (bullet.id === bulletId ? { ...bullet, text: value } : bullet))),
  updateEntry: () => assert.fail("no skill rows in this proposal")
};

const target = (bulletId) => ({ sectionId: "exp", entryId: "acme", bulletId, field: "bullet" });
const rewrite = { id: "target-1", target: target("b1"), sectionHeading: "Experience",
  currentText: collapse(text.b1), proposedText: "Built JavaScript tools for support teams.", reason: "" };
const removal = { id: "target-2", kind: "remove", target: target("b2"), sectionHeading: "Experience",
  currentText: collapse(text.b2), proposedText: "", reason: "Not relevant.", originalOrder: ["b1", "b2", "b3", "b4"] };
const clean = { id: "target-4", target: target("b4"), sectionHeading: "Experience",
  currentText: text.b4, proposedText: "Clean, sharper bullet.", reason: "" };
let result = { runId: "run-1", polishOutcome: "PROPOSAL", documentGeneration: 1,
  suggestedChanges: [rewrite, removal, clean], trimmedBulletGroups: 0, proposalBaselineText: "" };
const hook = () => render(() => useResumeProposalDecisions({ result, resume, actions }));
const bullets = () => resume.sections[0].items[0].bullets.map(({ id, text: value }) => [id, value]);
const original = bullets();

let proposal = hook();
assert.equal(proposal.outstanding, 3, "whitespace-only differences from the live document still read as pending");

proposal.accept(rewrite);
proposal = hook();
assert.equal(bullets()[0][1], rewrite.proposedText);
proposal.revert(rewrite);
proposal = hook();
assert.deepEqual(bullets(), original, "Undo restores a rewritten bullet's leading and doubled spaces byte for byte");
assert.equal(proposal.isPending(rewrite), true);

proposal.accept(removal);
proposal = hook();
assert.deepEqual(bullets().map(([id]) => id), ["b1", "b3", "b4"]);
proposal.revert(removal);
proposal = hook();
assert.deepEqual(bullets(), original, "Undo restores a removed bullet in place with its exact text");
assert.equal(proposal.isPending(removal), true);

// Accept all reads each replaced text from the pre-batch document.
proposal.applyAll();
proposal = hook();
assert.equal(proposal.outstanding, 0);
// An accept over text that already matches the proposal's original records no extra field.
assert.deepEqual(proposal.decisions[clean.id], { kind: "accepted", text: clean.proposedText });
for (const suggestion of [rewrite, removal, clean]) {
  proposal.revert(suggestion);
  proposal = hook();
}
assert.deepEqual(bullets(), original, "Undo after Accept all restores every row exactly");
assert.equal(proposal.outstanding, 3);

console.log("resume proposal undo-exact probes passed");
