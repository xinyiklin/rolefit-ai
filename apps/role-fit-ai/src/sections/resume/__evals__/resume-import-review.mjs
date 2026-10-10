// The import review rail: a second import read or refused while a review is
// open is reported inside that review, which keeps its own controls; without a
// review, a refusal takes the rail.

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
      import { ResumeImportReview } from "../ResumeImportReview.tsx";

      const noop = () => undefined;
      const review = {
        fileName: "Jane_Doe.pdf",
        previewUrl: "blob:review",
        findings: [],
        audit: { ok: true, latentMarkup: false, sourceWords: 12, unplacedWords: 0, lost: [], added: [] },
        source: "local"
      };
      const render = (status, current) => renderToStaticMarkup(React.createElement(ResumeImportReview, {
        status,
        review: current,
        resume: { header: null, sections: [] },
        existingVariantNames: [],
        variantFileName: (label) => label ? label + ".resume" : "",
        saving: false,
        onSave: noop,
        onDiscard: noop,
        onDismissRefusal: noop,
        onViewOriginal: noop,
        onHighlight: noop,
        interpretation: {
          label: "Claude CLI · Sonnet 5.5", ready: true, blocker: "", state: { status: "idle" },
          onInterpret: noop, onStop: noop, onDismiss: noop, onShowLocal: noop
        }
      }));
      const refused = { kind: "refused", fileName: "notes.pdf", message: "This file is not a PDF. Choose a .pdf resume." };
      export const refusedInReview = render(refused, review);
      export const readingInReview = render({ kind: "reading", fileName: "Sam_Roe.pdf" }, review);
      export const quietReview = render({ kind: "idle" }, review);
      export const refusedAlone = render(refused, null);
    `,
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
    name: "no-original-preview",
    setup(build) {
      build.onResolve({ filter: /ResumeImportOriginal$/ }, () => ({ path: "original", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default function Original() { return null; }", loader: "js" }));
    }
  }]
});
const module = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { refusedInReview, readingInReview, quietReview, refusedAlone } = module.exports;

assert.match(refusedInReview, /<strong>notes\.pdf was not imported<\/strong>/, "a refusal during a review names the refused file");
assert.match(refusedInReview, /This file is not a PDF\. Choose a \.pdf resume\. This review is unchanged\./);
assert.match(refusedInReview, />Dismiss</, "the in-review refusal can be dismissed");
assert.match(refusedInReview, /Save variant/, "the open review keeps its own controls");
assert.match(refusedInReview, /Discard import/);
assert.match(refusedInReview, /<p class="workflow-rail__eyebrow">Import review<\/p>/, "a refusal during a review does not take over the rail");

assert.match(readingInReview, /Reading Sam_Roe\.pdf on this computer…/, "a second import being read is reported inside the review");
assert.match(readingInReview, /Save variant/);

assert.doesNotMatch(quietReview, /was not imported|Reading .* on this computer/);

assert.match(refusedAlone, /<p class="workflow-rail__eyebrow">Import stopped<\/p>/, "without a review, a refusal takes the rail");
assert.match(refusedAlone, /This file is not a PDF/);

console.log("resume import review rail probes passed");
