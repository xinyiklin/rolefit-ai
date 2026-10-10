// Sequencing and display rules for importing a PDF resume, without React.
//
//   node apps/role-fit-ai/src/lib/__evals__/resume-import-session.mjs
import assert from "node:assert/strict";
import { newBullet, newEntry, newSection } from "@typeset/engine/lib/resumeData.ts";
import { fieldKey } from "@typeset/engine/typeset/types.ts";
import { prepareResumePdfImport } from "../documentOpenFiles.ts";
import { importDocumentTitle, importFindingLocation, importSummary, runResumeImport } from "../resumeImportSession.ts";
import { PdfImportError } from "../../resume/pdfImport/importErrors.ts";

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const fakeResult = { data: { header: null, sections: [] }, style: {}, findings: [], audit: { ok: true, sourceWords: 3, unplacedWords: 0, lost: [], added: [] } };
const steps = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    read: async () => (calls.push("read"), new Uint8Array([1])),
    extract: async () => (calls.push("extract"), fakeResult),
    commit: async () => (calls.push("commit"), { snapshot: true }),
    isCurrent: () => true,
    ...overrides
  };
};

test("a readable PDF commits once and returns the snapshot", async () => {
  const run = steps();
  const outcome = await runResumeImport(run);
  assert.deepEqual(run.calls, ["read", "extract", "commit"]);
  assert.equal(outcome.kind, "committed");
  assert.deepEqual(outcome.snapshot, { snapshot: true });
});
test("a preflight refusal keeps its message and never extracts or commits", async () => {
  const run = steps({ read: async () => { throw new Error("Choose a .pdf file to import."); } });
  const outcome = await runResumeImport(run);
  assert.deepEqual(outcome, { kind: "refused", message: "Choose a .pdf file to import." });
  assert.deepEqual(run.calls, []);
});
test("an importer refusal shows its message; nothing is committed", async () => {
  const run = steps({ extract: async () => { throw new PdfImportError("no-text", "No selectable text."); } });
  assert.deepEqual(await runResumeImport(run), { kind: "refused", message: "No selectable text." });
  assert.ok(!run.calls.includes("commit"));
});
test("an unexpected extraction error never shows its internals", async () => {
  const run = steps({ extract: async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); } });
  const outcome = await runResumeImport(run);
  assert.equal(outcome.kind, "refused");
  assert.ok(!outcome.message.includes("undefined"));
  assert.ok(!run.calls.includes("commit"));
});
test("declining the replacement prompt changes nothing", async () => {
  assert.deepEqual(await runResumeImport(steps({ commit: async () => null })), { kind: "declined" });
});
test("a newer import supersedes an older one before it commits", async () => {
  let current = true;
  const run = steps({ extract: async () => { current = false; return fakeResult; }, isCurrent: () => current });
  assert.deepEqual(await runResumeImport(run), { kind: "superseded" });
  assert.ok(!run.calls.includes("commit"));
});

test("preflight accepts PDFs by name or type and refuses others before reading", async () => {
  let read = 0;
  const file = (name, type, size = 10) => ({ name, type, size, arrayBuffer: async () => (read += 1, new ArrayBuffer(size)) });
  assert.equal((await prepareResumePdfImport(file("Resume.PDF", ""))).byteLength, 10);
  assert.equal((await prepareResumePdfImport(file("download", "application/pdf"))).byteLength, 10);
  await assert.rejects(prepareResumePdfImport(file("resume.docx", "")), /Choose a \.pdf file/);
  await assert.rejects(prepareResumePdfImport(file("big.pdf", "", 11 * 1024 * 1024)), /10 MB/);
  assert.equal(read, 2);
});

test("titles, summaries, and finding locations", () => {
  assert.equal(importDocumentTitle("Jane_Doe_Resume.pdf"), "Jane_Doe_Resume");
  assert.equal(importDocumentTitle(".pdf"), "Resume");
  assert.equal(importSummary({ sourceWords: 412, unplacedWords: 0 }), "All 412 words from the PDF are in the document.");
  assert.equal(importSummary({ sourceWords: 412, unplacedWords: 3 }), "409 of 412 words are in the document; 3 are listed under Not placed.");

  const section = { ...newSection("standard", "Experience"), items: [] };
  const entry = { ...newEntry({ titleLeft: "<b>Acme Robotics</b>", titleRight: "2021 – Present" }), bullets: [newBullet("Shipped it.")] };
  section.items.push(entry);
  const data = { header: { visible: true, name: "Casey", contact: ["casey@example.test"] }, sections: [section] };
  const at = (src) => importFindingLocation(data, fieldKey(src));
  assert.deepEqual(at({ kind: "name" }), { label: "Name", present: true });
  assert.deepEqual(at({ kind: "contact", index: 0 }), { label: "Contact item 1", present: true });
  assert.deepEqual(at({ kind: "contact", index: 3 }), { label: "Contact item 4", present: false });
  assert.deepEqual(at({ kind: "entry", sectionId: section.id, entryId: entry.id, field: "titleRight" }), { label: "Experience › Acme Robotics › title, right side", present: true });
  assert.deepEqual(at({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: entry.bullets[0].id }), { label: "Experience › Acme Robotics › bullet 1", present: true });
  assert.deepEqual(at({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: "gone" }), { label: "Removed field", present: false });
  assert.deepEqual(importFindingLocation(data, null), { label: "Whole document", present: false });
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}
console.log(`resume-import-session: ${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
