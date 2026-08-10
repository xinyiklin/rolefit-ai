import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readHook = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const applications = readHook("useApplications.ts");
const applyFlow = readHook("useApplyFlow.ts");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applicationModal = readFileSync(
  new URL("../../sections/ApplicationModal.tsx", import.meta.url),
  "utf8"
);

assert.match(
  applications,
  /applications: applicationMutationRecords\(next, mutations\),[\s\S]*mutations/,
  "tracker writes send only explicit mutation records"
);
assert.match(
  applications,
  /res\.status === 409[\s\S]*ApplicationConflictError/,
  "revision conflicts are distinguished from ordinary storage failures"
);
assert.match(
  applications,
  /confirmedApplications\.current = err\.applications/,
  "a conflict adopts the server-confirmed tracker snapshot"
);
assert.match(
  applications,
  /loadVersion !== persistVersion\.current/,
  "the mount read cannot overwrite a mutation that began while it was in flight"
);
assert.match(
  applications,
  /refreshVersion !== persistVersion\.current/,
  "a manual refresh cannot overwrite a concurrent mutation"
);
assert.match(
  applications,
  /setPendingWrites\(\(count\) => count \+ 1\)[\s\S]*finally \{[\s\S]*setPendingWrites/,
  "every tracker write enters and releases reactive pending state"
);
assert.equal(
  applications.match(/data\.applications\.map\(canonicalizeApplicationAiUsage\)/g)?.length,
  3,
  "initial, refreshed, and post-write reads copy AI-usage receipts at the boundary"
);

const documentVersionCapture = applyFlow.indexOf("const expectedDocumentVersions =");
const awaitedSave = applyFlow.indexOf("saved = await persistAppliedApplication(app)");
const failedSave = applyFlow.indexOf("if (!saved)", awaitedSave);
const artifactSave = applyFlow.indexOf("const savedDocuments = await saveAppliedDocumentArtifacts(", failedSave);
const resumeRecoveryClear = applyFlow.indexOf("if (savedDocuments.resumeSaved) onResumeSaved();", artifactSave);
const coverRecoveryClear = applyFlow.indexOf("if (savedDocuments.coverSaved) onCoverLetterSaved();", artifactSave);

assert.ok(documentVersionCapture >= 0 && documentVersionCapture < awaitedSave, "Apply captures document versions before persistence yields");
assert.ok(awaitedSave >= 0 && failedSave > awaitedSave, "Apply awaits tracker persistence and handles a failed confirmation");
assert.ok(artifactSave > failedSave, "document artifacts start only after tracker confirmation");
assert.ok(
  resumeRecoveryClear > artifactSave && coverRecoveryClear > resumeRecoveryClear,
  "each recovery draft clears only after its strict editable source is saved"
);
assert.match(
  applyFlow,
  /const resume = selection\.resume[\s\S]{0,180}?getResumeArtifacts\(\)/,
  "Apply snapshots a resume only when the captured package includes it"
);
assert.match(
  applyFlow,
  /const cover = selection\.coverLetter[\s\S]{0,180}?getCoverLetterArtifacts\(\)/,
  "Apply snapshots a cover letter only when the captured package includes it"
);
assert.match(
  applyFlow,
  /never deletes an older tracker artifact/,
  "excluding a material on re-Apply remains explicitly non-destructive"
);

assert.match(applicationModal, /saved = await onSave/, "the detail modal awaits tracker persistence");
assert.match(
  applicationModal,
  /if \(!saved\)[\s\S]*setSaveError/,
  "a failed detail save preserves the form with an actionable error"
);
assert.match(app, /const saved = await saveApplication\(application\)/, "App awaits modal persistence");
assert.match(app, /pendingApplicationWrites > 0/, "before-unload protection includes pending tracker writes");
assert.match(
  app,
  /fitAssessmentSnapshot:\s*fitAssessmentLatestSnapshot\(fitAssessmentState\)/,
  "Apply receives the latest completed Fit Assessment even when it is out of date"
);
assert.match(
  applyFlow,
  /fitAssessment: fitAssessmentSnapshot \?\? existing\?\.fitAssessment,[\s\S]{0,180}?\.\.\.\(materialSelection\.resume/,
  "Apply persists Fit Assessment independently from resume inclusion and preserves an existing snapshot"
);

console.log("application persistence guards passed");
