// Offline, deterministic probe: Typeset's browser autosave is the same strict
// document the app writes to disk, not a private shape.
//
// This replaces the retired autosave-migration probe. There is no longer a
// retired payload to rewrite: a draft either parses as a v1 resume or it is
// discarded, so what needs guarding is that round trip and its refusals.
//
//   node --experimental-strip-types src/__evals__/resume-autosave.mjs
import assert from "node:assert/strict";

import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import {
  ResumeFileError,
  parseResumeFile,
  serializeResumeFile
} from "@typeset/engine/lib/resumeFile.ts";
import { buildStarterResume } from "@typeset/engine/sampleResume.ts";

const autosave = serializeResumeFile(buildStarterResume(), DOC_STYLE_DEFAULTS);

// What the app stores is what it can restore: the same parser guards both.
const restored = parseResumeFile(autosave);
assert.equal(
  restored.data.sections.length,
  buildStarterResume().sections.length,
  "a restored draft carries the document it was saved from"
);
assert.deepEqual(
  restored.documentStyle,
  parseResumeFile(serializeResumeFile(restored.data, { ...DOC_STYLE_DEFAULTS, ...restored.documentStyle }))
    .documentStyle,
  "re-saving a restored draft is stable"
);

// A draft that is not a v1 document is refused rather than coerced: browser
// storage is editable by hand and shared with anything else on the origin.
for (const [label, payload] of [
  ["plain text", "Candidate Name\ncandidate@example.com"],
  ["truncated json", autosave.slice(0, 40)],
  ["a document without its style", JSON.stringify({ ...JSON.parse(autosave), style: undefined })],
  [
    "a style missing a field",
    (() => {
      const file = JSON.parse(autosave);
      delete file.style.bulletGapPt;
      return JSON.stringify(file);
    })()
  ]
]) {
  assert.throws(
    () => parseResumeFile(payload),
    (error) => error instanceof ResumeFileError,
    `${label} is refused as an autosaved draft`
  );
}

console.log("Typeset resume autosave: strict round trip and 4 malformed-draft refusals passed");
