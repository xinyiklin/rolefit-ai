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

import {
  AUTOSAVE_KEY,
  DOCUMENT_TITLE_KEY,
  UNREADABLE_AUTOSAVE_KEY,
  draftReplacedElsewhere,
  restoreAutosavedDraft
} from "../autosaveDraft.ts";

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

// The app's restore path. A refused draft is kept under its own key, because
// the starter resume autosaves over AUTOSAVE_KEY as soon as the app opens.
const storage = (entries) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value)
  };
};

const empty = storage({});
assert.deepEqual(restoreAutosavedDraft(empty), { kind: "none" }, "no draft restores nothing");
assert.equal(empty.map.size, 0, "restoring nothing writes nothing");

const titled = storage({ [AUTOSAVE_KEY]: autosave, [DOCUMENT_TITLE_KEY]: "Spring resume" });
const restoredDraft = restoreAutosavedDraft(titled);
assert.equal(restoredDraft.kind, "restored");
assert.equal(restoredDraft.title, "Spring resume", "a restored draft carries its title");
assert.equal(restoredDraft.parsed.data.sections.length, buildStarterResume().sections.length);
assert.equal(titled.map.has(UNREADABLE_AUTOSAVE_KEY), false, "a readable draft is not quarantined");

const refused = "Candidate Name\ncandidate@example.com";
const broken = storage({ [AUTOSAVE_KEY]: refused });
assert.deepEqual(restoreAutosavedDraft(broken), { kind: "unreadable", kept: true });
assert.equal(broken.map.get(UNREADABLE_AUTOSAVE_KEY), refused, "the refused draft is kept byte for byte");
assert.equal(broken.map.get(AUTOSAVE_KEY), refused, "restoring does not itself rewrite the draft");

const full = storage({ [AUTOSAVE_KEY]: refused });
full.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
assert.deepEqual(
  restoreAutosavedDraft(full),
  { kind: "unreadable", kept: false },
  "a refused draft that storage will not keep is reported as lost, not thrown"
);

// Tabs share the draft slot. Opening a second tab re-saves the draft it
// restored byte for byte, which fires no storage event in the first tab.
const reopened = parseResumeFile(autosave);
assert.equal(serializeResumeFile(reopened.data, reopened.documentStyle), autosave, "a restored draft re-saves identically");
assert.equal(draftReplacedElsewhere({ key: AUTOSAVE_KEY, newValue: autosave }, autosave), false, "this tab's own draft is still kept");
assert.equal(draftReplacedElsewhere({ key: AUTOSAVE_KEY, newValue: `${autosave} ` }, autosave), true, "another tab's draft replaced this one");
assert.equal(draftReplacedElsewhere({ key: AUTOSAVE_KEY, newValue: null }, autosave), true, "a removed draft is no longer kept");
assert.equal(draftReplacedElsewhere({ key: AUTOSAVE_KEY, newValue: autosave }, null), true, "a tab that has not autosaved yet keeps nothing in the slot");
assert.equal(draftReplacedElsewhere({ key: null, newValue: null }, autosave), true, "a cleared store keeps nothing");
assert.equal(draftReplacedElsewhere({ key: DOCUMENT_TITLE_KEY, newValue: "Other" }, autosave), false, "other keys do not replace the draft");

console.log("Typeset resume autosave: strict round trip, 4 malformed-draft refusals, unreadable-draft keeping, and cross-tab replacement passed");
