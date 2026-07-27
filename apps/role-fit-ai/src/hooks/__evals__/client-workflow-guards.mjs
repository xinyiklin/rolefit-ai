import assertStrict from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// The reported total used to be a hand-maintained literal, so it silently drifted
// from the real count every time a guard was added. Count the calls instead.
let checkCount = 0;
const assert = new Proxy(assertStrict, {
  get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args) => {
      checkCount += 1;
      return value.apply(target, args);
    };
  }
});

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
const settingsStage = readFileSync(new URL("../../sections/SettingsStage.tsx", import.meta.url), "utf8");
const reviewRail = readFileSync(new URL("../../sections/ReviewRail.tsx", import.meta.url), "utf8");
const appIndex = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const styleTokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const aiSettings = readHook("useAiSettings.ts");
const persistedSettings = readFileSync(new URL("../../lib/settings.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const coverEditor = readHook("useCoverLetterEditor.ts");
const coverToolbar = readFileSync(new URL("../../sections/cover-letter/CoverLetterToolbar.tsx", import.meta.url), "utf8");
const settingsDialog = readFileSync(new URL("../../sections/SettingsDialog.tsx", import.meta.url), "utf8");
const candidateFacts = readFileSync(new URL("../../lib/candidateFacts.ts", import.meta.url), "utf8");
const aiStages = readFileSync(new URL("../../config/aiStages.ts", import.meta.url), "utf8");
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
const artifactSave = applyFlow.indexOf("saveAppliedDocumentArtifacts(", recoveryClear);
assert.ok(awaitedSave >= 0 && failedSave > awaitedSave, "Apply awaits tracker persistence");
assert.ok(recoveryClear > failedSave, "Apply only clears recovery data after confirmed persistence");
assert.ok(artifactSave > recoveryClear, "document artifacts start only after the application is confirmed");
assert.match(
  applyFlow,
  /uploadApplicationDocument\(id, "resume", resume\)[\s\S]{0,200}?uploadApplicationDocument\(id, "cover", cover\)/,
  "Apply saves the cover letter's files exactly as it saves the resume's"
);

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

// The resume Polish action asks which stages to run. Because `polishStages` is
// part of the pipeline's input fingerprint, and the fingerprint effect aborts a
// run that is in flight when it changes, the chooser MUST set the stage and let
// that commit before starting the run. Starting it in the same tick as the
// setState aborts the run it just started, which is silent and hard to spot.
assert.match(
  polishFingerprint,
  /polishStages/,
  "the polish fingerprint still guards the selected stages"
);
assert.match(
  app,
  /runPolishOnStagesCommitRef\.current = true;\s*setPolishStages\(nextStages\);/,
  "the Polish chooser records the intent to run, then commits the stage selection"
);
assert.match(
  app,
  /if \(!runPolishOnStagesCommitRef\.current\) return;\s*runPolishOnStagesCommitRef\.current = false;\s*void handlePolish\(\);/,
  "the deferred Polish run fires from the committed polishStages, never in the same tick"
);
assert.ok(
  app.indexOf("} = usePolishPipeline({") < app.indexOf("runPolishOnStagesCommitRef.current = false"),
  "the deferred-run effect is registered after usePolishPipeline's fingerprint effect, so that effect sees no run in flight"
);
// Settings owns the DEFAULT stage selection and the Polish action owns the
// per-run pick; both write the one persisted `polishStages` value. The retired
// masthead Options menu must not come back as a third control.
assert.match(
  settingsDialog,
  /onPolishStagesChange/,
  "Settings exposes the default Polish stage selection"
);
assert.ok(
  !existsSync(new URL("../../sections/PolishMenu.tsx", import.meta.url)) &&
    !existsSync(new URL("../../sections/AiMenu.tsx", import.meta.url)),
  "the masthead Options and AI menus stay retired — Settings is the one home for provider and guidance setup"
);

// Every configurable stage is declared once, in config/aiStages.ts. The failure
// this prevents is silent: a stage added to the Settings UI but left pointing at
// another stage's provider still works, so nothing surfaces the mistake. Both
// cover and answers shipped in exactly that state.
assert.match(aiStages, /export const AI_STAGES/, "the stage list is declared in config/aiStages.ts");
for (const stage of ["distill", "tailor", "review", "cover", "answers"]) {
  assert.match(aiStages, new RegExp(`id: "${stage}"`), `aiStages declares the ${stage} stage`);
}
assert.match(
  app,
  /aiRequest: stages\.cover,/,
  "the cover-letter flow runs on its own stage config, not Tailor's"
);
assert.match(
  app,
  /aiRequest: stages\.answers,/,
  "the application-answers flow runs on its own stage config, not Tailor's"
);
assert.doesNotMatch(
  persistedSettings,
  /const STAGE_FIELD_GROUPS: Array<\[keyof PersistedSettings, keyof PersistedSettings, keyof PersistedSettings\]> = \[\s*\[/,
  "persisted stage key groups are derived from the stage list, not hand-listed"
);
// The cover/answers stages inherit Tailor's config when they have none of their
// own. That inheritance MUST live in the seeder: workspaceBackupContract only
// accepts a restored settings bag that round-trips through normalizeSettings
// unchanged, so adding a key there rejects every backup written before that key
// existed — which is exactly what happened when this was tried in settings.ts.
// Seeding is a pure module so it has a test seam without React; the behavior
// itself is covered by src/lib/__evals__/stage-settings-eval.mjs.
assert.match(
  aiSettings,
  /import \{ seedStages, stageFieldsToPersist \} from "\.\.\/lib\/stageSettings";/,
  "the settings hook delegates stage seeding to the pure stageSettings module"
);
assert.doesNotMatch(
  persistedSettings,
  /bag\[keys\.provider\] = bag\[TAILOR_KEYS\.provider\]/,
  "normalizeSettings never adds a stage key — it would break workspace-backup restore"
);

// Anti-fabrication: every candidate fact is opt-in. A default that asserted a
// citizenship, a work-authorization status, or a DEGREE would put an unverified
// claim into the grounding allowlist for a user who never declared it.
assert.match(
  candidateFacts,
  /if \(facts\.citizenshipStatus !== "unspecified"\)/,
  "work-authorization facts are gated on a declared citizenship"
);
assert.match(
  candidateFacts,
  /const educationLine = EDUCATION_CONTEXT\[facts\.educationLevel\];\s*if \(educationLine\) \{/,
  "education facts are gated positively on a known level, so a corrupted level emits nothing"
);
assert.match(
  candidateFacts,
  /unspecified: "",/g,
  "an unspecified fact contributes no prompt line"
);
assert.doesNotMatch(
  candidateFacts,
  /if \(facts\.citizenshipStatus === "unspecified"\) return ""/,
  "citizenship no longer short-circuits the whole block — education is an independent opt-in"
);

// Per-stage guidance: Tailor and Review are separate requests, so a shared
// commonBody carrying one customInstructions would send Review the Tailor text.
assert.doesNotMatch(
  polish,
  /includeCoverLetter,\s*honestContext: requestHonestContext,\s*customInstructions\s*\};/,
  "customInstructions is resolved per stage, not shared through commonBody"
);
assert.match(
  polish,
  /stages: "tailor", customInstructions: customInstructionsFor\("tailor"\)/,
  "the Tailor request carries the Tailor stage's resolved guidance"
);
assert.match(
  polish,
  /customInstructions: customInstructionsFor\("review"\),/,
  "the Review request carries the Review stage's resolved guidance"
);

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

// The stage row keeps provider/model/effort ALWAYS visible. The one disclosure it
// has is scoped to the optional instruction override — the original rule was
// "stage settings are not behind an accordion", and that still holds.
assert.match(
  settingsStage,
  /<section className="settings-stage" aria-labelledby=\{headingId\}>[\s\S]*<h3 id=\{headingId\}/,
  "each AI stage is an always-rendered semantic section with a labelled heading"
);
assert.doesNotMatch(
  settingsStage.slice(0, settingsStage.indexOf("settings-stage__extra")),
  /aria-expanded|\bonToggle\b/,
  "nothing above the instruction override is collapsible — provider, model, and effort stay visible"
);
assert.match(
  settingsStage,
  /aria-expanded=\{instructionsOpen\}/,
  "the only disclosure is the per-stage instruction override, and it reports its state"
);
assert.match(
  settingsStage,
  /\{!instructionsOpen && hasInstructions \? \(/,
  "a set-but-collapsed override still shows a preview — guidance being sent is never invisible"
);
assert.match(
  settingsStage,
  /\{!selectedConnection\?\.ready \? \([\s\S]*selectedConnection \? selectedConnection\.guidance : availabilityMessage[\s\S]*Check providers/,
  "provider descriptions stay hidden for ready providers while unavailable providers retain recovery guidance"
);
// Every declared stage gets a settings row, and none is filtered out.
assert.match(
  settingsDialog,
  /\{AI_STAGES\.map\(\(stage\) => \([\s\S]*<SettingsStage/,
  "Settings renders one stage row per declared stage, with no open-stage filter"
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

assert.match(
  reviewRail,
  /const invalidDropCount = Math\.max\(0, \(result\.droppedSuggestions\?\.total \?\? 0\) - unsupportedDropCount\)[\s\S]*if \(!sr && !suggestions\.length && unsupportedDropCount === 0 && invalidDropCount === 0\) return null/,
  "the review rail remains visible for all-drop results and separates invalid response-shape drops"
);
assert.match(
  reviewRail,
  /\{unsupportedDropCount\} AI[\s\S]*wording wasn.t supported by your resume or honest context/,
  "unsupported AI edits remain visible as evidence-grounding rejections"
);
assert.match(
  reviewRail,
  /\{invalidDropCount\} \{unsupportedDropCount > 0 \? "additional AI " : "AI "\}[\s\S]*not be applied safely/,
  "invalid AI edits are visible with grammatical copy whether or not unsupported edits also exist"
);
assert.doesNotMatch(appIndex, /fonts\.googleapis\.com|fonts\.gstatic\.com/, "the local-first app does not fetch external web fonts");
assert.match(styleTokens, /@font-face[\s\S]*SourceSans3-Regular\.woff2[\s\S]*SourceSerif4-Regular\.woff2/, "app chrome uses bundled local font assets");

// Replacing the cover letter ALWAYS confirms first, whatever replaces it. The
// Open menu's saved list bypassed this and discarded unsaved edits silently,
// while Blank, Starter, and the file picker all asked.
assert.match(
  coverToolbar,
  /async function openSaved\(fileName: string\) \{\s*if \(await confirmReplace\(\)\)/,
  "opening a saved letter confirms before discarding unsaved edits"
);
assert.match(
  coverToolbar,
  /async function restoreSaved\(key: string\) \{\s*if \(await confirmReplace\(\)\)/,
  "restoring a letter version confirms before discarding unsaved edits"
);
assert.doesNotMatch(
  coverToolbar,
  /onOpen: \(\) => void editor\.(openWorkspace|restoreWorkspace)CoverLetter\(/,
  "no saved-list row calls the workspace loader directly, bypassing the confirm"
);

// A document that did not come from the workspace clears the active pointer, so
// Save cannot offer to overwrite an unrelated saved letter with it.
for (const starter of ["startBlank", "startStarter"]) {
  const body = coverEditor.slice(coverEditor.indexOf(`const ${starter} = useCallback`));
  assert.match(
    body.slice(0, body.indexOf("}, [")),
    /setActiveCoverFileName\(""\)/,
    `${starter} clears the active workspace file`
  );
}
assert.match(
  coverEditor,
  /setActiveCoverFileName\(""\);[\s\S]{0,200}?setDocumentTitle\(fileBase \|\| "Cover letter"\)/,
  "opening an uploaded .cover clears the active workspace file"
);

// `variant` is slugged by the server; `fileName` is not. Sending the active file
// name as a variant mangled it into cover-letter-cover-letter-<x>-cover.cover.
assert.match(
  coverEditor,
  /fileName: target\?\.fileName \?\? \(target\?\.variant \? undefined : activeCoverFileName \|\| undefined\)/,
  "the active workspace file is sent as fileName, never re-slugged as a variant"
);

// Per-document application saves. The behavior of the patches themselves is
// covered by lib/__evals__/application-documents-eval.mjs; these guard the
// wiring that keeps the saves explicit and pointed at one existing record.
const documentSync = readHook("useApplicationDocumentSync.ts");
assert.match(
  applications,
  /const patchApplication = useCallback\(\s*\(id: string, patch: Partial<Application>\): Promise<boolean>/,
  "a partial application update reports whether it was persisted"
);
assert.match(
  applications,
  /if \(idx < 0\) return Promise\.resolve\(false\)/,
  "patching a vanished application resolves false instead of silently succeeding"
);
assert.match(
  documentSync,
  /const saved = await patchApplication\(application\.id, patch\)/,
  "a document save awaits the tracker write before reporting success"
);
assert.match(
  documentSync,
  /if \(!application\) return;/,
  "a document save without an application is a no-op — Apply creates the record"
);
assert.doesNotMatch(
  documentSync,
  /useEffect\([\s\S]{0,400}?\bsave\(/,
  "no effect saves a document: regeneration and editing never rewrite the application"
);
assert.match(
  documentSync,
  /if \(applicationMatchesJobTarget\(linked, jobUrl, jobDescription\)\) return;\s*setLinkedId\(null\)/,
  "the remembered application is dropped once the desk points at another posting"
);
assert.match(
  applyFlow,
  /applyMergeTargetRef\.current = null;[\s\S]{0,200}?linkApplication\(existing\?\.id \?\? app\.id\)/,
  "a confirmed Apply links the session to that one application"
);
assert.match(
  app,
  /duplicateGuard\.ackApplication\(app\);[\s\S]{0,400}?linkApplication\(app\.id\)/,
  "restoring a tracked application links later document saves to it"
);
assert.match(
  app,
  /coverLetterText: coverLetterEditor\.text,\s*patchApplication,/,
  "the letter's saved/unsaved state is measured against the live editor content"
);

// Editor parity: the cover letter recovers unsaved work the way the resume
// does, instead of only warning that it is unsaved, and neither editor keeps a
// private restore path the other lacks.
const coverDraft = readHook("useCoverLetterAutosaveDraft.ts");
const draftStorage = readFileSync(new URL("../../lib/autosaveDraftStorage.ts", import.meta.url), "utf8");
const coverTab = readFileSync(new URL("../../sections/tabs/CoverLetterTab.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  coverToolbar,
  /Unsaved cover letter"/,
  "the letter reports recovery state, not a bare unsaved warning"
);
assert.match(
  coverToolbar,
  /draftAutosaveState === "saved"\s*\?\s*\{ state: "saved", label: "Recovery draft saved" \}/,
  "the letter uses the resume's recovery vocabulary"
);
assert.doesNotMatch(coverToolbar, /Restore source/, "the AI restore-source button is gone from the letter toolbar");
assert.doesNotMatch(
  coverEditor,
  /sourceBeforeTailor|captureTailorSource|restoreTailorSource/,
  "the pre-tailoring source state left with the button it served"
);
assert.doesNotMatch(cover, /onCaptureSource/, "the cover workflow no longer captures a pre-tailoring source");
assert.match(
  coverDraft,
  /saveTabDraft\("cover"/,
  "the letter's draft is written under its own kind, never the resume's key"
);
assert.match(
  coverEditor,
  /editor\.markClean\(\);\s*setPersistedFingerprint\(payload\);[\s\S]{0,200}?clearCoverLetterAutosaveDraft\(\)/,
  "the recovery draft is cleared only once the letter itself is durable"
);
assert.match(
  coverEditor,
  /const openRecoveryDraft[\s\S]{0,400}?editor\.markClean\(\)/,
  "restoring a letter draft seeds clean, like the resume restore"
);
assert.match(coverTab, /DraftRestoreBar/, "the letter offers the same restore bar the resume does");
assert.match(
  draftStorage,
  /if \(ownerId !== "" && live\.has\(ownerId\)\) continue;/,
  "one shared recovery rule protects a live sibling tab's draft for both editors"
);
assert.match(
  app,
  /completeAutoDocumentTitle\("coverLetter", current, applicantName, company, COVER_LETTER_TITLE_PLACEHOLDERS\)/,
  "the letter is named on the same Name_Company_<kind> rule as the resume"
);
for (const kind of ["resume", "coverLetter"]) {
  assert.equal(
    app.match(new RegExp(`documentTitleForJob\\("${kind}"`, "g"))?.length,
    2,
    `both a job import and a tracker restore retitle the ${kind} for the new role`
  );
}

console.log(`Client workflow guards eval: ${checkCount}/${checkCount} checks passed`);
