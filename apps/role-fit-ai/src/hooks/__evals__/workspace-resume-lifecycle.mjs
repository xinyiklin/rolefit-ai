import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "../../../../../packages/engine/src/lib/coverLetter.ts";
import { DOC_STYLE_DEFAULTS } from "../../../../../packages/engine/src/lib/documentStyle.ts";
import { serializeResumeFile } from "../../../../../packages/engine/src/lib/resumeFile.ts";
import { buildStarterResume } from "../../../../../packages/engine/src/sampleResume.ts";
import {
  prepareCoverLetterUpload,
  prepareResumeUpload
} from "../../lib/documentOpenFiles.ts";
import { createWorkspaceLoadOwnership } from "../../lib/workspaceLoadOwnership.ts";

let reads = 0;
const unread = (name) => ({
  name,
  size: 100,
  arrayBuffer: async () => {
    reads += 1;
    return new TextEncoder().encode("should not be read").buffer;
  }
});

await assert.rejects(
  prepareResumeUpload(unread("resume.pdf")),
  /Choose a \.resume file/,
  "PDF is rejected before reading"
);
for (const name of ["resume.docx", "resume.txt", "resume.md", "resume.csv", "resume.cover", "resume"]) {
  await assert.rejects(
    prepareResumeUpload(unread(name)),
    /Choose a \.resume file/,
    `unsupported resume extension is rejected before reading: ${name}`
  );
}
assert.equal(reads, 0, "extension preflight must not consume rejected files");

await assert.rejects(
  prepareResumeUpload({ name: "broken.resume", size: 100, arrayBuffer: async () => { throw new Error("private browser error"); } }),
  /could not be read/,
  "read failures use a stable user-safe error"
);
await assert.rejects(
  prepareResumeUpload({
    name: "broken.resume",
    size: 100,
    arrayBuffer: async () => new TextEncoder().encode("{not valid json").buffer
  }),
  /valid JSON|could not be parsed/i,
  "malformed .resume input fails strict preflight"
);

const starter = readFileSync(new URL("../../../server/starter.resume", import.meta.url), "utf8");
assert.deepEqual(
  JSON.parse(starter),
  JSON.parse(serializeResumeFile(buildStarterResume(), DOC_STYLE_DEFAULTS)),
  "bundled starter matches the canonical starter content and reset formatting"
);
const structuredCandidate = await prepareResumeUpload({
  name: "resume.resume",
  size: starter.length,
  arrayBuffer: async () => new TextEncoder().encode(starter).buffer
});
assert.ok(structuredCandidate.data.sections.length > 0, "valid .resume input becomes a structured candidate");
const invalidUtf8Resume = new TextEncoder().encode(starter);
invalidUtf8Resume[invalidUtf8Resume.indexOf("t".charCodeAt(0))] = 0xff;
await assert.rejects(
  prepareResumeUpload({
    name: "invalid-utf8.resume",
    size: invalidUtf8Resume.byteLength,
    arrayBuffer: async () => invalidUtf8Resume.buffer
  }),
  /UTF-8/i,
  "invalid UTF-8 bytes fail the strict resume codec"
);
await assert.rejects(
  prepareResumeUpload({ ...unread("oversized.resume"), size: 2_097_153 }),
  /larger than the 2 MB limit/,
  "oversized .resume input is rejected before reading"
);
assert.equal(reads, 0, "resume size preflight must not consume oversized files");

let coverReads = 0;
const unreadCover = (name, size = 100) => ({
  name,
  size,
  arrayBuffer: async () => {
    coverReads += 1;
    return new TextEncoder().encode("should not be read").buffer;
  }
});
for (const name of ["letter.txt", "letter.md", "letter.resume", "letter.pdf", "letter"]) {
  await assert.rejects(
    prepareCoverLetterUpload(unreadCover(name)),
    /Choose a \.cover file/,
    `unsupported cover-letter extension is rejected before reading: ${name}`
  );
}
assert.equal(coverReads, 0, "cover-letter extension preflight must not consume rejected files");
await assert.rejects(
  prepareCoverLetterUpload(unreadCover("oversized.cover", 2_097_153)),
  /larger than the 2 MB limit/,
  "oversized .cover input is rejected before reading"
);
assert.equal(coverReads, 0, "cover-letter size preflight must not consume oversized files");
await assert.rejects(
  prepareCoverLetterUpload({
    name: "broken.cover",
    size: 100,
    arrayBuffer: async () => new TextEncoder().encode("{not valid json").buffer
  }),
  /valid JSON/i,
  "malformed .cover input fails strict preflight"
);
const coverText = serializeCoverLetterFile(
  parseCoverLetterText("Dear Hiring Team,\n\nA valid cover letter."),
  COVER_LETTER_STYLE_DEFAULTS
);
const coverCandidate = await prepareCoverLetterUpload({
  name: "letter.COVER",
  size: coverText.length,
  arrayBuffer: async () => new TextEncoder().encode(coverText).buffer
});
assert.equal(coverCandidate.data.sections.length, 1, "valid .cover input becomes a structured candidate");

const source = readFileSync(new URL("../useWorkspaceResume.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const coverToolbarSource = readFileSync(
  new URL("../../sections/cover-letter/CoverLetterToolbar.tsx", import.meta.url),
  "utf8"
);
const functionSlice = (name, nextName) => {
  const start = source.indexOf(`  async function ${name}`);
  const end = source.indexOf(`  async function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source slice exists`);
  return source.slice(start, end);
};

const applyWorkspace = functionSlice("applyWorkspaceBaseResume", "loadWorkspace");
const extensionChecked = applyWorkspace.indexOf("if (!/\\.resume$/i.test");
const prepared = applyWorkspace.indexOf("parseResumeFile(baseResume.text)");
const confirmed = applyWorkspace.indexOf("await approveCurrentReplacement(", prepared);
const liveVersionCheck = applyWorkspace.indexOf("replacementGuard.currentVersion()", confirmed);
const recoveryCleared = applyWorkspace.indexOf("replacementGuard.onReplacementCommitted()", liveVersionCheck);
const identityCommitted = applyWorkspace.indexOf("setFileName(", recoveryCleared);
assert.ok(extensionChecked >= 0 && prepared > extensionChecked, "workspace files require the .resume extension before parsing");
assert.ok(prepared >= 0 && confirmed > prepared, "workspace files validate before replacement confirmation");
assert.ok(liveVersionCheck > confirmed, "workspace replacement re-checks the live document version at its commit boundary");
assert.ok(recoveryCleared > liveVersionCheck, "workspace recovery clears only after validation and current-state confirmation");
assert.ok(identityCommitted > recoveryCleared, "workspace identity changes only inside the validated commit");

const starterLoad = functionSlice("loadStarterTemplate", "saveBaseResume");
const starterResponse = starterLoad.indexOf("if (!response.ok");
const starterCommit = starterLoad.indexOf("await applyWorkspaceBaseResume(", starterResponse);
assert.ok(starterResponse >= 0 && starterCommit > starterResponse, "starter replacement uses the central current-state guard after a successful response");
assert.match(starterLoad, /setBaseResumeName\(""\)/, "starter remains detached from the active saved base");

const blankLoad = functionSlice("startBlankResume", "saveBaseResume");
const blankApproval = blankLoad.indexOf("await approveCurrentReplacement()");
const blankVersionCheck = blankLoad.indexOf("replacementGuard.currentVersion()", blankApproval);
const blankRecovery = blankLoad.indexOf("replacementGuard.onReplacementCommitted()", blankVersionCheck);
const blankIdentity = blankLoad.indexOf("detachBaseResumeIdentity()", blankRecovery);
const blankSeed = blankLoad.indexOf("seedResumeData(createBlankResumeData())", blankIdentity);
assert.ok(blankApproval >= 0, "Blank uses the current dirty-document replacement guard");
assert.ok(blankVersionCheck > blankApproval, "Blank re-checks the approved document version before commit");
assert.ok(blankRecovery > blankVersionCheck, "Blank clears recovery only at the validated commit boundary");
assert.ok(blankIdentity > blankRecovery, "Blank detaches saved-variant identity only inside the commit");
assert.ok(blankSeed > blankIdentity, "Blank seeds a fresh canonical document after identity is detached");
assert.match(blankLoad, /setDocumentTitle\("Resume"\)/, "Blank resets the visible document title");
assert.match(blankLoad, /setWorkspaceStatus\(""\)/, "Blank clears stale workspace save feedback");
assert.match(blankLoad, /docStyle\.replaceDocumentStyle\(toDocumentStyle\(DOC_STYLE_DEFAULTS\)\)/, "Blank resets persisted document style");
assert.match(blankLoad, /setResult\(null\)/, "Blank clears prior Resume tailoring output");
assert.match(blankLoad, /resetCoverWorkflow\(\)/, "Blank invalidates the Cover Letter evidence workflow");
assert.doesNotMatch(blankLoad, /fetch\(|DELETE|removeBaseResume|saveBaseResume\(/, "Blank never mutates saved Resume files");

const saveCurrent = functionSlice("saveCurrentAsBaseResume", "loadBaseResumeVersion");
assert.match(saveCurrent, /\|\| "default\.resume"/, "a detached blank document saves through the strict editable format");
assert.match(saveCurrent, /serializeResumeFile\(editedResume, docStyle\.style\)/, "blank structure and style remain representable on save");

const restore = functionSlice("restoreBaseResume", "saveCurrentAsBaseResume");
const restoreApproval = restore.indexOf("await approveCurrentReplacement()");
const restoreResponse = restore.indexOf("if (!response.ok");
const restoreCommit = restore.indexOf("await applyWorkspaceBaseResume", restoreResponse);
assert.ok(restoreApproval >= 0 && restoreApproval < restoreResponse, "restore obtains approval before mutating the saved workspace file");
assert.ok(restoreResponse >= 0 && restoreCommit > restoreResponse, "restore commits only after a successful response");
assert.match(restore, /approvedVersion/, "restore carries the approved document version across the server request for a commit-time re-check");
assert.doesNotMatch(restore, /onReplacementCommitted\(\)/, "restore does not clear recovery before the server succeeds");

const select = functionSlice("loadBaseResumeVersion", "handleFileUpload");
const selectResponse = select.indexOf("if (!response.ok");
const selectCommit = select.indexOf("await applyWorkspaceBaseResume", selectResponse);
assert.ok(selectResponse >= 0 && selectCommit > selectResponse, "selection commits only after a successful response");
assert.doesNotMatch(select, /onReplacementCommitted\(\)/, "selection does not clear recovery before the server succeeds");
assert.match(select, /text: applied\.text/, "selection returns the exact validated text committed to the editor");

const uploadStart = source.indexOf("  async function handleFileUpload");
const uploadEnd = source.indexOf("\n  return {", uploadStart);
const upload = source.slice(uploadStart, uploadEnd);
const uploadPrepared = upload.indexOf("candidate = await prepareResumeUpload(file)");
const uploadConfirmed = upload.indexOf("await approveCurrentReplacement()", uploadPrepared);
const uploadLiveVersion = upload.indexOf("replacementGuard.currentVersion()", uploadConfirmed);
const uploadRecovery = upload.indexOf("replacementGuard.onReplacementCommitted()", uploadLiveVersion);
const uploadIdentity = upload.indexOf("setFileName(file.name)", uploadRecovery);
assert.ok(uploadPrepared >= 0 && uploadConfirmed > uploadPrepared, "upload preflight completes before confirmation");
assert.ok(uploadLiveVersion > uploadConfirmed, "upload re-checks the live document version before replacement");
assert.ok(uploadRecovery > uploadLiveVersion, "upload recovery clears only after current-state confirmation");
assert.ok(uploadIdentity > uploadRecovery, "upload identity changes only at commit");

assert.match(
  appSource,
  /const resumeDocumentVersion = useMemo\([\s\S]{0,180}?resumeDocumentVersionFor\(editedResume, docStyle\.style\)/,
  "the replacement guard uses a render-safe structured document version"
);
assert.match(
  appSource,
  /title: baseResumeName[\s\S]{0,520}?disabled: isWorkspaceBootstrapping \|\| isSavingBaseResume/,
  "default workspace save stays disabled until workspace identity is known"
);
assert.match(
  appSource,
  /fieldId: "resume-variant-name"[\s\S]{0,520}?disabled: isWorkspaceBootstrapping \|\| isSavingBaseResume/,
  "named workspace save stays disabled until workspace identity is known"
);
assert.match(
  saveCurrent,
  /if \(isWorkspaceBootstrapping\) return;/,
  "workspace save also rejects bootstrap races at the state-owner boundary"
);
const starterAction = appSource.indexOf('key: "starter"');
const blankAction = appSource.indexOf('key: "blank"', starterAction);
const fileAction = appSource.indexOf('key: "file"', blankAction);
assert.ok(starterAction >= 0 && blankAction > starterAction && fileAction > blankAction, "Open orders Starter, Blank, then File");
assert.match(appSource, /accept="\.resume"/, "Resume picker advertises only the strict .resume format");
assert.doesNotMatch(appSource, /accept="[^"]*\.(?:txt|md|csv)/, "Resume picker does not advertise text imports");
assert.match(coverToolbarSource, /accept="\.cover"/, "Cover Letter picker advertises only the strict .cover format");
assert.doesNotMatch(
  coverToolbarSource,
  /accept="[^"]*\.(?:txt|md|resume)/,
  "Cover Letter picker does not advertise non-cover imports"
);
assert.match(appSource, /const resumeHasContent = Boolean\([\s\S]{0,120}?\.trim\(\)\.length > 0\)/, "blank document existence is separate from content readiness");
assert.match(appSource, /const canExportResume = resumeHasContent/, "blank Resume content does not enable PDF export");
assert.match(
  appSource,
  /subscribeWorkspaceRestoreAdoption[\s\S]*?void loadWorkspace\(false\)/,
  "cross-tab restore adoption refreshes workspace choices without automatically replacing the open resume"
);
assert.match(
  source,
  /loadOwnership\.claim\(applyBaseResume\)[\s\S]*?!loadOwnership\.isCurrent\(claim\)/,
  "workspace responses publish only while their shared load claim remains current"
);

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

{
  const ownership = createWorkspaceLoadOwnership();
  const startupResponse = deferred();
  const metadataResponse = deferred();
  let startupApplied = false;
  let metadataStarted = false;
  let bootstrapSettles = 0;

  async function loadWorkspace(applyBaseResume, response) {
    const claim = await ownership.claim(applyBaseResume);
    if (!applyBaseResume) metadataStarted = true;
    const workspace = await response.promise;
    if (!ownership.isCurrent(claim)) return;
    if (applyBaseResume) startupApplied = workspace.hasResume;
    if (ownership.startupMaySettle(claim)) {
      // Production settles from an effect after the hydrated editor state has
      // committed; this microtask is that commit boundary in the probe.
      await Promise.resolve();
      if (ownership.settleBootstrapAfterCommit()) bootstrapSettles += 1;
    }
  }

  const startup = loadWorkspace(true, startupResponse);
  await Promise.resolve();
  const metadata = loadWorkspace(false, metadataResponse);
  await Promise.resolve();
  assert.equal(metadataStarted, false, "metadata refresh waits behind startup hydration");

  startupResponse.resolve({ hasResume: true });
  await startup;
  metadataResponse.resolve({ hasResume: true });
  await metadata;
  assert.equal(startupApplied, true, "the startup resume is not silently skipped");
  assert.equal(bootstrapSettles, 1, "the bootstrap promise resolves exactly once");
  assert.equal(
    ownership.settleBootstrapAfterCommit(),
    false,
    "later settlement attempts cannot resolve the one-shot bootstrap twice"
  );

  let prepareBusy = false;
  async function prepare() {
    if (prepareBusy) return false;
    prepareBusy = true;
    try {
      await ownership.whenBootstrapped();
      return startupApplied;
    } finally {
      prepareBusy = false;
    }
  }
  assert.equal(await prepare(), true, "Prepare can claim a run after hydration");
  assert.equal(prepareBusy, false, "Prepare releases its run after resolution");
  assert.equal(await prepare(), true, "a subsequent manual Prepare can claim again");
}

console.log("Workspace resume lifecycle probes passed");
