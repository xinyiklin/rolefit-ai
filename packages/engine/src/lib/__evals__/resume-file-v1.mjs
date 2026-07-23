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
  readResumeFile,
  resumeFileName,
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

// ----- invalid-document: shape, per-level strictness, and primitive types -----

function mutated(mutate) {
  const clone = structuredClone(saved);
  mutate(clone);
  return clone;
}

function firstBulletOf(file) {
  const entry = file.document.sections.flatMap((section) => section.items).find((item) => item.bullets.length);
  assert.ok(entry, "the starter resume provides at least one bullet");
  return entry.bullets[0];
}

expectError(mutated((file) => { file.document.sections[0].type = "custom"; }), "invalid-document");
expectError(mutated((file) => { file.document.contact = "a@b.com"; }), "invalid-document");
expectError(mutated((file) => { file.document.sections = {}; }), "invalid-document");
expectError(mutated((file) => { file.document.sections[0].items = null; }), "invalid-document");
expectError(mutated((file) => { file.document.sections[0].items[0].bullets = "text"; }), "invalid-document");

// Unknown keys are rejected at every depth, including reloaded session ids.
expectError(mutated((file) => { file.document.notes = []; }), "invalid-document");
expectError(mutated((file) => { file.document.sections[0].collapsed = false; }), "invalid-document");
expectError(mutated((file) => { file.document.sections[0].items[0].id = "entry-1"; }), "invalid-document");
expectError(mutated((file) => { firstBulletOf(file).id = "bullet-1"; }), "invalid-document");

// Missing keys are rejected at every depth.
expectError(mutated((file) => { delete file.document.name; }), "invalid-document");
expectError(mutated((file) => { delete file.document.sections[0].heading; }), "invalid-document");
expectError(mutated((file) => { delete file.document.sections[0].items[0].titleRight; }), "invalid-document");
expectError(mutated((file) => { delete firstBulletOf(file).text; }), "invalid-document");

// Wrong primitive types.
expectError(mutated((file) => { file.document.name = 42; }), "invalid-document");
expectError(mutated((file) => { file.document.contact[0] = 12; }), "invalid-document");
expectError(mutated((file) => { firstBulletOf(file).text = null; }), "invalid-document");

// ----- invalid-style: bounds, enums, and the contact-divider rule -----

expectError(mutated((file) => { file.style.baseFontSizePt = 7.5; }), "invalid-style");
expectError(mutated((file) => { file.style.baseFontSizePt = 12.5; }), "invalid-style");
expectError(mutated((file) => { file.style.letterSpacingPt = -1; }), "invalid-style");
expectError(mutated((file) => { file.style.lineHeight = "1.2"; }), "invalid-style");
expectError(mutated((file) => { file.style.pageMarginTopPt = 1_000_000; }), "invalid-style");
expectError(mutated((file) => { file.style.fontFamily = "times"; }), "invalid-style");
expectError(mutated((file) => { file.style.headingCase = "caps"; }), "invalid-style");
expectError(mutated((file) => { file.style.bodyAlign = "top"; }), "invalid-style");
expectError(mutated((file) => { file.style.headerAlign = "justify"; }), "invalid-style");
expectError(mutated((file) => { file.style.headingAlign = "justify"; }), "invalid-style");
expectError(mutated((file) => { file.style.nameSize = "medium"; }), "invalid-style");
expectError(mutated((file) => { file.style.pageMargins = "tight"; }), "invalid-style");
expectError(mutated((file) => { file.style.sectionRule = "yes"; }), "invalid-style");
expectError(mutated((file) => { file.style.contactDivider = ""; }), "invalid-style");
expectError(mutated((file) => { file.style.contactDivider = "———"; }), "invalid-style");

// The 2-character divider ceiling is inclusive.
const twoCharDivider = mutated((file) => { file.style.contactDivider = "•—"; });
assert.equal(parseResumeFile(JSON.stringify(twoCharDivider)).documentStyle.contactDivider, "•—");

// ----- binary inputs: Uint8Array, ArrayBuffer, File, and non-UTF-8 bytes -----

function expectBinaryError(input, code) {
  assert.throws(
    () => parseResumeFile(input),
    (error) => error instanceof ResumeFileError && error.code === code
  );
}

const encodedBytes = new TextEncoder().encode(serialized);
const fromBytes = parseResumeFile(encodedBytes);
assert.deepEqual(
  JSON.parse(serializeResumeFile(fromBytes.data, { ...fromBytes.documentStyle, zoom: DOC_STYLE_DEFAULTS.zoom })),
  saved
);

const arrayBufferCopy = encodedBytes.buffer.slice(
  encodedBytes.byteOffset,
  encodedBytes.byteOffset + encodedBytes.byteLength
);
assert.deepEqual(parseResumeFile(arrayBufferCopy).documentStyle, fromBytes.documentStyle);

expectBinaryError(Uint8Array.of(0xff, 0xfe, 0xfd), "invalid-json");
expectBinaryError(new Uint8Array(MAX_RESUME_FILE_BYTES + 1), "too-large");
expectBinaryError(new ArrayBuffer(MAX_RESUME_FILE_BYTES + 1), "too-large");

const readBack = await readResumeFile(new File([serialized], "starter.resume"));
assert.deepEqual(
  JSON.parse(serializeResumeFile(readBack.data, { ...readBack.documentStyle, zoom: DOC_STYLE_DEFAULTS.zoom })),
  saved
);
await assert.rejects(
  readResumeFile(new File(["{"], "broken.resume")),
  (error) => error instanceof ResumeFileError && error.code === "invalid-json"
);
await assert.rejects(
  readResumeFile(new File([new Uint8Array(MAX_RESUME_FILE_BYTES + 1)], "big.resume")),
  (error) => error instanceof ResumeFileError && error.code === "too-large"
);

// ----- resumeFileName: safe download naming -----

assert.equal(resumeFileName("My Resume"), "My Resume.resume");
assert.equal(resumeFileName("My Resume.resume"), "My Resume.resume", "an existing extension is not doubled");
assert.equal(resumeFileName("My Resume.RESUME"), "My Resume.resume", "the extension strip is case-insensitive");
assert.equal(resumeFileName("<b>Jane</b> <i>Doe</i>.resume"), "Jane Doe.resume", "inline b/i/u markup is stripped");
assert.equal(resumeFileName('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j.resume", "path and shell separators become spaces");
assert.equal(resumeFileName("tab\tand null"), "tab and null.resume", "control characters become spaces");
assert.equal(resumeFileName("Name...   "), "Name.resume", "trailing dots and spaces are trimmed");
assert.equal(resumeFileName("x".repeat(200)), `${"x".repeat(120)}.resume`, "the base name caps at 120 characters");
assert.equal(resumeFileName(""), "Untitled resume.resume");
assert.equal(resumeFileName("<b></b>. ."), "Untitled resume.resume", "a name that sanitizes to nothing falls back");

console.log(
  "resume file v1: round-trip, strict rejection, style-bound, binary-input, and filename checks passed"
);
