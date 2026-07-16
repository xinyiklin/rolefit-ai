// Strict editable-file contract guard.
// Run: node --experimental-strip-types src/lib/__evals__/resume-file-v1.mjs

import assert from "node:assert/strict";

import { DOC_STYLE_DEFAULTS } from "../documentStyle.ts";
import { buildStarterResume } from "../../sampleResume.ts";
import {
  MAX_RESUME_FILE_BYTES,
  RESUME_FILE_SCHEMA_VERSION,
  ResumeFileError,
  parseResumeFile,
  serializeResumeFile
} from "../resumeFile.ts";

const starter = buildStarterResume();
const serialized = serializeResumeFile(starter, DOC_STYLE_DEFAULTS);
const saved = JSON.parse(serialized);

assert.equal(RESUME_FILE_SCHEMA_VERSION, 1);
assert.equal(saved.schemaVersion, 1);
assert.equal(Object.hasOwn(saved.style, "boldTitles"), false);
assert.match(saved.document.sections[0].items[0].titleLeft, /^<b>/);

const parsed = parseResumeFile(serialized);
const roundTripped = JSON.parse(
  serializeResumeFile(parsed.data, { ...parsed.documentStyle, zoom: DOC_STYLE_DEFAULTS.zoom })
);
assert.deepEqual(roundTripped, saved);

function assertNoSessionIds(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSessionIds(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  assert.equal(Object.hasOwn(value, "id"), false);
  for (const child of Object.values(value)) assertNoSessionIds(child);
}

assertNoSessionIds(saved.document);

function expectError(input, code) {
  assert.throws(
    () => parseResumeFile(typeof input === "string" ? input : JSON.stringify(input)),
    (error) => error instanceof ResumeFileError && error.code === code
  );
}

for (const schemaVersion of [0, 2, 3, 99]) {
  expectError({ ...saved, schemaVersion }, "unsupported-version");
}

expectError({ ...saved, prototypeField: true }, "invalid-format");

const missingStyleField = structuredClone(saved);
delete missingStyleField.style.entryEndIndentPt;
expectError(missingStyleField, "invalid-style");

const legacyStyleField = structuredClone(saved);
legacyStyleField.style.boldTitles = true;
expectError(legacyStyleField, "invalid-style");

expectError("{", "invalid-json");
expectError(" ".repeat(MAX_RESUME_FILE_BYTES + 1), "too-large");

console.log("resume file v1: round-trip and strict rejection checks passed");
