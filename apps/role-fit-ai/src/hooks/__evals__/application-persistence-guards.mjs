import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applicationDocumentNeedsUnloadGuard,
  applicationPersistenceReceiptAfterDocumentSave,
  applicationUnloadGuardActive
} from "../../lib/applicationUnloadGuard.ts";

const readHook = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const applications = readHook("useApplications.ts");
const applyFlow = readHook("useApplyFlow.ts");
const applicationFiles = readHook("useApplicationFiles.ts");
const applicationDocumentSync = readHook("useApplicationDocumentSync.ts");
const preparedApplicationRecord = readFileSync(
  new URL("../../lib/preparedApplicationRecord.ts", import.meta.url),
  "utf8"
);
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
  /readId !== readVersion\.current \|\| loadVersion !== persistVersion\.current/,
  "the mount read cannot overwrite a newer authoritative read"
);
assert.equal(
  applications.match(/readId === readVersion\.current\)[\s\S]{0,100}?setError/g)?.length,
  2,
  "stale mount and refresh failures cannot replace a newer read's success state"
);
assert.match(
  applications,
  /setPendingWrites\(\(count\) => count \+ 1\)[\s\S]*finally \{[\s\S]*setPendingWrites/,
  "every tracker write enters and releases reactive pending state"
);
assert.doesNotMatch(
  applications,
  /sameApplicationTarget/,
  "ordinary tracker persistence never selects a write target by matching job content"
);
assert.match(
  applications,
  /const updateApplicationById = useCallback[\s\S]{0,240}?current\.findIndex\(\(application\) => application\.id === incoming\.id\)/,
  "the dedicated update path matches an existing record by explicit id only"
);
assert.match(
  applications,
  /const linkPostingRecords =[\s\S]*await persist\([\s\S]*changed\.map/,
  "posting relationships use one sparse multi-record persistence request"
);
assert.match(
  applications,
  /const markPostingRecordsUnrelated =[\s\S]*return persist\(next, mutations\)/,
  "Keep separate decisions use one sparse multi-record persistence request"
);
for (const contract of [
  "const postingPlan = planPostingRecordLink(",
  "const relationshipChanges = retainedPostingGroupId",
  "...relationshipChanges.map"
]) {
  assert.ok(
    applications.includes(contract),
    "merging a duplicate preserves and atomically unifies surviving posting-history groups"
  );
}
assert.equal(
  applications.match(/data\.applications\.map\(canonicalizeApplicationAiUsage\)/g)?.length,
  3,
  "initial, refreshed, and post-write reads copy AI-usage receipts at the boundary"
);

const documentVersionCapture = applyFlow.indexOf("const expectedDocumentVersions =");
const awaitedSave = applyFlow.indexOf('? await createApplication(app)');
const awaitedUpdate = applyFlow.indexOf(": await updateApplicationById(app)", awaitedSave);
const failedSave = applyFlow.indexOf("if (!saved)", awaitedSave);
const commitApplyStart = applyFlow.indexOf("async function commitApply()");
const receiptInvalidation = applyFlow.indexOf("setApplicationPersistenceReceipt(null)", commitApplyStart);
const artifactSave = applyFlow.indexOf("const savedDocuments = await saveAppliedDocumentArtifacts(", failedSave);
const persistenceReceipt = applyFlow.indexOf("setApplicationPersistenceReceipt({", artifactSave);
const resumeRecoveryClear = applyFlow.indexOf("if (savedDocuments.resumeSaved) onResumeSaved();", artifactSave);
const coverRecoveryClear = applyFlow.indexOf("if (savedDocuments.coverSaved) onCoverLetterSaved();", artifactSave);
const storedResume = applyFlow.indexOf("const storedResume =", applyFlow.indexOf("async function saveAppliedDocumentArtifacts("));
const storedCover = applyFlow.indexOf("const storedCover =", storedResume);
const finalResumeValidation = applyFlow.indexOf("const currentStoredResume =", storedResume);
const finalCoverValidation = applyFlow.indexOf("const currentStoredCover =", storedCover);
const materialSelectionRef = applyFlow.indexOf("const currentMaterialSelectionRef = useRef(");
const materialSelectionRefUpdate = applyFlow.indexOf("currentMaterialSelectionRef.current =", materialSelectionRef);
const materialSelectionEffect = applyFlow.indexOf("useEffect(", materialSelectionRef);
const documentVersionsRef = applyFlow.indexOf("const latestDocumentVersionsRef = useRef(");
const documentVersionsRefUpdate = applyFlow.indexOf("latestDocumentVersionsRef.current =", documentVersionsRef);
const documentVersionsEffect = applyFlow.indexOf("useEffect(", documentVersionsRef);
const saveIdentityRef = applicationDocumentSync.indexOf("const latestSaveIdentityRef = useRef(");
const saveIdentityRefUpdate = applicationDocumentSync.indexOf("latestSaveIdentityRef.current =", saveIdentityRef);
const saveIdentityEffect = applicationDocumentSync.indexOf("useEffect(", saveIdentityRef);

assert.ok(documentVersionCapture >= 0 && documentVersionCapture < awaitedSave, "Apply captures document versions before persistence yields");
assert.ok(
  awaitedSave >= 0 && awaitedUpdate > awaitedSave && failedSave > awaitedUpdate,
  "Apply awaits its explicit create/update tracker path and handles a failed confirmation"
);
assert.match(
  applyFlow,
  /if \(session\.mode !== "new" && !existing\)[\s\S]{0,420}?return false;/,
  "an explicit draft/update session fails closed when its id no longer exists"
);
assert.match(
  applyFlow,
  /could not be prepared for saving[\s\S]{0,320}?applyCommitInFlightRef\.current = false;[\s\S]{0,100}?setIsCommittingApply\(false\)/,
  "unexpected pre-commit failures release Apply's busy state and keep the recovery draft"
);
assert.ok(artifactSave > failedSave, "document artifacts start only after tracker confirmation");
assert.ok(
  materialSelectionRef >= 0 &&
    materialSelectionRefUpdate > materialSelectionRef &&
    (materialSelectionEffect < 0 || materialSelectionRefUpdate < materialSelectionEffect),
  "Apply reads the current render's material selection before any passive effect"
);
assert.ok(
  documentVersionsRef >= 0 &&
    documentVersionsRefUpdate > documentVersionsRef &&
    (documentVersionsEffect < 0 || documentVersionsRefUpdate < documentVersionsEffect),
  "Apply reads the current render's document versions before any passive effect"
);
assert.ok(
  saveIdentityRef >= 0 &&
    saveIdentityRefUpdate > saveIdentityRef &&
    saveIdentityRefUpdate < saveIdentityEffect,
  "explicit document saves read the current render's target and versions"
);
assert.ok(
  storedResume >= 0 &&
    storedCover > storedResume &&
    finalResumeValidation > storedCover &&
    finalCoverValidation > finalResumeValidation,
  "both document versions are validated after the sequential uploads settle"
);
assert.ok(
  receiptInvalidation > commitApplyStart && receiptInvalidation < awaitedSave,
  "a commit attempt invalidates any earlier receipt before tracker persistence begins"
);
assert.ok(
  persistenceReceipt > artifactSave && persistenceReceipt < resumeRecoveryClear,
  "Apply records exact saved, excluded, and failed document outcomes before clearing recovery"
);
assert.match(
  applicationDocumentSync,
  /onResumeSaved: \(applicationId: string, version: string\) => void;[\s\S]{0,100}?onCoverLetterSaved: \(applicationId: string, version: string\) => void;/,
  "explicit document saves report their application and exact saved version"
);
assert.match(
  applicationDocumentSync,
  /\(kind === "resume" \? onResumeSaved : onCoverLetterSaved\)\(startedApplicationId, startedVersion\)/,
  "an explicit save advances the shared persistence receipt only after exact-version success"
);
assert.match(
  app,
  /current && current\.applicationId !== preparationSession\.applicationId \? null : current/,
  "changing preparations discards receipts that could later match stale application state"
);
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
assert.match(applicationModal, /saved = await onSave/, "the detail modal awaits tracker persistence");
assert.match(
  applicationModal,
  /if \(!saved\)[\s\S]*setSaveError/,
  "a failed detail save preserves the form with an actionable error"
);
assert.match(app, /const saved = await saveApplication\(application\)/, "App awaits modal persistence");
assert.match(
  app,
  /applicationUnloadGuardActive\(\{[\s\S]{0,500}?pendingApplicationWrites,[\s\S]{0,120}?applicationSavePending/,
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
  /applicationSavePending/,
  "before-unload protection includes Apply's tracker-plus-document lifecycle"
);
assert.match(
  app,
  /const applicationPersistencePending\s*=\s*applicationSavePending\s*\|\|\s*resumeApplicationSync\.isSaving\s*\|\|\s*coverLetterApplicationSync\.isSaving\s*\|\|\s*applicationFiles\.isBusy\s*\|\|\s*applicationDocumentActionBusy/,
  "explicit resume and cover-letter application uploads join the persistence guard"
);
assert.match(
  applicationFiles,
  /setPendingOperations\(\(count\) => count \+ 1\)[\s\S]{0,500}?finally\(\(\) => setPendingOperations\(\(count\) => count - 1\)\)/,
  "the application file queue exposes its complete pending lifetime"
);
assert.match(
  app.slice(unloadGuardCall, unloadGuardCall + 900),
  /applicationSavePending: applicationPersistencePending/,
  "the unload predicate receives the complete application persistence phase"
);
assert.match(
  app,
  /fitAssessmentPersistence:\s*fitAssessmentPersistenceDecision\(fitAssessmentState\)/,
  "Apply receives an explicit Fit Assessment persistence decision"
);
assert.match(
  preparedApplicationRecord,
  /fitAssessmentPersistence\.action === "set"[\s\S]{0,180}?fitAssessment: fitAssessmentPersistence\.snapshot[\s\S]{0,220}?fitAssessmentPersistence\.action === "clear"[\s\S]{0,120}?fitAssessment: undefined/,
  "the shared prepared-record builder distinguishes replacing, preserving, and clearing a Fit Assessment"
);

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

{
  const receipt = {
    applicationId: "application-1",
    resume: { version: "resume-v1", outcome: "saved" },
    coverLetter: { version: "cover-v1", outcome: "excluded" }
  };
  const baseState = {
    kind: "resume",
    dirty: true,
    currentVersion: "resume-v1",
    recoveryDraftSaved: false,
    applicationId: "application-1",
    receipt
  };
  const cases = [
    ["a clean document never needs an unload warning", false, { dirty: false }],
    ["the exact application-saved revision no longer warns", false, {}],
    ["a later included-document edit warns until it is saved to the application", true, {
      currentVersion: "resume-v2",
      recoveryDraftSaved: true
    }],
    ["a receipt from another application cannot release the warning", true, {
      applicationId: "application-2",
      recoveryDraftSaved: true
    }],
    ["an excluded edited cover letter stops warning after Apply confirms recovery", false, {
      kind: "coverLetter",
      currentVersion: "cover-v1",
      recoveryDraftSaved: true
    }],
    ["an excluded cover letter warns until recovery is confirmed", true, {
      kind: "coverLetter",
      currentVersion: "cover-v1"
    }],
    ["a later excluded cover-letter revision releases after its recovery write", false, {
      kind: "coverLetter",
      currentVersion: "cover-v2",
      recoveryDraftSaved: true
    }],
    ["a later excluded cover-letter revision warns while recovery is pending", true, {
      kind: "coverLetter",
      currentVersion: "cover-v2"
    }],
    ["an included cover-letter save failure keeps warning after recovery", true, {
      kind: "coverLetter",
      currentVersion: "cover-v1",
      recoveryDraftSaved: true,
      receipt: {
        ...receipt,
        coverLetter: { version: "cover-v1", outcome: "failed" }
      }
    }]
  ];
  for (const [message, expected, state] of cases) {
    assert.equal(
      applicationDocumentNeedsUnloadGuard({ ...baseState, ...state }),
      expected,
      message
    );
  }
  assert.deepEqual(
    applicationPersistenceReceiptAfterDocumentSave(
      receipt,
      "coverLetter",
      "application-1",
      "cover-v2"
    ),
    {
      ...receipt,
      coverLetter: { version: "cover-v2", outcome: "saved" }
    },
    "an explicit save replaces an excluded outcome with its exact saved version"
  );
  assert.equal(
    applicationPersistenceReceiptAfterDocumentSave(
      receipt,
      "coverLetter",
      "another-application",
      "cover-v2"
    ),
    receipt,
    "an explicit save never mutates another application's receipt"
  );
}

{
  let pendingApplicationWrites = 1;
  let applicationSavePending = true;
  const saveResumeDocument = deferred();
  const saveCoverDocument = deferred();
  const applicationPersistence = (async () => {
    // Tracker confirmation has completed, but the included documents are still
    // ordinary in-flight fetches and both editors began clean.
    pendingApplicationWrites = 0;
    await saveResumeDocument.promise;
    await saveCoverDocument.promise;
    applicationSavePending = false;
  })();
  await Promise.resolve();

  const state = () => ({
    resumeNeedsUnloadGuard: false,
    coverLetterNeedsUnloadGuard: false,
    isGeneratingCover: false,
    isPolishStarting: false,
    isPolishing: false,
    jobAnalysisRunning: false,
    fitAssessmentRequestActive: false,
    preparationAutomationPending: false,
    pendingApplicationWrites,
    applicationSavePending,
    isSkipping: false
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

  assert.equal(
    applicationUnloadGuardActive({
      ...state(),
      // Apply remains visibly busy while the already-saved PDFs export, but no
      // draft or application write is left for beforeunload to protect.
      applicationSavePending: false
    }),
    false,
    "post-Apply PDF export does not keep the saved draft unload-guarded"
  );
}

console.log("application persistence guards passed");
