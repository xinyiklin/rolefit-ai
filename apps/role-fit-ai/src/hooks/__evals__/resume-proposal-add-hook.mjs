// Executes the production proposal-decision hook with a controlled hook
// scheduler: an added Profile bullet is inserted on Accept with its assigned id,
// Undo removes exactly that bullet, and Discard never touches the document.
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
    contents: `export {useResumeProposalDecisions} from './src/hooks/useResumeProposalDecisions.ts';export {adviceNotOnResume} from './src/lib/resumePolishScope.ts';export {render} from 'react';`,
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
const { useResumeProposalDecisions, adviceNotOnResume, render } = await import(
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
      bullets: [{ id: "b1", text: "Built internal JavaScript tools." }]
    }]
  }]
};
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
const actions = {
  getDocumentGeneration: () => 1,
  addBullet: (sectionId, entryId, bullet, viaSuggestion) => {
    calls.push(["addBullet", bullet.id, viaSuggestion]);
    mapBullets(entryId, (bullets) => [...bullets, bullet]);
  },
  removeBullet: (sectionId, entryId, bulletId, viaSuggestion) => {
    calls.push(["removeBullet", bulletId, viaSuggestion]);
    mapBullets(entryId, (bullets) => bullets.filter((bullet) => bullet.id !== bulletId));
  },
  updateBullet: (sectionId, entryId, bulletId, value, viaSuggestion) => {
    calls.push(["updateBullet", bulletId, viaSuggestion]);
    mapBullets(entryId, (bullets) => bullets.map((bullet) => (bullet.id === bulletId ? { ...bullet, text: value } : bullet)));
  },
  updateEntry: () => assert.fail("no skill rows in this proposal")
};

const added = {
  id: "add-1",
  kind: "add",
  target: { sectionId: "exp", entryId: "acme", bulletId: "bullet-new", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "",
  proposedText: "Automated release notes with GitHub Actions.",
  reason: "",
  evidence: "profile"
};
const edited = {
  id: "target-1",
  target: { sectionId: "exp", entryId: "acme", bulletId: "b1", field: "bullet" },
  sectionHeading: "Experience",
  currentText: "Built internal JavaScript tools.",
  proposedText: "Built JavaScript tools for internal support teams.",
  reason: ""
};
const result = { runId: "run-1", polishOutcome: "PROPOSAL", documentGeneration: 1, suggestedChanges: [edited, added], trimmedBulletGroups: 0, proposalBaselineText: "" };
const hook = () => render(() => useResumeProposalDecisions({ result, resume, actions }));
const bulletIds = () => resume.sections[0].items[0].bullets.map((bullet) => bullet.id);

let proposal = hook();
assert.equal(proposal.outstanding, 2, "an addition is pending before any decision");

proposal.accept(added);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "bullet-new"], "Accept appends the new bullet with its assigned id");
assert.equal(resume.sections[0].items[0].bullets[1].text, added.proposedText);
assert.equal(proposal.outstanding, 1, "the accepted addition is decided");

proposal.revert(added);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1"], "Undo removes exactly the added bullet");
assert.equal(proposal.outstanding, 2, "the undone addition is pending again");

proposal.discard(added);
proposal = hook();
assert.deepEqual(bulletIds(), ["b1"], "Discard leaves the document unchanged");
proposal.revert(added);
proposal = hook();

proposal.accept(added, "Automated release notes.");
proposal = hook();
assert.equal(resume.sections[0].items[0].bullets[1].text, "Automated release notes.", "an edited addition inserts the edited text");
proposal.revert(added);
proposal = hook();

proposal.applyAll();
proposal = hook();
assert.deepEqual(bulletIds(), ["b1", "bullet-new"], "Accept all includes additions");
assert.equal(resume.sections[0].items[0].bullets[0].text, edited.proposedText, "Accept all still applies edits");
assert.equal(proposal.outstanding, 0);

mapBullets("acme", (bullets) => bullets.filter((bullet) => bullet.id !== "bullet-new"));
proposal = hook();
assert.equal(proposal.isPending(added), false, "an accepted addition deleted in the editor reads as changed, not pending");
const callsBefore = calls.length;
proposal.revert(added);
assert.equal(calls.length, callsBefore, "Undo does nothing once the editor changed the addition");

assert.ok(calls.every(([, , viaSuggestion]) => viaSuggestion === true), "review decisions are never recorded as manual edits");

// An add-from-profile suggestion for an item already on this resume is hidden.
const advice = [
  { kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "CI", candidateExcerpt: "", profileExcerpt: "Automated release notes with GitHub Actions.", rationale: "Add Acme work." },
  { kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "Go", candidateExcerpt: "", profileExcerpt: "Built a booking API in Go.", rationale: "Add Slotwise." },
  { kind: "emphasis", sectionId: "exp", entryId: "acme", jobExcerpt: "CI", candidateExcerpt: "Built internal JavaScript tools.", rationale: "Lead with tooling." }
];
const profile = "## Acme Corp (internship, 2024)\nAutomated release notes with GitHub Actions.\n\n## Slotwise (personal project)\nBuilt a booking API in Go.";
assert.deepEqual(
  adviceNotOnResume(advice, resume, profile).map((item) => item.rationale),
  ["Add Slotwise.", "Lead with tooling."],
  "only Profile items missing from the resume stay as add suggestions"
);

console.log("resume proposal add-hook probes passed");
