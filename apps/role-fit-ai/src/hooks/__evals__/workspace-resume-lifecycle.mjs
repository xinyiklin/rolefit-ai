import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareResumeUpload } from "../useWorkspaceResume.ts";

let reads = 0;
const unread = (name) => ({
  name,
  text: async () => {
    reads += 1;
    return "should not be read";
  }
});

await assert.rejects(
  prepareResumeUpload(unread("resume.pdf")),
  /PDF uploads are text-only/,
  "PDF is rejected before reading"
);
await assert.rejects(
  prepareResumeUpload(unread("resume.docx")),
  /Upload a \.resume file/,
  "unsupported extensions are rejected before reading"
);
assert.equal(reads, 0, "extension preflight must not consume rejected files");

await assert.rejects(
  prepareResumeUpload({ name: "broken.txt", text: async () => { throw new Error("private browser error"); } }),
  /The file could not be read/,
  "read failures use a stable user-safe error"
);
await assert.rejects(
  prepareResumeUpload({ name: "broken.resume", text: async () => "{not valid json" }),
  /valid JSON|could not be parsed/i,
  "malformed .resume input fails strict preflight"
);

const textCandidate = await prepareResumeUpload({ name: "resume.md", text: async () => "# Resume" });
assert.deepEqual(textCandidate, { kind: "text", text: "# Resume" }, "text input is prepared without mutation");

const starter = readFileSync(new URL("../../../server/starter.resume", import.meta.url), "utf8");
const structuredCandidate = await prepareResumeUpload({ name: "resume.resume", text: async () => starter });
assert.equal(structuredCandidate.kind, "resume", "valid .resume input becomes a structured candidate");
assert.ok(structuredCandidate.parsed.data.sections.length > 0, "structured candidate carries parsed resume data");

const source = readFileSync(new URL("../useWorkspaceResume.ts", import.meta.url), "utf8");
const functionSlice = (name, nextName) => {
  const start = source.indexOf(`  async function ${name}`);
  const end = source.indexOf(`  async function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source slice exists`);
  return source.slice(start, end);
};

const applyWorkspace = functionSlice("applyWorkspaceBaseResume", "loadWorkspace");
const prepared = applyWorkspace.indexOf("candidate = prepareResumeText");
const confirmed = applyWorkspace.indexOf("await confirmReplaceEditor()", prepared);
const recoveryCleared = applyWorkspace.indexOf("clearAutosaveDraft()", confirmed);
const identityCommitted = applyWorkspace.indexOf("setFileName(", recoveryCleared);
assert.ok(prepared >= 0 && confirmed > prepared, "workspace files validate before replacement confirmation");
assert.ok(recoveryCleared > confirmed, "workspace recovery clears only after validation and confirmation");
assert.ok(identityCommitted > recoveryCleared, "workspace identity changes only inside the validated commit");

const restore = functionSlice("restoreBaseResume", "saveCurrentAsBaseResume");
const restoreResponse = restore.indexOf("if (!response.ok");
const restoreCommit = restore.indexOf("await applyWorkspaceBaseResume", restoreResponse);
assert.ok(restoreResponse >= 0 && restoreCommit > restoreResponse, "restore commits only after a successful response");
assert.doesNotMatch(restore, /clearAutosaveDraft\(\)/, "restore does not clear recovery before the server succeeds");

const select = functionSlice("loadBaseResumeVersion", "handleFileUpload");
const selectResponse = select.indexOf("if (!response.ok");
const selectCommit = select.indexOf("await applyWorkspaceBaseResume", selectResponse);
assert.ok(selectResponse >= 0 && selectCommit > selectResponse, "selection commits only after a successful response");
assert.doesNotMatch(select, /clearAutosaveDraft\(\)/, "selection does not clear recovery before the server succeeds");

const uploadStart = source.indexOf("  async function handleFileUpload");
const uploadEnd = source.indexOf("\n  return {", uploadStart);
const upload = source.slice(uploadStart, uploadEnd);
const uploadPrepared = upload.indexOf("candidate = await prepareResumeUpload(file)");
const uploadConfirmed = upload.indexOf("await confirmReplaceEditor()", uploadPrepared);
const uploadRecovery = upload.indexOf("clearAutosaveDraft()", uploadConfirmed);
const uploadIdentity = upload.indexOf("setFileName(file.name)", uploadRecovery);
assert.ok(uploadPrepared >= 0 && uploadConfirmed > uploadPrepared, "upload preflight completes before confirmation");
assert.ok(uploadRecovery > uploadConfirmed, "upload recovery clears only after confirmation");
assert.ok(uploadIdentity > uploadRecovery, "upload identity changes only at commit");

console.log("Workspace resume lifecycle probes passed");
