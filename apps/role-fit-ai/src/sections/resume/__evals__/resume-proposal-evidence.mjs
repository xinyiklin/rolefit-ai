// A proposed edit on an experience or project entry folds its evidence under
// the row: the entry as it stands and the Profile text linked to it. The
// section is collapsed by default and changes nothing about Accept, Edit, or
// Discard; skills and summary rows state their scope instead.

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
        sections: [
          { id: "exp", type: "standard", heading: "Experience",
            items: [{ id: "acme", titleLeft: "<b>Acme</b>", titleRight: "2024", subtitleLeft: "Intern", subtitleRight: "", bullets: [
              { id: "b1", text: "Built <i>JavaScript</i> tools." }, { id: "b2", text: "Cut CI time." }
            ] }] },
          { id: "skl", type: "skills", heading: "Skills",
            items: [{ id: "lang", titleLeft: "Languages", titleRight: "", subtitleLeft: "Python", subtitleRight: "", bullets: [] }] }
        ]
      };
      const rewrite = { id: "t1", target: { sectionId: "exp", entryId: "acme", field: "bullet", bulletId: "b1" }, sectionHeading: "Experience",
        currentText: "Built JavaScript tools.", proposedText: "Built JavaScript tools for support.", reason: "",
        profileEvidence: "## Acme (internship, 2024)\\nAutomated release notes." };
      const bare = { ...rewrite, id: "t2", profileEvidence: undefined };
      const skills = { id: "t3", target: { sectionId: "skl", entryId: "lang", field: "skills" }, sectionHeading: "Skills",
        currentText: "Python", proposedText: "Python, SQL", reason: "" };
      const render = (suggestions) => renderToStaticMarkup(React.createElement(ResumeProposalReview, {
        result: { polishOutcome: "PROPOSAL", missingKeywords: [], trimmedBulletGroups: 0, proposalBaselineText: "", suggestedChanges: suggestions },
        resume,
        decisions: { suggestions, decisions: {}, decided: 0, isPending: () => true, accept: noop, discard: noop, revert: noop, applyAll: noop, discardAll: noop },
        proposalStale: false,
        onHighlight: noop
      }));
      export const withProfile = render([rewrite]);
      export const withoutProfile = render([bare]);
      export const skillsRow = render([skills]);
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
const { withProfile, withoutProfile, skillsRow } = module.exports;

assert.match(withProfile, /<details class="resume-proposal__evidence"><summary>Show evidence<\/summary>/, "a standard-entry row offers evidence");
assert.doesNotMatch(withProfile, /resume-proposal__evidence" open/, "evidence starts collapsed");
assert.match(withProfile, /Resume now · Acme · Intern</, "the entry is named by title and subtitle without inline marks, as it stands now");
assert.match(withProfile, /<ul><li>Built JavaScript tools\.<\/li><li>Cut CI time\.<\/li><\/ul>/, "the entry's current bullets are listed as plain text");
assert.match(withProfile, /Profile<\/p><p class="resume-proposal__evidence-text">## Acme \(internship, 2024\)\nAutomated release notes\.<\/p>/, "the linked Profile block follows, verbatim");
assert.match(withoutProfile, /No Profile heading links to this entry\./, "an unlinked entry says so instead of hiding the section");
assert.equal((withProfile.match(/> Accept</g) ?? []).length, 1, "the row keeps its single Accept");
assert.match(withProfile, /> Edit</);
assert.match(withProfile, /> Discard</);
assert.doesNotMatch(skillsRow, /resume-proposal__evidence/, "a skills row has no entry to show");
assert.match(skillsRow, /Evidence: the resume sections in scope and the whole Profile\./, "and states its scope in one line");

console.log("resume proposal evidence probes passed");
