// Edits the opt-in Polish review held back render folded, with a reason, an
// optional note, their warnings, and a Restore action; the review's outcome gets
// one quiet line; without a review nothing new renders.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const resolveDir = fileURLToPath(new URL(".", import.meta.url));
const bundled = await esbuild.build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ResumeProposalReview } from "../ResumeProposalReview.tsx";

      const noop = () => undefined;
      const resume = {
        header: null,
        sections: [{ id: "exp", type: "standard", heading: "Experience",
          items: [{ id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
            { id: "b1", text: "Built JavaScript tools." },
            { id: "b2", text: "Cut CI time." },
            { id: "b3", text: "Ran the book club." }
          ] }] }]
      };
      const target = { sectionId: "exp", entryId: "acme", field: "bullet" };
      const rewrite = { id: "target-1", target: { ...target, bulletId: "b1" }, sectionHeading: "Experience",
        currentText: "Built JavaScript tools.", proposedText: "Built JavaScript tools for support.", reason: "" };
      const synonym = { id: "target-2", target: { ...target, bulletId: "b2" }, sectionHeading: "Experience",
        currentText: "Cut CI time.", proposedText: "Reduced CI time.", reason: "", warnings: ["Not supported by provided evidence. Example concern."] };
      const removal = { id: "target-3", kind: "remove", target: { ...target, bulletId: "b3" }, sectionHeading: "Experience",
        currentText: "Ran the book club.", proposedText: "", reason: "", originalOrder: ["b1", "b2", "b3"] };
      const heldBack = [{ suggestion: synonym, reason: "LOW_IMPACT", note: "Only swaps a verb." }, { suggestion: removal, reason: "INCORRECT" }];
      const render = ({ result = {}, suggestions = [rewrite], held = heldBack, restored = [], stale = false } = {}) => renderToStaticMarkup(React.createElement(ResumeProposalReview, {
        result: { polishOutcome: "PROPOSAL", missingKeywords: [], trimmedBulletGroups: 0, proposalBaselineText: "", suggestedChanges: [rewrite], ...result },
        resume,
        decisions: { suggestions, decisions: {}, decided: 0, fitGapRows: [], termCoverage: { onResume: [], relatedOnly: [], notOnResume: [], limitations: [] }, isPending: () => true, accept: noop, discard: noop, revert: noop, applyAll: noop, discardAll: noop,
          heldBack: held, isRestored: (id) => restored.includes(id), restore: noop, documentReplaced: false },
        proposalStale: stale,
        onHighlight: noop
      }));
      const reviewed = { review: "REVIEWED", heldBack };
      export const partial = render({ result: reviewed });
      export const stale = render({ result: reviewed, stale: true });
      export const allHeld = render({ result: { ...reviewed, polishOutcome: "NO_CHANGES", suggestedChanges: [] }, suggestions: [] });
      export const allHeldWithheld = render({ result: { ...reviewed, polishOutcome: "NO_CHANGES", suggestedChanges: [], withheld: { count: 1, reasons: ["INVALID_TARGET"] } }, suggestions: [] });
      export const restoredOne = render({ result: { ...reviewed, polishOutcome: "NO_CHANGES", suggestedChanges: [] }, suggestions: [synonym], held: [heldBack[1]], restored: ["target-2"] });
      export const allRestored = render({ result: reviewed, suggestions: [rewrite, synonym, removal], held: [], restored: ["target-2", "target-3"] });
      export const keptAll = render({ result: { review: "REVIEWED", heldBack: [] }, held: [] });
      export const unavailable = render({ result: { review: "UNAVAILABLE", heldBack: [] }, held: [] });
      export const off = render({ held: [] });
      export const offNoChanges = render({ result: { polishOutcome: "NO_CHANGES", suggestedChanges: [] }, suggestions: [], held: [] });
    `,
    resolveDir,
    loader: "tsx"
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  logLevel: "silent"
});
const module = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { partial, stale, allHeld, allHeldWithheld, restoredOne, allRestored, keptAll, unavailable, off, offNoChanges } = module.exports;

assert.match(partial, /<details class="resume-proposal__held-back"><summary>2 held back by review<\/summary>/, "held-back edits are folded by default with a count");
assert.match(partial, /Acme · Low impact/);
assert.match(partial, /Acme · Likely incorrect/);
assert.match(partial, /Review note: Only swaps a verb\./);
assert.match(partial, /Not supported by provided evidence\. Example concern\./, "a held-back edit shows its warnings");
const restoreNames = [...partial.matchAll(/> Restore<span class="sr-only"> ([^<]*)<\/span><\/button>/g)].map((match) => match[1]);
assert.deepEqual(restoreNames, ["Experience · Acme: Reduced CI time.", "Experience · Acme: Ran the book club."], "each Restore in one entry has its own accessible name");
const heldBackSection = (markup) => markup.slice(markup.indexOf('<details class="resume-proposal__held-back">'), markup.indexOf("</details>", markup.indexOf('<details class="resume-proposal__held-back">')));
const disabledButtons = (markup) => (heldBackSection(markup).match(/<button[^>]*\bdisabled=""/g) ?? []).length;
assert.equal(disabledButtons(partial), 0, "Restore is available on a current proposal");
assert.match(partial, /resume-proposal__original is-removed/, "a held-back removal shows the bullet it would cut");
assert.doesNotMatch(partial, /Review kept all|Review unavailable/);
assert.equal(disabledButtons(stale), 2, "Restore is disabled on a stale proposal");

assert.match(allHeld, /^<div class="resume-proposal"><p class="resume-proposal__empty" role="status">No worthwhile changes after review\.<\/p>/, "holding back every edit reads as no worthwhile changes, inside the proposal root");
assert.match(allHeldWithheld, /1 generated edit was withheld because it could not be applied safely\./, "the withheld line survives a review that held back the rest");
assert.doesNotMatch(allHeld, /withheld because/);
assert.match(allHeld, /2 held back by review/, "and the held-back count stays visible");
assert.doesNotMatch(allHeld, /No material changes were suggested/);
assert.doesNotMatch(restoredOne, /No worthwhile changes after review/, "a restored edit turns the result back into a list");
assert.match(restoredOne, /1 proposed edit/);
assert.match(restoredOne, /<span class="proposal-chip">Restored<\/span>/, "a restored row is marked");
assert.match(restoredOne, /1 held back by review/);
assert.match(allRestored, /<summary>Every held-back edit was restored<\/summary>/, "the disclosure stays after the last Restore so focus has a home");

assert.match(keptAll, /Review kept all 1 edit\./);
assert.doesNotMatch(keptAll, /resume-proposal__held-back/);
assert.match(unavailable, /Review unavailable; showing all edits\./);
for (const [label, markup] of [["a proposal", off], ["no changes", offNoChanges]]) {
  assert.doesNotMatch(markup, /held back|Review kept|Review unavailable|Restore|worthwhile/, `without a review nothing new renders (${label})`);
}
assert.match(offNoChanges, /No material changes were suggested\./);

// Restore must not remount the held-back list (focus would drop to the page): with
// every edit held back and after a Restore, the root and the list's child slot
// match, which is what React keeps a component instance by.
const require = createRequire(import.meta.url);
const realReact = require.resolve("react");
const tree = await esbuild.build({
  stdin: {
    contents: `export { ResumeProposalReview } from "../ResumeProposalReview.tsx"; export { ResumeHeldBackEdits } from "../ResumeHeldBackEdits.tsx";`,
    resolveDir,
    loader: "tsx"
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  logLevel: "silent",
  plugins: [{
    name: "state-stub",
    setup(api) {
      api.onResolve({ filter: /^react$/ }, (args) => args.namespace === "stub" ? { path: realReact } : { path: "react", namespace: "stub" });
      api.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ resolveDir, loader: "js", contents: `const R = require("react"); module.exports = { ...R, useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}] };` }));
    }
  }]
});
const treeModule = { exports: {} };
new Function("module", "exports", "require", tree.outputFiles[0].text)(treeModule, treeModule.exports, require);
const { ResumeProposalReview, ResumeHeldBackEdits } = treeModule.exports;
const resume = { header: null, sections: [{ id: "exp", type: "standard", heading: "Experience", items: [{ id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] }] }] };
const target = { sectionId: "exp", entryId: "acme", field: "bullet" };
const synonym = { id: "target-2", target: { ...target, bulletId: "b2" }, sectionHeading: "Experience", currentText: "Cut CI time.", proposedText: "Reduced CI time.", reason: "" };
const removal = { id: "target-3", kind: "remove", target: { ...target, bulletId: "b3" }, sectionHeading: "Experience", currentText: "Ran the book club.", proposedText: "", reason: "" };
const heldBack = [{ suggestion: synonym, reason: "LOW_IMPACT" }, { suggestion: removal, reason: "INCORRECT" }];
const noop = () => undefined;
const element = (suggestions, held, restored) => ResumeProposalReview({
  result: { polishOutcome: "NO_CHANGES", review: "REVIEWED", heldBack, suggestedChanges: [], missingKeywords: [], trimmedBulletGroups: 0, proposalBaselineText: "" },
  resume,
  decisions: { suggestions, decisions: {}, decided: 0, fitGapRows: [], termCoverage: { onResume: [], relatedOnly: [], notOnResume: [], limitations: [] }, isPending: () => true, accept: noop, discard: noop, revert: noop, applyAll: noop, discardAll: noop,
    heldBack: held, isRestored: (id) => restored.includes(id), restore: noop, documentReplaced: false },
  proposalStale: false,
  onHighlight: noop
});
const slot = (root) => root.props.children.findIndex((child) => child?.type === ResumeHeldBackEdits);
const beforeRestore = element([], heldBack, []);
const afterRestore = element([synonym], [heldBack[1]], ["target-2"]);
assert.equal(beforeRestore.type, "div", "an all-held-back result renders in the proposal root, not a fragment");
assert.equal(beforeRestore.props.className, "resume-proposal");
assert.equal(afterRestore.type, beforeRestore.type);
assert.ok(slot(beforeRestore) >= 0);
assert.equal(slot(afterRestore), slot(beforeRestore), "the held-back list keeps its slot across the first Restore");

console.log("resume proposal held-back probes passed");
