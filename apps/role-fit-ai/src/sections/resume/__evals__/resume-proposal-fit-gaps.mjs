// The proposal rails show one folded Fit gaps list when the run was sent gaps,
// naming where each addressed gap is addressed, and the Resume rail folds the
// posting's recognized terms by whether the resume uses them. Neither renders
// anything when it has nothing to say.

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
      import { FitGapStatements } from "../../document/FitGapStatements.tsx";

      const noop = () => undefined;
      const resume = {
        header: null,
        sections: [{ id: "exp", type: "standard", heading: "Experience",
          items: [{ id: "acme", titleLeft: "Acme", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
            { id: "b1", text: "Wrote PostgreSQL migration scripts." }
          ] }] }]
      };
      const rewrite = { id: "target-1", target: { sectionId: "exp", entryId: "acme", bulletId: "b1", field: "bullet" }, sectionHeading: "Experience",
        currentText: "Wrote PostgreSQL migration scripts.", proposedText: "Wrote PostgreSQL migrations for the billing schema.", reason: "" };
      const noTerms = { onResume: [], relatedOnly: [], notOnResume: [], limitations: [] };
      const term = (keyword) => ({ keyword, phrase: keyword, category: "required" });
      const render = ({ result = {}, fitGapRows = [], termCoverage = noTerms, suggestions = [rewrite] } = {}) => renderToStaticMarkup(React.createElement(ResumeProposalReview, {
        result: { polishOutcome: "PROPOSAL", missingKeywords: [], proposalBaselineText: "", suggestedChanges: [rewrite], ...result },
        resume,
        decisions: { suggestions, decisions: {}, decided: 0, fitGapRows, termCoverage, isPending: () => true, accept: noop, discard: noop, revert: noop, applyAll: noop, discardAll: noop,
          heldBack: [], isRestored: () => false, restore: noop, documentReplaced: false },
        proposalStale: false,
        onHighlight: noop
      }));
      const findings = { earlierVersion: false, matches: [], gaps: [{ id: "gap-1", jobExcerpt: "Operate Kubernetes clusters" }, { id: "gap-2", jobExcerpt: "Own PostgreSQL migrations" }] };
      const rows = [
        { id: "gap-1", jobExcerpt: "Operate Kubernetes clusters", status: "NO_EVIDENCE", suggestions: [] },
        { id: "gap-2", jobExcerpt: "Own PostgreSQL migrations", status: "ADDRESSED", suggestions: [rewrite, { ...rewrite, id: "target-9" }] }
      ];
      export const withGaps = render({ result: { fitFindings: findings }, fitGapRows: rows });
      export const earlier = render({ result: { fitFindings: { ...findings, earlierVersion: true } }, fitGapRows: rows });
      export const noChanges = render({ result: { polishOutcome: "NO_CHANGES", suggestedChanges: [], fitFindings: findings }, suggestions: [],
        fitGapRows: rows.map((row) => ({ ...row, status: row.status === "ADDRESSED" ? "NOT_REPORTED" : row.status, suggestions: [] })) });
      export const plain = render();
      export const terms = render({ termCoverage: { onResume: [term("python"), term("postgresql")], relatedOnly: [term("ci/cd")], notOnResume: [], limitations: ["x"] } });
      export const cover = renderToStaticMarkup(React.createElement(FitGapStatements, { earlierVersion: false, rows: [
        { id: "gap-1", jobExcerpt: "Screen-reader support", status: "NOT_REPORTED", where: [] },
        { id: "gap-2", jobExcerpt: "Python services", status: "ADDRESSED", where: ["paragraph 2", "paragraph 3"] }
      ] }));
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
const { withGaps, earlier, noChanges, plain, terms, cover } = module.exports;

assert.match(withGaps, /<details class="proposal-fit-gaps"><summary>What this proposal did about Fit gaps<\/summary>/, "folded by default, with no count that reads as a score");
assert.match(withGaps, /<blockquote>Operate Kubernetes clusters<\/blockquote><p class="proposal-fit-gaps__status"><strong>No evidence<\/strong> · your resume and Background don&#x27;t support it<\/p>/);
assert.match(withGaps, /<strong>Addressed<\/strong> · in Experience · Acme<\/p>/, "an addressed gap names where its edits are, once per place");
assert.match(withGaps, /not a check of your evidence/, "the statements are never presented as verification");
assert.doesNotMatch(withGaps, /earlier version/);
assert.match(earlier, /From a Fit Assessment of an earlier version of your resume or Background\./);
assert.match(noChanges, /No material changes were suggested\.[\s\S]*What this proposal did about Fit gaps[\s\S]*<strong>Not reported<\/strong><\/p>/, "the no-changes outcome still states each gap");
assert.doesNotMatch(plain, /proposal-fit-gaps|resume-proposal__terms/, "without findings or recognized terms nothing new renders");
assert.match(terms, /<details class="resume-proposal__terms"><summary>Posting terms and your resume<\/summary>/);
assert.match(terms, /<dt>On your resume<\/dt><dd>python, postgresql<\/dd>/);
assert.match(terms, /<dt>Only a related term<\/dt><dd>ci\/cd<\/dd>/);
assert.doesNotMatch(terms, /Not on your resume/, "an empty group is left out");
assert.doesNotMatch(terms, /%|score/i, "coverage carries no score");
assert.match(cover, /<strong>Addressed<\/strong> · in paragraph 2; paragraph 3/);
assert.match(cover, /<strong>Not reported<\/strong><\/p>/);

console.log("Fit gaps and terminology coverage render checks passed.");
