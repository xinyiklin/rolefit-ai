import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applicationUnloadGuardActive } from "../../lib/applicationUnloadGuard.ts";

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
assert.match(
  app,
  /applicationUnloadGuardActive\(\{[\s\S]{0,500}?pendingApplicationWrites,[\s\S]{0,80}?isApplying/,
  "before-unload protection includes tracker writes and Apply's document phase"
);
const applyHookCall = app.indexOf("} = useApplyFlow({");
const unloadGuardCall = app.indexOf("useBeforeUnloadGuard(", applyHookCall);
assert.ok(
  applyHookCall >= 0 && unloadGuardCall > applyHookCall,
  "the unload guard is declared after Apply exposes its complete persistence phase"
);
assert.match(
  app.slice(unloadGuardCall, unloadGuardCall + 900),
  /isApplying/,
  "before-unload protection includes Apply's tracker-plus-document lifecycle"
);
assert.match(
  app,
  /fitAssessmentPersistence:\s*fitAssessmentPersistenceDecision\(fitAssessmentState\)/,
  "Apply receives an explicit Fit Assessment persistence decision"
);
assert.match(
  applyFlow,
  /fitAssessmentPersistence\.action === "set"[\s\S]{0,180}?fitAssessment: fitAssessmentPersistence\.snapshot[\s\S]{0,220}?fitAssessmentPersistence\.action === "clear"[\s\S]{0,120}?fitAssessment: undefined/,
  "Apply distinguishes replacing, preserving, and clearing a Fit Assessment"
);

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

{
  let pendingApplicationWrites = 1;
  let isApplying = true;
  const saveResumeDocument = deferred();
  const saveCoverDocument = deferred();
  const applicationPersistence = (async () => {
    // Tracker confirmation has completed, but the included documents are still
    // ordinary in-flight fetches and both editors began clean.
    pendingApplicationWrites = 0;
    await saveResumeDocument.promise;
    await saveCoverDocument.promise;
    isApplying = false;
  })();
  await Promise.resolve();

  const state = () => ({
    resumeDocumentDirty: false,
    coverLetterRecoveryDirty: false,
    isGeneratingCover: false,
    isPolishStarting: false,
    isPolishing: false,
    jobAnalysisRunning: false,
    fitAssessmentRequestActive: false,
    preparationAutomationPending: false,
    pendingApplicationWrites,
    isApplying
  });
  assert.equal(
    applicationUnloadGuardActive(state()),
    true,
    "clean documents remain unload-guarded after tracker confirmation while sources save"
  );

  saveResumeDocument.resolve();
  await Promise.resolve();
  assert.equal(
    applicationUnloadGuardActive(state()),
    true,
    "the guard stays active between sequential included source saves"
  );

  saveCoverDocument.resolve();
  await applicationPersistence;
  assert.equal(
    applicationUnloadGuardActive(state()),
    false,
    "the guard releases only after every included source save settles"
  );
}

console.log("application persistence guards passed");
