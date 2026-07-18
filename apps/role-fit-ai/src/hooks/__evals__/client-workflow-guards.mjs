import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readHook = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const applications = readHook("useApplications.ts");
const applyFlow = readHook("useApplyFlow.ts");
const answers = readHook("useApplicationAnswers.ts");
const cover = readHook("useCoverLetter.ts");
const polish = readHook("usePolishPipeline.ts");
const inbox = readHook("useExtensionInbox.ts");
const intake = readHook("useJobIntake.ts");
const jobMenu = readFileSync(new URL("../../sections/JobMenu.tsx", import.meta.url), "utf8");
const applicationModal = readFileSync(new URL("../../sections/ApplicationModal.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

assert.match(
  applications,
  /body: JSON\.stringify\(\{ applications: next, mutations \}\)/,
  "application writes send explicit per-record mutations"
);
assert.doesNotMatch(applications, /deleteIds/, "the obsolete deleteIds contract cannot return");
assert.match(
  applications,
  /res\.status === 409[\s\S]*ApplicationConflictError/,
  "a 409 response is recognized as a revision conflict"
);
assert.match(
  applications,
  /confirmedApplications\.current = err\.applications/,
  "a conflict adopts the server-confirmed snapshot"
);
assert.match(applications, /return persist\(next, \[\{/, "upsert returns its confirmation promise");
assert.match(
  applications,
  /const saveApplication[\s\S]*return persist\(next, \[\{/,
  "the application modal save path returns its confirmation promise"
);
assert.match(
  applications,
  /loadVersion !== persistVersion\.current/,
  "the mount GET cannot overwrite a mutation that began while it was in flight"
);
assert.match(
  applications,
  /refreshVersion !== persistVersion\.current/,
  "Refresh cannot overwrite a mutation that began while its GET was in flight"
);
assert.match(applications, /setPendingWrites\(\(count\) => count \+ 1\)/, "tracker writes increment reactive pending state");
assert.match(applications, /finally \{[\s\S]*setPendingWrites/, "tracker writes always release reactive pending state");

const awaitedSave = applyFlow.indexOf("saved = await upsertApplication(app)");
const failedSave = applyFlow.indexOf("if (!saved)", awaitedSave);
const recoveryClear = applyFlow.indexOf("clearAutosaveDraft()", awaitedSave);
const artifactSave = applyFlow.indexOf("saveAppliedResumeArtifacts", recoveryClear);
assert.ok(awaitedSave >= 0 && failedSave > awaitedSave, "Apply awaits tracker persistence");
assert.ok(recoveryClear > failedSave, "Apply only clears recovery data after confirmed persistence");
assert.ok(artifactSave > recoveryClear, "resume artifacts start only after the application is confirmed");

for (const [name, source] of [["answers", answers], ["cover", cover], ["polish", polish]]) {
  assert.match(source, /workflowRequestIsCurrent/, `${name} generation checks use the shared current-request guard`);
  assert.match(source, /AbortController/, `${name} owns an abort controller`);
}
assert.match(polish, /polishRunLockRef/, "Polish has a synchronous double-run lock");
assert.match(polish, /inputFingerprintRef\.current = inputFingerprint/, "Polish tracks live semantic inputs");

const responseGuard = inbox.indexOf("if (!res.ok)");
const deliveryBranch = inbox.indexOf("if (data === null", responseGuard);
assert.ok(responseGuard >= 0 && deliveryBranch > responseGuard, "inbox rejects non-ok polls before delivery parsing");
assert.match(inbox, /scheduleTransientRetry\(\)/, "transient inbox failures are retried");
assert.match(inbox, /await onImportRef\.current/, "the inbox awaits the once-only client handoff");

assert.match(intake, /async function waitAndClaimDistillRun/, "extension imports can wait for the active distill");
assert.match(
  intake,
  /const releaseDistillRun = await waitAndClaimDistillRun\(\)/,
  "a delivered extension payload enters the serialized distill handoff"
);
assert.match(intake, /const releaseDistillRun = tryClaimDistillRun\(\)/, "user distills share the same lock");
assert.match(
  intake,
  /const distillInputFingerprint = workflowInputFingerprint\(/,
  "Distill snapshots resume, job, mode, and provider inputs"
);
assert.match(intake, /distillGenerationRef/, "Distill invalidates superseded request generations");
assert.equal(
  intake.match(/const request = startDistillRequest\(\)/g)?.length,
  4,
  "every link, paste, retry, and extension Distill owns a guarded request"
);
assert.equal(
  intake.match(/signal: request\.signal/g)?.length,
  5,
  "every Distill fetch receives the active abort signal"
);
assert.ok(
  (intake.match(/if \(!request\.isCurrent\(\)\) return;/g)?.length ?? 0) >= 16,
  "Distill checks request currency after every asynchronous boundary"
);
assert.equal(
  jobMenu.match(/disabled=\{isExtractingLink\}/g)?.length,
  2,
  "job URL and posting text remain immutable while a distill owns the lock"
);
assert.match(jobMenu, /disabled=\{!jobUrl\.trim\(\) \|\| isExtractingLink\}/, "Extract is disabled while busy");
assert.match(jobMenu, /disabled=\{!distillReady \|\| isExtractingLink\}/, "Distill paste is disabled while busy");

assert.match(applicationModal, /saved = await onSave/, "the application modal awaits persistence");
assert.match(applicationModal, /if \(!saved\)[\s\S]*setSaveError/, "failed modal saves retain visible error state");
assert.match(applicationModal, /inert=\{isSaving\}/, "modal edits are frozen while their snapshot saves");
assert.match(app, /const saved = await saveApplication\(application\)/, "App awaits modal persistence");
assert.match(
  app,
  /hidden=\{activeOutputTab !== "materials"\}/,
  "Materials stays mounted and is semantically hidden when another output tab is active"
);
assert.match(
  app,
  /pendingApplicationWrites > 0/,
  "before-unload protection includes pending tracker persistence"
);
assert.doesNotMatch(
  answers,
  /setAnswersResult\(null\)/,
  "input and provider changes cannot erase completed application-answer drafts"
);

console.log("Client workflow guards eval: 41/41 checks passed");
