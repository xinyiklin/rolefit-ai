import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DOC_STYLE_DEFAULTS } from "../../../../../packages/engine/src/lib/documentStyle.ts";
import { parseResumeFile, serializeResumeFile } from "../../../../../packages/engine/src/lib/resumeFile.ts";
import { createBlankResumeData } from "../blankResume.ts";
import { resumeDocumentVersion } from "../resumeDocumentVersion.ts";
import { serializeResumeData } from "../resumeText.ts";

const first = createBlankResumeData();
const second = createBlankResumeData();

assert.notEqual(first, second, "each blank resume owns a fresh document object");
assert.notEqual(first.header, second.header, "each blank resume owns a fresh editable header");
assert.deepEqual(first, {
  header: { visible: true, name: "", contact: [] },
  sections: []
}, "a blank resume exposes one caret-bearing name field without visible sample content");
assert.equal(serializeResumeData(first), "", "blank structured content is not meaningful resume text");

const roundTrip = parseResumeFile(serializeResumeFile(first, DOC_STYLE_DEFAULTS));
assert.deepEqual(roundTrip.data, first, "the strict .resume codec preserves the explicit blank header");

const oversizedEditorValue = {
  ...first,
  header: { ...first.header, name: "x".repeat(10_001) }
};
assert.doesNotThrow(
  () => resumeDocumentVersion(oversizedEditorValue, DOC_STYLE_DEFAULTS),
  "replacement versioning never applies save-time codec limits during render"
);
assert.notEqual(
  resumeDocumentVersion(first, DOC_STYLE_DEFAULTS),
  resumeDocumentVersion(oversizedEditorValue, DOC_STYLE_DEFAULTS),
  "replacement versioning detects document content changes"
);

const adapterSource = readFileSync(new URL("../../hooks/useResumeEditor.ts", import.meta.url), "utf8");
assert.match(
  adapterSource,
  /useMemo\(createBlankResumeData, \[\]\)/,
  "the RoleFit editor initializes from one stable blank document"
);
assert.match(
  adapterSource,
  /trimmed \? parseResumeData\(text, sourceText\) : createBlankResumeData\(\)/,
  "empty text seeding creates a fresh blank document instead of null"
);
assert.match(
  adapterSource,
  /const editedResume = editor\.editedResume \?\? initialResume/,
  "the RoleFit adapter exposes a non-null resume invariant"
);

console.log("Blank resume document probes passed");
