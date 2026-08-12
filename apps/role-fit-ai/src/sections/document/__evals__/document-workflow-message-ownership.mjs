// Each settled document outcome has one visible owner.

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
      import { ResumeWorkflowRail } from "../../resume/ResumeWorkflowRail.tsx";
      import { CoverLetterReview } from "../../cover-letter/CoverLetterReview.tsx";

      const noop = () => undefined;
      const resume = {
        header: null,
        sections: [{
          id: "experience",
          type: "experience",
          heading: "Experience",
          items: [{
            id: "role",
            titleLeft: "Engineer",
            titleRight: "",
            subtitleLeft: "",
            subtitleRight: "",
            bullets: [{ id: "bullet", text: "Built reliable software." }]
          }]
        }]
      };
      const baseDecisions = {
        decisions: {},
        proposalKey: "proposal",
        suggestions: [],
        outstanding: 0,
        decided: 0,
        total: 0,
        decisionsSettled: true,
        isPending: () => false,
        accept: noop,
        discard: noop,
        revert: noop,
        applyAll: noop,
        discardAll: noop
      };
      const resumeBase = {
        resume,
        proposalStale: false,
        jobTarget: { role: "Engineer", company: "Example" },
        resumeReady: true,
        jobReady: true,
        resumePolishProviderReady: true,
        selectedSectionCount: 1,
        polishSectionCount: 1,
        isPolishing: false,
        onRetryPolish: noop,
        onStop: noop,
        onHighlight: noop
      };
      const preflight = {
        canTailor: true,
        resolved: { role: "Engineer", company: "Example" },
        missingFields: [],
        blockers: [],
        privateSlots: [],
        values: {}
      };
      const coverBase = {
        words: 100,
        pageCount: 1,
        currentText: "A complete current cover letter with enough authored content for review.",
        preflight,
        appliedResult: null,
        canRestore: false,
        isTailoring: false,
        resumeReady: true,
        jobReady: true,
        providerReady: true,
        slotAnswers: {},
        onDetailChange: noop,
        onSlotAnswerChange: noop,
        onTailor: noop,
        onAcceptProposal: noop,
        onDiscardProposal: noop,
        onRestore: noop
      };

      export function renderResumeFailure() {
        return renderToStaticMarkup(React.createElement(ResumeWorkflowRail, {
          ...resumeBase,
          result: null,
          decisions: baseDecisions,
          progress: { polish: { status: "failed", errorHeadline: "Provider unavailable", error: "Connect the provider." } },
          status: "Provider unavailable: Connect the provider."
        }));
      }

      export function renderResumeProposal() {
        const suggestion = {
          id: "target-1",
          target: { sectionId: "experience", entryId: "role", field: "bullet", bulletId: "bullet" },
          sectionHeading: "Experience",
          currentText: "Built reliable software.",
          proposedText: "Built reliable production software.",
          reason: "Adds supported scope."
        };
        return renderToStaticMarkup(React.createElement(ResumeWorkflowRail, {
          ...resumeBase,
          result: {
            polishOutcome: "PROPOSAL",
            suggestedChanges: [suggestion],
            proposalBaselineText: "resume",
            changeSummary: ["Clarified scope"]
          },
          decisions: {
            ...baseDecisions,
            suggestions: [suggestion],
            outstanding: 1,
            total: 1,
            decisionsSettled: false,
            isPending: () => true
          },
          progress: { polish: { status: "done", note: "1 edit ready", noteTone: "ok" } },
          status: "1 edit ready"
        }));
      }

      export function renderResumeStopped() {
        return renderToStaticMarkup(React.createElement(ResumeWorkflowRail, {
          ...resumeBase,
          result: null,
          decisions: baseDecisions,
          progress: {
            polish: {
              status: "stopped",
              errorHeadline: "Stopped",
              error: "Polish stopped. Your resume is unchanged."
            }
          },
          status: "Polish stopped. Your resume is unchanged."
        }));
      }

      export function renderResumeSettled(polishOutcome, status) {
        return renderToStaticMarkup(React.createElement(ResumeWorkflowRail, {
          ...resumeBase,
          result: {
            polishOutcome,
            suggestedChanges: [],
            proposalBaselineText: "resume"
          },
          decisions: baseDecisions,
          progress: { polish: { status: "done" } },
          status
        }));
      }

      export function renderCoverFailure() {
        return renderToStaticMarkup(React.createElement(CoverLetterReview, {
          ...coverBase,
          proposal: null,
          failure: { kind: "error", headline: "Provider unavailable", detail: "Connect the provider." },
          status: "No changes were applied. Your current letter is unchanged."
        }));
      }

      export function renderCoverProposal(stale = false) {
        return renderToStaticMarkup(React.createElement(CoverLetterReview, {
          ...coverBase,
          proposal: {
            stale,
            resumeChanged: false,
            result: {
              coverLetterText: "A grounded proposed cover letter with enough content for review.",
              repaired: false,
              warnings: [],
              bodyParagraphs: [{ text: "A grounded paragraph.", evidenceIds: ["source_letter"] }],
              evidenceUsed: []
            }
          },
          failure: null,
          status: "Proposal ready for Engineer at Example."
        }));
      }

      export function renderCoverPolishing() {
        return renderToStaticMarkup(React.createElement(CoverLetterReview, {
          ...coverBase,
          isTailoring: true,
          proposal: null,
          failure: null,
          status: "Polishing this letter…"
        }));
      }
    `,
    loader: "tsx",
    resolveDir
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent"
});

const require = createRequire(import.meta.url);
const testModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
  require,
  testModule,
  testModule.exports
);
const rendered = testModule.exports;

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [name, html] of [
  ["resume failure", rendered.renderResumeFailure()],
  ["cover failure", rendered.renderCoverFailure()]
]) {
  assert.equal(occurrences(html, "Connect the provider."), 1, `${name} shows the failure detail once`);
  assert.doesNotMatch(html, /workflow-rail__description/, `${name} does not restate the failed outcome in its header`);
  assert.doesNotMatch(html, /aria-label="Workflow readiness"/, `${name} hides already-settled readiness rows`);
  assert.doesNotMatch(html, /workflow-rail__status/, `${name} does not repeat its structured failure as a status line`);
}

for (const [name, html, announcement] of [
  ["resume proposal", rendered.renderResumeProposal(), "1 edit ready"],
  ["cover proposal", rendered.renderCoverProposal(), "Proposal ready for Engineer at Example."]
]) {
  assert.doesNotMatch(html, /workflow-rail__status/, `${name} does not show a duplicate proposal receipt`);
  assert.match(
    html,
    new RegExp(`class="sr-only"[^>]*>${escapeRegExp(announcement)}<`),
    `${name} keeps one non-visual live announcement`
  );
}

for (const [outcome, message] of [
  ["NO_CHANGES", "No safe material changes were suggested."],
  ["WITHHELD", "The generated edits could not be verified. Your resume is unchanged."]
]) {
  const html = rendered.renderResumeSettled(outcome, message);
  assert.equal(occurrences(html, message), 1, `${outcome} shows its settled result once`);
  assert.doesNotMatch(html, /workflow-rail__status/, `${outcome} has no duplicate rail receipt`);
}

{
  const announcement = "Polishing this letter…";
  const html = rendered.renderCoverPolishing();
  assert.doesNotMatch(html, /workflow-rail__status/, "cover polishing has no visible duplicate progress line");
  assert.match(
    html,
    new RegExp(`class="sr-only"[^>]*>${escapeRegExp(announcement)}<`),
    "cover polishing retains one non-visual live announcement"
  );
}

{
  const html = rendered.renderCoverProposal(true);
  const message = "The letter, job, Guidance, or polishing instructions changed. Polish again for the current inputs.";
  assert.doesNotMatch(html, /workflow-rail__description/, "a stale cover proposal leaves its explanation to the proposal body");
  assert.equal(occurrences(html, message), 1, "a stale cover proposal explains recovery once");
  assert.doesNotMatch(html, /Proposal ready for Engineer at Example\./, "a stale cover proposal does not announce the superseded ready receipt");
}

{
  const message = "Polish stopped. Your resume is unchanged.";
  const html = rendered.renderResumeStopped();
  assert.equal(occurrences(html, message), 1, "resume stopped shows its outcome once");
  assert.doesNotMatch(html, /workflow-rail__status/, "resume stopped has no duplicate rail receipt");
}

console.log("Document workflow message ownership passed");
