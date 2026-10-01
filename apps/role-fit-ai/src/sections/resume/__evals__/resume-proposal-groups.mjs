// The resume proposal review groups rows by operation, offers group decisions
// only when there is more than one group, and gives removals and reorders
// their own presentation without text editing.

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
      const bullets = [
        { id: "b1", text: "Built JavaScript tools." },
        { id: "b2", text: "Ran the book club." },
        { id: "b3", text: "Cut CI time." }
      ];
      const resume = {
        header: null,
        sections: [{ id: "exp", type: "standard", heading: "Experience",
          items: [{ id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets }] }]
      };
      const target = { sectionId: "exp", entryId: "acme", field: "bullet" };
      const rewrite = { id: "target-1", target: { ...target, bulletId: "b1" }, sectionHeading: "Experience",
        currentText: "Built JavaScript tools.", proposedText: "Built JavaScript tools for support.", reason: "" };
      const removal = { id: "target-2", kind: "remove", target: { ...target, bulletId: "b2" }, sectionHeading: "Experience",
        currentText: "Ran the book club.", proposedText: "", reason: "Off-target.", originalOrder: ["b1", "b2", "b3"] };
      const reorder = { id: "order-1", kind: "reorder", target, sectionHeading: "Experience",
        currentText: "", proposedText: "", reason: "Lead with CI.", originalOrder: ["b1", "b2", "b3"], proposedOrder: ["b3", "b1", "b2"] };
      const render = (suggestions) => renderToStaticMarkup(React.createElement(ResumeProposalReview, {
        result: { polishOutcome: "PROPOSAL", missingKeywords: [], trimmedBulletGroups: 0, proposalBaselineText: "", suggestedChanges: suggestions },
        resume,
        decisions: { suggestions, decisions: {}, decided: 0, isPending: () => true, accept: noop, discard: noop, revert: noop, applyAll: noop, discardAll: noop },
        proposalStale: false,
        onHighlight: noop
      }));
      export const grouped = render([reorder, removal, rewrite]);
      export const single = render([rewrite]);
      export const removalOnly = render([removal]);
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
const { grouped, single, removalOnly } = module.exports;

const headings = [...grouped.matchAll(/<h3[^>]*>([A-Za-z]+) <span>(\d+)<\/span><\/h3>/g)].map((match) => `${match[1]} ${match[2]}`);
assert.deepEqual(headings, ["Rewrite 1", "Remove 1", "Reorder 1"], "groups follow operation order and empty groups are hidden");
assert.equal((grouped.match(/resume-proposal__group-actions/g) ?? []).length, 3, "each group offers its own decision when several groups exist");
assert.match(grouped, /Accept 1<span class="sr-only"> remove<\/span>/, "a group action names its group for assistive tech");
assert.equal((grouped.match(/> Edit</g) ?? []).length, 1, "only the text rewrite can be edited before acceptance");
assert.match(grouped, /<ol class="resume-proposal__order"><li><span>Cut CI time\.<\/span><span class="resume-proposal__moved">was 3<\/span><\/li><li><span>Built JavaScript tools\.<\/span><span class="resume-proposal__moved">was 1<\/span>/,
  "a reorder lists bullets in the proposed order and marks moves");
assert.match(removalOnly, /resume-proposal__original is-removed/, "a removal shows the bullet it cuts");
assert.doesNotMatch(removalOnly, /Proposed/, "a removal has no proposed text");
assert.doesNotMatch(single, /resume-proposal__group-actions/, "a single group leaves bulk decisions to the footer");

console.log("resume proposal group probes passed");
