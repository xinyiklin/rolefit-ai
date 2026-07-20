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
const menuSection = readFileSync(new URL("../../sections/MenuSection.tsx", import.meta.url), "utf8");
const providerSection = readFileSync(new URL("../../sections/ProviderSection.tsx", import.meta.url), "utf8");
const aiSettings = readHook("useAiSettings.ts");
const persistedSettings = readFileSync(new URL("../../lib/settings.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const intakeFingerprintStart = intake.indexOf("const distillInputFingerprint = workflowInputFingerprint({");
const intakeFingerprint = intake.slice(
  intakeFingerprintStart,
  intake.indexOf("});", intakeFingerprintStart) + 3
);
const polishFingerprintStart = polish.indexOf("const inputFingerprint = workflowInputFingerprint({");
const polishFingerprint = polish.slice(
  polishFingerprintStart,
  polish.indexOf("});", polishFingerprintStart) + 3
);
const answersFingerprintStart = answers.indexOf("const inputFingerprint = workflowInputFingerprint({");
const answersFingerprint = answers.slice(
  answersFingerprintStart,
  answers.indexOf("});", answersFingerprintStart) + 3
);
const coverFingerprintStart = cover.indexOf("const inputFingerprint = workflowInputFingerprint({");
const coverFingerprint = cover.slice(
  coverFingerprintStart,
  cover.indexOf("});", coverFingerprintStart) + 3
);

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
assert.match(answers, /if \(!providerReady\)/, "answer generation fails closed before requesting an unavailable provider");
assert.match(cover, /if \(!providerReady\)/, "cover generation fails closed before requesting an unavailable provider");
assert.doesNotMatch(answersFingerprint, /providerReady/, "provider polling cannot invalidate active answer generation");
assert.doesNotMatch(coverFingerprint, /providerReady/, "provider polling cannot invalidate active cover generation");
assert.equal(
  intake.match(/await ensureProviderReady\(\)/g)?.length,
  4,
  "every AI Distill entry point awaits the shared initial provider discovery"
);
assert.ok(
  intake.indexOf("const readiness = distillAi ? await ensureProviderReady()") <
    intake.indexOf("const releaseDistillRun = await waitAndClaimDistillRun()"),
  "extension imports settle provider discovery before claiming and fingerprinting their Distill run"
);
assert.doesNotMatch(
  intakeFingerprint,
  /providerReady/,
  "advisory provider polling cannot invalidate an active Distill request"
);
assert.doesNotMatch(
  intakeFingerprint,
  /editedResume|tailorModes/,
  "resume bootstrap and Tailor-mode reconciliation cannot invalidate an active Distill request"
);
assert.match(intakeFingerprint, /jobUrl/, "Distill still guards the live job URL");
assert.match(intakeFingerprint, /jobDescription/, "Distill still guards the live job description");
assert.match(intakeFingerprint, /aiRequest/, "Distill still guards its provider, model, and effort settings");
assert.match(
  polish,
  /const results = await Promise\.all\(checks\)/,
  "Polish checks selected stage providers in parallel through the shared readiness owner"
);
assert.match(
  polish,
  /const providerBlocker = await selectedProviderBlocker\(/,
  "Polish waits for initial provider discovery before beginning"
);
assert.doesNotMatch(
  polishFingerprint,
  /tailorProviderReady|reviewProviderReady/,
  "advisory provider polling cannot invalidate an active Tailor or Review request"
);
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
  "Distill snapshots its job and provider inputs"
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
assert.match(
  jobMenu,
  /disabled=\{!jobUrl\.trim\(\) \|\| isExtractingLink \|\| !distillProviderReady\}/,
  "Extract is disabled while busy or its selected provider is unavailable"
);
assert.match(
  jobMenu,
  /disabled=\{!distillReady \|\| isExtractingLink \|\| !distillProviderReady\}/,
  "Distill paste is disabled while busy or its selected provider is unavailable"
);

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

assert.match(
  menuSection,
  /<section className="menu-section" aria-labelledby=\{headingId\}>[\s\S]*<h3 id=\{headingId\}[\s\S]*<div className="menu-section__body">\{children\}<\/div>[\s\S]*<\/section>/,
  "AI stage settings use an always-rendered semantic section with a labelled heading"
);
assert.doesNotMatch(
  menuSection,
  /<button|aria-expanded|ChevronDown|\bonToggle\b|\bopen\s*[?:=]/,
  "the shared AI stage section exposes no disclosure trigger or collapsible state"
);
assert.match(
  providerSection,
  /<MenuSection title=\{title\} headerControl=\{copyControl\}>/,
  "each provider stage renders through the static section contract"
);
assert.doesNotMatch(
  providerSection,
  /\b(?:open|onToggle|summary)\s*=/,
  "provider stages cannot restore accordion props"
);
assert.match(
  providerSection,
  /\{!selectedConnection\?\.ready \? \([\s\S]*selectedConnection \? selectedConnection\.guidance : availabilityMessage[\s\S]*Check providers/,
  "provider descriptions stay hidden for ready providers while unavailable providers retain recovery guidance"
);
assert.match(
  app,
  /const STAGE_SECTIONS:[\s\S]*\{ id: "distill", title: "Distill" \}[\s\S]*\{ id: "tailor", title: "Tailor" \}[\s\S]*\{ id: "review", title: "Review" \}/,
  "the AI menu retains all three pipeline-stage settings"
);
assert.match(
  app,
  /<AiMenu>[\s\S]*\{STAGE_SECTIONS\.map\([\s\S]*<ProviderSection[\s\S]*<\/AiMenu>/,
  "the AI menu renders every stage section without an open-stage filter"
);
assert.doesNotMatch(
  aiSettings,
  /\bsectionOpen\b|\btoggleSection\b/,
  "AI settings no longer own or persist accordion state"
);
assert.match(
  persistedSettings,
  /delete \(settings as unknown as Record<string, unknown>\)\.sectionOpen;/,
  "loading legacy settings removes the retired accordion preference"
);

console.log("Client workflow guards eval: 60/60 checks passed");
