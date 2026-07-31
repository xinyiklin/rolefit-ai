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
const prepareTab = readFileSync(new URL("../../sections/tabs/PrepareTab.tsx", import.meta.url), "utf8");
const preparedMaterialCard = readFileSync(
  new URL("../../sections/tabs/prepare/PreparedMaterialCard.tsx", import.meta.url),
  "utf8"
);
const preparedVariantRecommendation = readFileSync(
  new URL("../../sections/tabs/prepare/PreparedVariantRecommendation.tsx", import.meta.url),
  "utf8"
);
const preparedJobBriefRows = readFileSync(
  new URL("../../sections/tabs/prepare/PreparedJobBriefRows.tsx", import.meta.url),
  "utf8"
);
const prepareApplicationRail = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const preparationReadiness = readFileSync(new URL("../../lib/preparationReadiness.ts", import.meta.url), "utf8");
const preparedJobBrief = readFileSync(new URL("../../lib/preparedJobBrief.ts", import.meta.url), "utf8");
const variantRecommendation = readFileSync(new URL("../../lib/variantRecommendation.ts", import.meta.url), "utf8");
const workspaceResume = readHook("useWorkspaceResume.ts");
const coverLetterRepository = readFileSync(
  new URL("../../lib/coverLetterWorkspaceRepository.ts", import.meta.url),
  "utf8"
);
const masthead = readFileSync(new URL("../../sections/Masthead.tsx", import.meta.url), "utf8");
const applicationModal = readFileSync(new URL("../../sections/ApplicationModal.tsx", import.meta.url), "utf8");
const trackerTab = readFileSync(new URL("../../sections/tabs/TrackerTab.tsx", import.meta.url), "utf8");
const settingsStage = readFileSync(new URL("../../sections/SettingsStage.tsx", import.meta.url), "utf8");
const reviewRail = readFileSync(new URL("../../sections/ReviewRail.tsx", import.meta.url), "utf8");
const appIndex = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const styleTokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const prepareStyles = readFileSync(new URL("../../styles/prepare.css", import.meta.url), "utf8");
const aiSettings = readHook("useAiSettings.ts");
const persistedSettings = readFileSync(new URL("../../lib/settings.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const coverEditor = readHook("useCoverLetterEditor.ts");
const coverPreflight = readFileSync(new URL("../../lib/coverLetterPreflight.ts", import.meta.url), "utf8");
const resumeTab = readFileSync(new URL("../../sections/tabs/ResumeTab.tsx", import.meta.url), "utf8");
const coverTab = readFileSync(new URL("../../sections/tabs/CoverLetterTab.tsx", import.meta.url), "utf8");
const coverReview = readFileSync(new URL("../../sections/cover-letter/CoverLetterReview.tsx", import.meta.url), "utf8");
const coverToolbar = readFileSync(
  new URL("../../sections/cover-letter/CoverLetterToolbar.tsx", import.meta.url),
  "utf8"
);
const settingsDialog = readFileSync(new URL("../../sections/SettingsDialog.tsx", import.meta.url), "utf8");
const candidateFacts = readFileSync(new URL("../../lib/candidateFacts.ts", import.meta.url), "utf8");
const aiStages = readFileSync(new URL("../../config/aiStages.ts", import.meta.url), "utf8");
const intakeFingerprintStart = intake.indexOf("const distillInputFingerprint = workflowInputFingerprint({");
const intakeFingerprint = intake.slice(intakeFingerprintStart, intake.indexOf("});", intakeFingerprintStart) + 3);
const polishFingerprintStart = polish.indexOf("const inputFingerprint = workflowInputFingerprint({");
const polishFingerprint = polish.slice(polishFingerprintStart, polish.indexOf("});", polishFingerprintStart) + 3);
const answersFingerprintStart = answers.indexOf("const inputFingerprint = workflowInputFingerprint({");
const answersFingerprint = answers.slice(answersFingerprintStart, answers.indexOf("});", answersFingerprintStart) + 3);
const coverFingerprintStart = cover.indexOf("const inputFingerprint = workflowInputFingerprint({");
const coverFingerprint = cover.slice(coverFingerprintStart, cover.indexOf("});", coverFingerprintStart) + 3);

assert.match(
  applications,
  /applications: applicationMutationRecords\(next, mutations\),[\s\S]*mutations/,
  "application writes send only explicit upsert records with their mutations"
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
assert.match(
  applications,
  /setPendingWrites\(\(count\) => count \+ 1\)/,
  "tracker writes increment reactive pending state"
);
assert.match(applications, /finally \{[\s\S]*setPendingWrites/, "tracker writes always release reactive pending state");

const awaitedSave = applyFlow.indexOf("saved = await persistAppliedApplication(app)");
const failedSave = applyFlow.indexOf("if (!saved)", awaitedSave);
const artifactSave = applyFlow.indexOf("const savedDocuments = await saveAppliedDocumentArtifacts(", failedSave);
const documentVersionCapture = applyFlow.indexOf("const expectedDocumentVersions =");
const resumeRecoveryClear = applyFlow.indexOf("if (savedDocuments.resumeSaved) onResumeSaved();", artifactSave);
const coverRecoveryClear = applyFlow.indexOf("if (savedDocuments.coverSaved) onCoverLetterSaved();", artifactSave);
assert.ok(awaitedSave >= 0 && failedSave > awaitedSave, "Apply awaits tracker persistence");
assert.ok(
  documentVersionCapture >= 0 && documentVersionCapture < awaitedSave,
  "Apply captures document versions before the tracker write can yield to editor changes"
);
assert.ok(artifactSave > failedSave, "document artifacts start only after the application is confirmed");
assert.ok(
  resumeRecoveryClear > artifactSave && coverRecoveryClear > resumeRecoveryClear,
  "Apply settles each document's recovery state only after its own editable source persists"
);
assert.match(
  applyFlow,
  /const resume = selection\.resume[\s\S]{0,180}?getResumeArtifacts\(\)/,
  "Apply only snapshots a resume when the captured package includes it"
);
assert.match(
  applyFlow,
  /const cover = selection\.coverLetter[\s\S]{0,180}?getCoverLetterArtifacts\(\)/,
  "Apply only snapshots a cover letter when the captured package includes it"
);
assert.match(
  applyFlow,
  /const storedResume = selection\.resume[\s\S]{0,240}?saveApplicationDocument\(id, "resume", resume\)/,
  "Apply only persists the included resume slot"
);
assert.match(
  applyFlow,
  /const storedCover = selection\.coverLetter[\s\S]{0,240}?saveApplicationDocument\(id, "cover", cover\)/,
  "Apply only persists the included cover-letter slot"
);
assert.match(
  applyFlow,
  /Excluding a[\s\S]{0,180}?never deletes an older tracker artifact/,
  "excluding a material on re-Apply is explicitly non-destructive"
);

for (const [name, source] of [
  ["answers", answers],
  ["cover", cover],
  ["polish", polish]
]) {
  assert.match(source, /workflowRequestIsCurrent/, `${name} generation checks use the shared current-request guard`);
  assert.match(source, /AbortController/, `${name} owns an abort controller`);
}
assert.match(
  answers,
  /if \(!providerReady\)/,
  "answer generation fails closed before requesting an unavailable provider"
);
assert.match(cover, /if \(!providerReady\)/, "cover generation fails closed before requesting an unavailable provider");
assert.doesNotMatch(
  coverTab,
  /placeholders\.length[^;\n]*(?:canTailor|disabled)/,
  "source template slots never disable Tailor"
);
assert.doesNotMatch(
  coverPreflight,
  /(?:authoredWordCount|requiresUserVoiceAnchor)[^;\n]*(?:blockers|canTailor)/,
  "authored word count is a voice signal, never a tailoring gate"
);
assert.doesNotMatch(coverReview, /Â/, "cover-letter readiness copy contains no mojibake");
// One click, one request: no prepare/draft split and nothing to approve first.
assert.equal(
  cover.match(/await fetch\("\/api\/cover-letter"/g)?.length,
  1,
  "the cover-letter workflow makes exactly one kind of model request"
);
assert.doesNotMatch(
  cover,
  /pendingProposal|acceptProposal|evidenceOverrides|selectedEvidence|clarification/i,
  "no preparation plan, evidence override, or proposal acceptance survives"
);
assert.match(
  cover,
  /onApplyTailored\(result\.coverLetterText\)[\s\S]{0,200}?setCoverProgress\(\{\s*status: "done"/,
  "a valid letter enters the editor directly, then reports"
);
assert.match(
  coverEditor,
  /capturePreTailorSnapshot\(\s*editor\.editedResume[\s\S]{0,240}?editor\.seedData\(data\)/,
  "the exact pre-tailor .cover is captured before the replacement, not after"
);
assert.match(
  coverEditor,
  /const restorePreTailor[\s\S]{0,400}?parseCoverLetterFile\(preTailorSnapshot\)/,
  "Restore replays the structured document, not its plain text"
);
assert.match(cover, /if \(!tailorApplied\) setLastResult\(null\)/, "the result summary and Restore share one lifetime");
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
assert.match(polishFingerprint, /polishStages/, "the polish fingerprint still guards the selected stages");
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
assert.match(settingsDialog, /onPolishStagesChange/, "Settings exposes the default Polish stage selection");
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
assert.match(app, /aiRequest: stages\.cover,/, "the cover-letter flow runs on its own stage config, not Tailor's");
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
assert.match(candidateFacts, /unspecified: "",/g, "an unspecified fact contributes no prompt line");
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
  intake.match(/const readinessInputFingerprint = distillInputFingerprintRef\.current;/g)?.length,
  2,
  "link and paste preparation bind provider readiness to the inputs that requested it"
);
assert.equal(
  intake.match(/readinessInputFingerprint !== distillInputFingerprintRef\.current/g)?.length,
  2,
  "link and paste preparation reject input changes that occur during provider readiness"
);
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
  existsSync(new URL("../../sections/JobMenu.tsx", import.meta.url)),
  false,
  "the retired Job menu cannot return as a second job-intake surface"
);
assert.match(
  trackerTab,
  /onClick=\{onPrepareApplication\}[\s\S]{0,120}?Prepare application/,
  "the tracker routes new application intake to Prepare"
);
assert.match(
  applicationModal,
  /if \(!open \|\| !application\) return null;/,
  "the application modal edits existing records and cannot expose a second add-job surface"
);
assert.doesNotMatch(
  applicationModal,
  /Add application|attach the job description here/,
  "the existing-application modal does not advertise parallel job intake"
);
assert.match(
  prepareTab,
  /type="url"[\s\S]{0,180}?value=\{jobUrl\}[\s\S]{0,180}?onChange=\{\(event\) => onJobUrlChange\(event\.target\.value\)\}/,
  "Prepare owns the manual job-URL input"
);
assert.match(
  prepareTab,
  /<textarea[\s\S]{0,320}?value=\{preparationSourceText\}[\s\S]{0,320}?onChange=\{\(event\) =>\s*onJobDescriptionChange\(event\.target\.value\)\s*\}/,
  "Prepare's source editor shows the full captured posting before replacement"
);
assert.equal(
  prepareTab.match(/disabled=\{isPreparing\}/g)?.length,
  3,
  "Prepare locks both source inputs and the prepared brief while preparation owns the job"
);
assert.match(
  prepareTab,
  /<fieldset\s+className="prepare-brief-fields"\s+disabled=\{isPreparing\}\s*>/,
  "the prepared brief cannot race an in-flight extraction"
);
assert.match(
  prepareTab,
  /const canFetch\s*=\s*Boolean\(jobUrl\.trim\(\)\)\s*&&\s*!isPreparing\s*&&\s*distillProviderReady/,
  "Prepare's URL action requires input, an idle workflow, and an available provider"
);
assert.match(
  prepareTab,
  /const preparationSourceText = jobRawText \|\| jobDescription;[\s\S]{0,180}?const canPreparePaste =\s*preparationSourceText\.trim\(\)\.length >= 80/,
  "Prepare keeps the immutable captured source visible through URL edits and uses it for preparation"
);
assert.match(
  prepareTab,
  /onClick=\{\(\) => void onPreparePosting\(preparationSourceText\)\}/,
  "Prepare actions re-distill the captured or edited posting rather than the compact prepared brief"
);
assert.equal(
  prepareTab.match(/onPreparePosting\(preparationSourceText\)/g)?.length,
  2,
  "both Prepare again and the source form submit the displayed full posting"
);
assert.match(
  prepareTab,
  /disabled=\{!canFetch\}/,
  "the visible URL preparation button consumes the shared readiness gate"
);
assert.equal(
  prepareTab.match(/disabled=\{!canPreparePaste\}/g)?.length,
  2,
  "Prepare and Prepare again consume the same paste readiness gate"
);
assert.doesNotMatch(
  prepareTab,
  /Application workspace|Prepare from the job posting|<p[^>]*>\s*Recommended\s*<\/p>/,
  "Prepare uses the same plain page-header hierarchy as the other studio pages"
);
assert.match(
  preparedJobBriefRows,
  /const \[rows, setRows\] = useState<string\[\]>/,
  "prepared-brief fields retain transient typing separately from normalized domain values"
);
assert.match(
  preparedJobBriefRows,
  /onChange=\{\(event\) => updateRow\(index, event\.target\.value\)\}[\s\S]{0,100}?onBlur=\{\(\) => commitRows\(rows\)\}/,
  "prepared-brief normalization happens only when the user commits the field"
);
assert.match(
  prepareTab,
  /className="sr-only"[\s\S]{0,120}?role="status"[\s\S]{0,120}?aria-live="polite"[\s\S]{0,120}?aria-atomic="true"/,
  "variant recommendation completion remains in one persistent polite live region"
);
assert.match(
  prepareTab,
  /className="prepare-action-hint"[\s\S]{0,100}?id="prepare-fetch-action-hint"/,
  "disabled preparation actions expose visible recovery guidance"
);
assert.match(
  masthead,
  /aria-label="Apply prepared application"[\s\S]{0,320}?save included materials/,
  "masthead Apply describes the application-level package rather than promising a resume"
);
assert.match(
  prepareApplicationRail,
  /resumeArtifacts\?\.hasSource[\s\S]{0,100}?resumeArtifacts\?\.hasPdf[\s\S]{0,220}?coverLetterArtifacts\?\.hasSource[\s\S]{0,100}?coverLetterArtifacts\?\.hasPdf/,
  "saved-application readiness recognizes either strict source or PDF artifacts"
);
assert.match(
  prepareTab,
  /role="tablist"[\s\S]{0,100}?aria-label="Job source method"/,
  "URL and pasted-text intake share one labelled method selector"
);
assert.equal(
  prepareTab.match(/role="tabpanel"/g)?.length,
  2,
  "URL and pasted-text intake render as two views of one source task"
);
assert.match(
  prepareTab,
  /onKeyDown=\{handleSourceMethodKeyDown\}/,
  "the source method tabs implement keyboard navigation"
);
assert.match(
  prepareTab,
  /className=\{`prepare-layout \$\{jobPrepared \? "is-prepared" : "is-intake"\}`\}/,
  "Prepare changes topology explicitly between intake and prepared states"
);
assert.match(
  prepareStyles,
  /\.prepare-layout\.is-intake\s*\{[\s\S]{0,100}?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  "unprepared intake does not reserve an empty rail column"
);
assert.match(
  prepareStyles,
  /\.prepare-layout\.is-intake \.prepare-job-brief\s*\{[\s\S]{0,80}?display:\s*none/,
  "the unprepared state hides the empty job-brief scaffold"
);
assert.match(
  prepareStyles,
  /\.prepare-include-toggle\s*\{[\s\S]{0,600}?min-height:\s*32px/,
  "material Include toggles retain a usable pointer target"
);
// The visually hidden checkbox is absolutely positioned. Without a positioned
// label it resolves against the initial containing block, strands itself outside
// the scrolled content, and extends the scrollable area under the last row.
assert.match(
  prepareStyles,
  /\.prepare-include-toggle\s*\{[\s\S]{0,600}?position:\s*relative/,
  "the Include toggle contains its own visually hidden checkbox"
);
// One note treatment carries every secondary Prepare line (blocked-action
// guidance, live status, safety notes, the variant recommendation), so it is the
// single place a decorative stripe or tinted panel could reappear.
const prepareNoteStyles = prepareStyles.match(/\.prepare-note\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
assert.notEqual(prepareNoteStyles, "", "Prepare keeps one shared treatment for its secondary status lines");
assert.doesNotMatch(
  prepareNoteStyles,
  /border-left:|background:/,
  "Prepare status treatments stay plain text rather than decorative stripes or tinted panels"
);
assert.doesNotMatch(
  prepareStyles,
  /\.prepare-gaps > div\s*\{[^}]*background:/,
  "extraction and candidate gaps stay flat columns instead of cards inside the brief panel"
);
for (const field of [
  "role",
  "company",
  "location",
  "jobType",
  "source",
  "workAuth",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
  "roleDescription"
]) {
  assert.match(
    prepareTab,
    new RegExp(`onJobTrackingChange\\(\\s*"${field}"`),
    `Prepare keeps extracted ${field} metadata manually editable`
  );
}
for (const field of [
  "responsibilities",
  "requiredQualifications",
  "preferredQualifications",
  "techKeywords",
  "senioritySignals",
  "domainSignals",
  "benefits"
]) {
  // Multi-item sections are declared as BRIEF_SECTIONS descriptors (field: "x")
  // and rendered as tabbed row lists.
  assert.match(
    prepareTab,
    new RegExp(`(?:onJobBriefChange\\("${field}"|field[:=]\\s*"${field}")`),
    `Prepare keeps extracted ${field} details manually editable`
  );
}
assert.match(
  prepareTab,
  /<span>Role context<\/span>[\s\S]{0,240}?value=\{preparedJobRoleContext\(tracking, brief\)\}/,
  "Prepare exposes one unified role-context field"
);
assert.doesNotMatch(
  prepareTab,
  /Company \/ product context/,
  "Prepare does not expose the legacy context as a second prose field"
);
assert.match(
  app,
  /field === "roleDescription"[\s\S]{0,120}?companyContext: ""/,
  "editing the unified role context clears the hidden legacy split atomically"
);
assert.match(
  prepareTab,
  /Extraction gaps[\s\S]{0,700}?manualReviewFields/,
  "Prepare exposes the structured fields Distill could not extract"
);
assert.match(
  prepareTab,
  /Candidate gaps[\s\S]{0,700}?reviewGaps/,
  "Prepare exposes candidate-to-job gaps beside the prepared brief"
);
assert.equal(
  prepareTab.match(/<PreparedMaterialCard/g)?.length,
  2,
  "Resume and cover letter use the same material-card component"
);
assert.match(
  preparedMaterialCard,
  /type="checkbox"[\s\S]{0,100}?aria-label=\{`Include \$\{title\.toLowerCase\(\)\}`\}[\s\S]{0,180}?onIncludedChange\(event\.target\.checked\)/,
  "the shared material card exposes one material-specific accessible Include toggle"
);
assert.match(
  preparedMaterialCard,
  /prepare-material__identity[\s\S]{0,500}?prepare-include-toggle[\s\S]{0,700}?prepare-material__variant[\s\S]{0,500}?prepare-material__actions/,
  "material controls keep their DOM and visual reading order aligned in the rail"
);
for (const material of ["prepare-resume", "prepare-cover"]) {
  assert.match(
    prepareTab,
    new RegExp(`id="${material}"[\\s\\S]{0,260}?included=\\{include(?:Resume|CoverLetter)\\}`),
    `${material} exposes the shared Include control`
  );
}
assert.match(
  prepareTab,
  /variantLabel="Resume variant"[\s\S]{0,400}?variantOptions=\{baseResumeOptions\}/,
  "the resume card exposes saved resume variants"
);
assert.match(
  prepareTab,
  /variantDisabled=\{\s*isSelectingResume\s*\|\|\s*isPolishing\s*\|\|\s*isRankingResumeVariants/,
  "the resume selector cannot launch overlapping variant loads"
);
assert.match(
  prepareTab,
  /variantLabel="Cover-letter variant"[\s\S]{0,400}?variantOptions=\{coverLetterOptions\}/,
  "the cover-letter card exposes saved cover-letter variants"
);
assert.match(
  prepareTab,
  /variantDisabled=\{\s*isSelectingCoverLetter[\s\S]{0,180}?isRankingCoverLetterVariants/,
  "the cover-letter selector follows the resume selector's ranking lock"
);
assert.doesNotMatch(
  prepareTab,
  /Optional document|A cover letter never blocks Apply|>\s*Optional\s*</,
  "neither material is labelled optional"
);
assert.match(
  prepareApplicationRail,
  /<h3>Application<\/h3>[\s\S]{0,500}?\{children\}[\s\S]{0,1200}?prepare-fit[\s\S]{0,1200}?prepare-readiness/,
  "the prepared rail combines material decisions with readiness instead of reserving a sparse status column"
);
assert.match(
  prepareApplicationRail,
  /<p className="prepare-page__eyebrow">Fit<\/p>[\s\S]{0,900}?Not reviewed[\s\S]{0,200}?Run Review/,
  "Prepare names fit as unreviewed until a provider-backed Review exists"
);
assert.match(
  app,
  /const prepareFitAssessment =[\s\S]{0,900}?provenance: "current"[\s\S]{0,900}?provenance: "saved"/,
  "Prepare prefers the current Review and otherwise labels a matching saved review as historical"
);
const prepareFitStyles = prepareStyles.match(/\.prepare-fit\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
assert.notEqual(prepareFitStyles, "", "Prepare gives the fit summary a dedicated flat rail row");
assert.match(prepareFitStyles, /border-top:/, "the fit row uses the rail's divider hierarchy");
assert.doesNotMatch(
  prepareFitStyles,
  /background:|box-shadow:|border-left:/,
  "the fit row does not become a nested or tinted card"
);
assert.match(
  prepareApplicationRail,
  /disabled=\{!readiness\.canApply \|\| isApplying\}/,
  "the Prepare Apply control consumes the shared readiness result"
);
assert.match(
  preparedJobBrief,
  /benefits:\s*extractBenefitsFromPosting\(sourceText\)/,
  "the prepared brief extracts benefits separately from the tailoring scaffold"
);
const tailoringAssemblyStart = preparedJobBrief.indexOf("export function assemblePreparedJobTailoringText");
const tailoringAssemblyEnd = preparedJobBrief.indexOf(
  "export function assemblePreparedJobApplicationText",
  tailoringAssemblyStart
);
assert.doesNotMatch(
  preparedJobBrief.slice(tailoringAssemblyStart, tailoringAssemblyEnd),
  /benefits/,
  "benefits remain visible preparation context without widening candidate-tailoring input"
);

const outputTabsStart = app.indexOf("const OUTPUT_TABS:");
const outputTabsEnd = app.indexOf("];", outputTabsStart) + 2;
const outputTabs = app.slice(outputTabsStart, outputTabsEnd);
assert.match(
  outputTabs,
  /=\s*\[\s*\{\s*id:\s*"prepare",\s*label:\s*"Prepare",\s*group:\s*"PREPARE"\s*\}/,
  "Prepare is the first sidebar destination and owns the PREPARE group"
);
assert.match(app, /useState<OutputTab>\("prepare"\)/, "new sessions default to Prepare");
assert.ok(
  app.indexOf('activeOutputTab === "prepare"') < app.indexOf('activeOutputTab === "resume"'),
  "App renders Prepare before the drafting destinations"
);
assert.match(
  app,
  /activeOutputTab === "prepare"[\s\S]{0,100}?<PrepareTab/,
  "the Prepare route renders the dedicated intake page"
);
assert.doesNotMatch(app, /\bjobControl\b/, "App no longer wires job controls into the masthead");
assert.doesNotMatch(masthead, /\bjobControl\b/, "Masthead exposes Sessions and Apply without a hidden job-intake slot");

assert.match(
  app,
  /onExtensionPrepareStarted:\s*\(\)\s*=>\s*setActiveOutputTab\("prepare"\),[\s\S]{0,120}?onExtensionJobReceived:\s*\(\)\s*=>\s*setActiveOutputTab\("prepare"\)/,
  "both extension lifecycle callbacks navigate to Prepare"
);
const extensionDeliveryStart = intake.indexOf("async (item: ExtensionImport) => {");
const extensionProgressStart = intake.indexOf("() => {", extensionDeliveryStart + 1);
const extensionDelivery = intake.slice(extensionDeliveryStart, extensionProgressStart);
const extensionProgressEnd = intake.indexOf("extensionImportsReady", extensionProgressStart);
const extensionProgress = intake.slice(extensionProgressStart, extensionProgressEnd);
assert.match(
  extensionDelivery,
  /async \(item: ExtensionImport\) => \{\s*onExtensionJobReceived\(\);/,
  "delivery selects Prepare before any delivered job state changes"
);
assert.match(
  extensionProgress,
  /\(\) => \{\s*onExtensionPrepareStarted\(\);/,
  "the extension progress callback selects Prepare before reporting progress"
);

const autoTailorStart = app.indexOf("// Auto-tailor remains a Prepare workflow.");
const autoTailorEnd = app.indexOf("const applicationPreparationActive", autoTailorStart);
const autoTailorEffect = app.slice(autoTailorStart, autoTailorEnd);
const dirtyPause = autoTailorEffect.indexOf("resumeDocumentDirty");
const variantPause = autoTailorEffect.indexOf("resumeVariantRecommendation &&");
const autoTailorRun = autoTailorEffect.indexOf("handlePolish({ revealResumeOnSuccess: false })");
assert.ok(
  dirtyPause >= 0 && variantPause > dirtyPause && autoTailorRun > variantPause,
  "automatic tailoring pauses for a dirty editor or an unresolved variant comparison before it can run"
);
assert.doesNotMatch(
  autoTailorEffect,
  /loadBaseResumeVersion/,
  "the tailoring effect never replaces a resume; selection belongs to the guarded recommendation effect"
);
const variantRankingStart = app.indexOf("const rankingJobDescription");
const variantRankingEnd = app.indexOf("// Auto-tailor remains a Prepare workflow.", variantRankingStart);
const variantRanking = app.slice(variantRankingStart, variantRankingEnd);
assert.match(
  variantRanking,
  /readBaseResumeCandidates\(options\)/,
  "variant recommendation compares the actual saved resume documents"
);
assert.match(
  variantRanking,
  /recommendVariant\(\s*rankingJobDescription,\s*candidates,\s*options\.length\s*\)/,
  "variant recommendation ranks every expected candidate against the captured prepared job"
);
assert.match(
  variantRanking,
  /const rankingJobDescription = debouncedPreparedJobDescription\.trim\(\);[\s\S]{0,220}?rankingJobDescription === jobDescription\.trim\(\)/,
  "variant ranking cannot start until the debounced text is the current prepared job"
);
assert.match(
  variantRanking,
  /(?:resumeVariantSelectionStateRef\.current|latest)\.preparedJobDescription\s*!==\s*rankingJobDescription/,
  "an in-flight candidate read is discarded immediately when the prepared job changes"
);
assert.match(
  variantRanking,
  /recommendation !== null[\s\S]{0,350}?!current\.resumeDocumentDirty/,
  "a unique resume recommendation is adopted only while the editor is clean"
);
assert.match(
  variantRanking,
  /await current\.loadBaseResumeVersion\(\s*recommendation\.fileName,[\s\S]{0,350}?latest\.preparedJobDescription !== rankingJobDescription/,
  "a unique resume winner is adopted through the guarded workspace loader"
);
assert.match(
  variantRanking,
  /candidatesRevision: baseResumeCandidatesRevision/,
  "variant ranking invalidates when authoritative saved candidate contents may have changed"
);
assert.match(
  variantRanking,
  /latest\.preparedJobDescription !== rankingJobDescription[\s\S]{0,100}?latest\.applicationOfRecordId !== null/,
  "an in-flight automatic variant load cannot replace a resume restored from an application of record"
);
assert.match(
  variantRecommendation,
  /SECTION_WEIGHTS[\s\S]{0,220}?"required qualifications", 5[\s\S]{0,220}?"tech stack \/ keywords", 4/,
  "variant ranking gives required qualifications and the declared tech stack more weight than context"
);
assert.match(
  variantRecommendation,
  /if \(best\.score <= 0 \|\| lead < minimumLead\) return null/,
  "a tie or negligible edge is not presented as a recommendation"
);
assert.match(
  workspaceResume,
  /const readBaseResumeCandidates = useCallback[\s\S]{0,1600}?Promise\.all/,
  "workspace recommendation reads every available resume candidate without adopting it"
);
assert.match(
  workspaceResume,
  /function updateWorkspaceState[\s\S]{0,800}?setBaseResumeCandidatesRevision\(\(revision\) => revision \+ 1\)/,
  "authoritative workspace snapshots invalidate cached candidate-content rankings"
);

// Cover letters use the same safe auto-selection contract as resumes.
const coverRankingStart = app.indexOf("// Cover letters follow the same rule as resumes");
const coverRanking = app.slice(
  coverRankingStart,
  app.indexOf("// Auto-tailor remains a Prepare workflow.", coverRankingStart)
);
assert.ok(coverRankingStart >= 0, "Prepare ranks saved cover letters against the prepared job");
assert.match(
  coverRanking,
  /readCoverLetterVariantCandidates\(options\)/,
  "cover-letter recommendation compares the actual saved letters"
);
assert.match(
  coverRanking,
  /recommendVariant\(rankingJobDescription, candidates, options\.length, 40\)/,
  "a cover letter is ranked against its own usable-length floor, not the resume's"
);
assert.match(
  coverRanking,
  /candidatesRevision: coverLetterEditor\.coverLetterCandidatesRevision/,
  "cover-letter ranking invalidates when authoritative saved letters may have changed"
);
assert.match(
  coverRanking,
  /recommendation !== null[\s\S]{0,400}?!current\.dirty[\s\S]{0,240}?await current\.openWorkspaceCoverLetter\(\s*recommendation\.fileName,\s*"recommendation"/,
  "a unique cover-letter winner is auto-selected only while the editor is clean"
);
assert.match(
  coverRanking,
  /latest\.applicationOfRecordId !== null[\s\S]{0,120}?latest\.dirty[\s\S]{0,120}?latest\.activeFileName !== startingFileName/,
  "cover-letter auto-selection aborts if restored identity, edits, or the active source change"
);
assert.match(
  coverLetterRepository,
  /selectCoverLetterWorkspaceDocument\(option\.fileName\)[\s\S]{0,320}?catch\s*\{\s*return null;/,
  "an unparseable saved letter is skipped rather than ranked as empty"
);
assert.match(
  coverEditor,
  /const adoptCoverWorkspaceSnapshot = useCallback[\s\S]{0,400}?setCoverLetterCandidatesRevision\(\(revision\) => revision \+ 1\)/,
  "every authoritative cover-letter snapshot advances the candidate revision from one owner"
);
assert.match(
  coverEditor,
  /mode === true && cancelStartupOpenRef\.current/,
  "recommendation loads use live replacement guards without inheriting the one-shot startup cancellation"
);
assert.match(
  prepareTab,
  /coverLetterPlaceholderCount > 0[\s\S]{0,220}?placeholder\$\{/,
  "a saved template letter reports its unresolved placeholders instead of reading as no draft"
);
assert.equal(
  prepareTab.match(/<PreparedVariantRecommendation/g)?.length,
  2,
  "both materials report their variant comparison through one component"
);
assert.match(
  prepareTab,
  /isRankingResumeVariants \|\| isSelectingResume[\s\S]{0,80}?"Selecting best match…"/,
  "the resume names automatic variant selection concisely"
);
assert.match(
  prepareTab,
  /isRankingCoverLetterVariants \|\| isSelectingCoverLetter[\s\S]{0,80}?"Selecting best match…"/,
  "the cover letter uses the same automatic-selection language"
);
assert.doesNotMatch(
  preparedVariantRecommendation,
  /Matches \d|prepared-job keywords|tied with|Best match for this role|Use \{recommendation\.label\}/,
  "the visible recommendation fallback stays concise"
);
assert.equal(
  polish.match(/if \(revealResumeOnSuccess\) setActiveOutputTab\("resume"\);/g)?.length,
  2,
  "Tailor and Review reveal Resume only when the caller requests it"
);
assert.doesNotMatch(
  prepareTab,
  /Confirm and tailor|Confirm the resume choice|safe automatic selection|Waiting on your choice/,
  "Prepare does not ask users to confirm the recommendation workflow"
);
assert.doesNotMatch(
  prepareTab,
  /autoTailorPending|resumeDirty|Automatic tailoring is paused|Unsaved changes kept/,
  "Prepare leaves dirty-editor protection to the shared concise recommendation fallback"
);

const restoreStart = app.indexOf("async function handleLoadApplication(app: Application)");
const restoreEnd = app.indexOf("// Restore the autosaved draft", restoreStart);
const restoreApplication = app.slice(restoreStart, restoreEnd);
assert.match(
  restoreApplication,
  /buildPreparedJobBrief\(\s*restoredJobDescription,\s*restoredJobDescription\s*\)[\s\S]{0,500}?buildPreparedJobBrief\(\s*restoredExtraction\.tailoringText,\s*restoredSourceText\s*\)/,
  "restoring an application prefers the persisted prepared brief and retains a raw-source fallback for legacy records"
);
assert.match(
  restoreApplication,
  /setImportedJob\([\s\S]{0,900}?tracking:\s*restoredTracking,[\s\S]{0,120}?brief:\s*restoredBrief/,
  "restoring an application reconstructs its prepared-job snapshot"
);
assert.match(
  restoreApplication,
  /approvedResumeVersion[\s\S]{0,2200}?resumeReplacementStateRef\.current\.version !== approvedResumeVersion/,
  "application restore aborts instead of replacing resume edits made during document reads"
);
assert.match(
  restoreApplication,
  /approvedCoverVersion[\s\S]{0,2200}?coverReplacementStateRef\.current\.version !== approvedCoverVersion/,
  "application restore aborts instead of replacing cover-letter edits made during document reads"
);
assert.match(
  restoreApplication,
  /detachBaseResumeIdentity\(\)/,
  "a restored application resume is detached from unrelated workspace-variant identity"
);
assert.ok(
  restoreApplication.indexOf("detachBaseResumeIdentity()") <
    restoreApplication.indexOf("if (restoredResumeData || restoredResume)"),
  "application restore detaches resume identity even when the saved application has no resume"
);
assert.match(restoreApplication, /setActiveOutputTab\("prepare"\);/, "restoring an application returns to Prepare");

assert.equal(
  app.match(/onApply=\{handleApply\}/g)?.length,
  2,
  "the masthead and Prepare page receive the exact same Apply command"
);
assert.match(
  app,
  /<Masthead[\s\S]{0,180}?onApply=\{handleApply\}/,
  "the masthead Apply button uses the shared Apply handler"
);
const prepareRenderStart = app.indexOf("<PrepareTab");
const prepareRenderEnd = app.indexOf("/>", prepareRenderStart);
assert.ok(
  prepareRenderStart >= 0 &&
    prepareRenderEnd > prepareRenderStart &&
    app.slice(prepareRenderStart, prepareRenderEnd).includes("onApply={handleApply}"),
  "the Prepare Apply button uses the shared Apply handler"
);
assert.match(
  app,
  /useApplyFlow\(\{\s*canApply:\s*preparationReadiness\.canApply,\s*applyBlocker:\s*preparationReadiness\.primaryBlocker,\s*includeResume:\s*materialSelection\.resume,\s*includeCoverLetter:\s*materialSelection\.coverLetter,/,
  "the shared Apply flow receives the same readiness decision shown by Prepare"
);
assert.match(
  app,
  /getPreparationReadiness\(\{\s*jobPrepared,\s*includeResume:\s*materialSelection\.resume,\s*resumeReady,\s*includeCoverLetter:\s*materialSelection\.coverLetter,\s*coverLetterReady,\s*isPreparing:\s*applicationPreparationActive\s*\}\)/,
  "Apply readiness requires only the materials selected for this package"
);
assert.match(
  app,
  /const DEFAULT_MATERIAL_SELECTION = \{\s*resume:\s*true,\s*coverLetter:\s*false\s*\}/,
  "new prepared jobs include the resume by default and leave the cover letter excluded"
);
assert.match(
  app,
  /isSelectingResume=\{isSavingBaseResume\}/,
  "Prepare receives the workspace resume loader's busy state"
);
assert.match(
  app,
  /materialSelection\.resume[\s\S]{0,180}?isSavingBaseResume[\s\S]{0,180}?materialSelection\.coverLetter[\s\S]{0,120}?isSelectingCoverVariant/,
  "included variant loads block the shared Apply readiness gate"
);
assert.match(
  preparationReadiness,
  /const resumeSatisfied = !includeResume \|\| resumeReady;[\s\S]{0,120}?const coverSatisfied = !includeCoverLetter \|\| coverLetterReady;/,
  "readiness treats each excluded material as satisfied"
);
const commitApplyStart = applyFlow.indexOf("async function commitApply(): Promise<boolean>");
const commitApplyGuard = applyFlow.indexOf("if (!canApply)", commitApplyStart);
const commitApplyMutation = applyFlow.indexOf("applyCommitInFlightRef.current", commitApplyStart);
const handleApplyStart = applyFlow.indexOf("async function handleApply()");
const handleApplyGuard = applyFlow.indexOf("if (!canApply)", handleApplyStart);
const handleApplyScan = applyFlow.indexOf("resolveApplyDuplicate()", handleApplyStart);
const handleApplySelectionCapture = applyFlow.indexOf("applyMaterialSelectionRef.current = {", handleApplyStart);
assert.ok(
  commitApplyGuard > commitApplyStart && commitApplyGuard < commitApplyMutation,
  "commitApply fails closed on readiness before persistence can begin"
);
assert.ok(
  handleApplyGuard > handleApplyStart && handleApplyGuard < handleApplyScan,
  "handleApply fails closed on readiness before duplicate scanning or dialogs"
);
assert.ok(
  handleApplySelectionCapture > handleApplyGuard && handleApplySelectionCapture < handleApplyScan,
  "Apply captures the approved material package before duplicate dialogs can delay commit"
);

assert.match(applicationModal, /saved = await onSave/, "the application modal awaits persistence");
assert.match(
  applicationModal,
  /const applicationToOpen = formHasUnsavedChanges[\s\S]{0,180}?buildApplication\(form\.status\)[\s\S]{0,180}?await onSave\(applicationToOpen\)[\s\S]{0,240}?const opened = await onLoad\(applicationToOpen\)/,
  "Open preparation saves modal edits and restores that same application snapshot"
);
const openPreparationValidation = applicationModal.indexOf(
  "const openPreparationBlocked = formHasUnsavedChanges && !canSave"
);
assert.ok(
  openPreparationValidation >= 0 &&
    applicationModal.indexOf("disabled={isBusy || openPreparationBlocked}", openPreparationValidation) >
      openPreparationValidation,
  "Open preparation cannot bypass the modal's validation when pending edits would be saved"
);
assert.match(
  applicationModal,
  /const opened = await onLoad\(applicationToOpen\)/,
  "the application modal awaits preparation restore before deciding whether to close"
);
assert.match(
  applicationModal,
  /if \(opened\) onClose\(\)/,
  "the application modal stays recoverable when preparation restore fails or is cancelled"
);
assert.match(applicationModal, /if \(!saved\)[\s\S]*setSaveError/, "failed modal saves retain visible error state");
assert.match(
  applicationModal,
  /inert=\{isBusy\}/,
  "modal edits are frozen while their snapshot saves or preparation opens"
);
assert.match(app, /const saved = await saveApplication\(application\)/, "App awaits modal persistence");
assert.match(
  app,
  /persistAppliedApplication:\s*saveApplication/,
  "Apply uses the full snapshot persistence path so prepared metadata edits and clears win"
);
assert.match(
  applyFlow,
  /\.\.\.\(existing \?\? \{\}\),[\s\S]{0,160}?\.\.\.draft/,
  "re-Apply preserves unrelated tracker fields before overlaying the complete prepared snapshot"
);
assert.match(
  applyFlow,
  /:\s*existing\?\.review\s*\?\s*\{\s*review:\s*existing\.review\s*\}/,
  "re-Apply without a fresh Review preserves the saved candidate-gap snapshot"
);
assert.match(
  app,
  /hidden=\{activeOutputTab !== "materials"\}/,
  "Materials stays mounted and is semantically hidden when another output tab is active"
);
assert.match(app, /pendingApplicationWrites > 0/, "before-unload protection includes pending tracker persistence");
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
assert.doesNotMatch(
  appIndex,
  /fonts\.googleapis\.com|fonts\.gstatic\.com/,
  "the local-first app does not fetch external web fonts"
);
assert.match(
  styleTokens,
  /@font-face[\s\S]*SourceSans3-Regular\.woff2[\s\S]*SourceSerif4-Regular\.woff2/,
  "app chrome uses bundled local font assets"
);

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
assert.match(
  coverEditor,
  /const nextTitle = documentTitle\.trim\(\) \|\| \(label === "Default" \? "Cover letter" : label\)/,
  "selecting a saved cover-letter variant preserves the application output title"
);

// `variant` is slugged by the server; `fileName` is not. Sending the active file
// name as a variant mangled it into cover-letter-cover-letter-<x>-cover.cover.
assert.match(
  coverEditor,
  /fileName:\s*target\?\.fileName \?\? \(target\?\.variant \? undefined : activeCoverFileName \|\| undefined\)/,
  "the active workspace file is sent as fileName, never re-slugged as a variant"
);

// Per-document application saves. These guard the wiring that keeps saves
// explicit, revisioned, and pointed at one existing record.
const documentSync = readHook("useApplicationDocumentSync.ts");
const applicationFiles = readHook("useApplicationFiles.ts");
const applicationsHook = readHook("useApplications.ts");
assert.match(
  coverToolbar,
  /coverLetterRecoveryDirty\(\{\s*documentDirty: editor\.dirty,\s*documentTitle: editor\.documentTitle,\s*persistedDocumentTitle: editor\.persistedDocumentTitle/,
  "opening another cover letter treats a title-only edit as unsaved replacement state"
);
assert.match(
  applicationFiles,
  /application\.updatedAt,[\s\S]{0,100}?sourceOrigin/,
  "a document mutation carries the current application revision"
);
assert.match(
  applicationFiles,
  /await refreshApplications\(\)/,
  "the current tab adopts the server's atomic file-and-metadata transaction"
);
assert.match(
  applicationFiles,
  /mutationQueue\.current\.then\(mutation, mutation\)/,
  "same-tab file actions serialize so each receives the prior confirmed revision"
);
assert.match(
  applicationFiles,
  /await refreshApplications\(\)[\s\S]{0,300}?getApplication\(id\)/,
  "a file mutation waits for pending tracker writes before choosing its base revision"
);
assert.match(
  applicationsHook,
  /Math\.max\(now, previousTime \+ 1\)/,
  "tracker mutations advance revisions even when edits share a millisecond or the clock moves backwards"
);
assert.match(
  documentSync,
  /const result = await saveApplicationDocument\(/,
  "a document save awaits the atomic server mutation before reporting success"
);
assert.match(
  documentSync,
  /setSavingKinds\(\(current\) => new Set\(current\)\.add\(kind\)\)/,
  "simultaneous Resume and Cover letter saves each retain their own busy state"
);
assert.match(
  documentSync,
  /\[currentResumeText, resumeFeedback, resumeState, saveResume, savingKinds, targetLabel\]/,
  "the resume application action reacts when content emptiness changes without a sync-state change"
);
assert.match(
  documentSync,
  /\[coverFeedback, coverLetterText, coverState, saveCoverLetter, savingKinds, targetLabel\]/,
  "the cover-letter application action reacts when content emptiness changes without a sync-state change"
);
assert.match(
  documentSync,
  /\(kind === "resume" \? onResumeSaved : onCoverLetterSaved\)\(\)/,
  "a successful per-document application save settles only that document's recovery state"
);
assert.match(
  coverEditor,
  /const markApplicationSaved[\s\S]{0,300}?clearCoverLetterAutosaveDraft\(\)/,
  "a durable application cover letter clears its recovery draft"
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
  /const eligibleLinked = linked && \(preserveLinkedApplication \|\| linkedMatchesTarget\) \? linked : null/,
  "a stale linked application is withheld synchronously before the cleanup effect runs"
);
assert.match(
  documentSync,
  /if \(preserveLinkedApplication\) return;\s*if \(linkedMatchesTarget\) return;\s*setLinkedId\(null\)/,
  "brief edits preserve the explicit application of record while fresh intake can drop a stale link"
);
const documentSaveVersion = documentSync.indexOf("const startedVersion =");
const beforeDocumentSaveGuard = documentSync.indexOf("if (!stillCurrent())", documentSaveVersion);
const documentServerSave = documentSync.indexOf("await saveApplicationDocument(", beforeDocumentSaveGuard);
const afterDocumentSaveGuard = documentSync.indexOf("if (!stillCurrent())", documentServerSave);
assert.ok(
  documentSaveVersion >= 0 &&
    beforeDocumentSaveGuard > documentSaveVersion &&
    documentServerSave > beforeDocumentSaveGuard &&
    afterDocumentSaveGuard > documentServerSave,
  "per-document saves reject editor or target changes both before and after the server write"
);
assert.match(
  applyFlow,
  /applyMergeTargetRef\.current = null;[\s\S]{0,200}?linkApplication\(existing\?\.id \?\? app\.id\)/,
  "a confirmed Apply links the session to that one application"
);
assert.match(
  app,
  /duplicateGuard\.ackApplication\(app\);[\s\S]{0,400}?linkPreparedApplication\(app\.id\)/,
  "restoring a tracked application links later document saves to it"
);
const importedSnapshotSetterStart = app.indexOf("const setImportedJobAndDocumentTitle");
const importedSnapshotSetterEnd = app.indexOf("const handlePreparedJobTrackingChange", importedSnapshotSetterStart);
const importedSnapshotSetter = app.slice(importedSnapshotSetterStart, importedSnapshotSetterEnd);
assert.match(
  importedSnapshotSetter,
  /snapshot\.sourceText === importedJob\.sourceText[\s\S]*setImportedJob\(snapshot\);[\s\S]*if \(!continuesPreparedSource\) \{[\s\S]*setApplicationOfRecordId\(null\);[\s\S]*setMaterialSelection\(DEFAULT_MATERIAL_SELECTION\);[\s\S]*setResumeVariantRecommendation\(null\);/,
  "fresh intake resets application defaults while same-source Prepare again preserves explicit choices"
);
const manualSourceEdit = intake.indexOf("function handleManualJobDescriptionChange");
assert.ok(
  manualSourceEdit >= 0 &&
    intake.indexOf("setImportedJob(null)", manualSourceEdit) >
      intake.indexOf("setJobDescription(value)", manualSourceEdit),
  "editing or replacing source releases the prior prepared application before document saves can target it"
);
assert.match(
  app,
  /const linkPreparedApplication = useCallback[\s\S]{0,180}?setApplicationOfRecordId\(id\);[\s\S]{0,100}?linkApplication\(id\)/,
  "Apply and restore keep tracker identity aligned with per-document save identity"
);
assert.match(
  app,
  /linkedApplicationId: applicationOfRecordId/,
  "re-Apply keeps targeting the restored or applied row after prepared-brief edits"
);
assert.match(
  app,
  /preserveLinkedApplication: applicationOfRecordId !== null && jobPrepared/,
  "an explicit application link survives brief edits only while the prepared source snapshot still matches"
);
assert.match(
  app,
  /recommendation !== null[\s\S]{0,320}?current\.applicationOfRecordId === null/,
  "variant recommendation never replaces a resume restored from an application of record"
);
assert.match(
  app,
  /setJobRawText\(restoredSourceText\)/,
  "application restore keeps one full source for View source, Prepare again, and re-Apply"
);
const restoreClassifierStart = app.indexOf("const storedPreparedDescription =");
const restoreClassifier = app.slice(restoreClassifierStart, restoreClassifierStart + 500);
assert.ok(
  restoreClassifierStart >= 0 &&
    restoreClassifier.includes("Company \\/ Product Context") &&
    restoreClassifier.includes("Core Responsibilities") &&
    restoreClassifier.includes("Required Qualifications"),
  "restore requires RoleFit's canonical prepared headings before skipping raw fallback extraction"
);
assert.match(
  applyFlow,
  /if \(materialSelection\.resume\) \{[\s\S]{0,220}?aiUsage\.tailor[\s\S]{0,180}?aiUsage\.review/,
  "re-Apply updates resume AI provenance only when Resume is included"
);
assert.match(
  applyFlow,
  /\.\.\.\(materialSelection\.resume[\s\S]{0,500}?fitScore: headlineScore[\s\S]{0,500}?resumeUsed:/,
  "re-Apply updates resume-derived fit metadata only when Resume is included"
);
assert.match(
  answers,
  /makeApplicationDraft\(jobUrl, applicationJobDescription, applicationTracking\)[\s\S]{0,120}?rawJobDescription: applicationRawJobDescription\.trim\(\)/,
  "Save answers preserves prepared tracking and immutable source when it creates a new application"
);
assert.match(
  answers,
  /const existing = linkedApplication \?\? findForTarget\(jobUrl, applicationJobDescription\)/,
  "Save answers keeps targeting a restored URL-less application after prepared-brief edits"
);
assert.match(
  app,
  /const polishOutputCurrent = result\?\.source === "ai" && !reviewStale && !resumeManuallyEdited/,
  "a restored deterministic resume analysis cannot inherit completed AI-tailoring status"
);
assert.match(
  app,
  /if \(result\.source !== "ai"\) return;\s*setReviewStale\(jobDescription !== lastPolishedJobRef\.current\)/,
  "zero-suggestion Tailor output still becomes stale when the prepared job changes"
);
assert.match(
  app,
  /const prepareReviewGapsProvenance = currentReviewAvailable[\s\S]{0,180}?"saved"[\s\S]{0,100}?"none"/,
  "Prepare distinguishes a current Review from an explicitly historical saved snapshot"
);
assert.match(
  prepareTab,
  /reviewGapsProvenance === "current"[\s\S]{0,120}?No candidate gaps identified by the current Review/,
  "a current Review with zero gaps is not presented as if Review never ran"
);
assert.match(
  app,
  /const polishInputsReady = useMemo\(\(\) => \{[\s\S]{0,160}?jobPrepared &&[\s\S]{0,420}?\}, \[editedResume, jobDescription, jobPrepared, resumeReady, tailorModes\]\)/,
  "resume tailoring is unavailable until source intake has produced a matching prepared snapshot"
);
assert.match(
  app,
  /const jobReady = jobPrepared;/,
  "cover-letter and materials tailoring share Prepare's completed-snapshot gate"
);
assert.match(
  applyFlow,
  /rawJobDescription: jobRawText\.trim\(\)/,
  "Apply persists the immutable captured source even when it initially matched the prepared text"
);
assert.match(
  restoreApplication,
  /applicationDocumentUrl\(app\.id, "resume", "source"\)[\s\S]{0,300}?parseResumeFile/,
  "Open preparation restores the strict saved resume source rather than flattened tracker text"
);
const restoredCoverFetch = restoreApplication.indexOf('applicationDocumentUrl(app.id, "cover", "source")');
const restoredCoverOpen = restoreApplication.indexOf("coverLetterEditor.openApplicationSource");
assert.ok(
  restoredCoverFetch >= 0 && restoredCoverOpen > restoredCoverFetch,
  "Open preparation restores the strict saved cover-letter source and its style"
);
assert.match(
  app,
  /currentCoverLetterSource: coverLetterEditor\.draftPayload \?\? "",[\s\S]{0,180}?saveApplicationDocument:/,
  "the letter's saved state includes the full serialized editable source"
);

// Editor parity: the cover letter recovers unsaved work the way the resume
// does, instead of only warning that it is unsaved, and neither editor keeps a
// private restore path the other lacks.
const coverDraft = readHook("useCoverLetterAutosaveDraft.ts");
const draftStorage = readFileSync(new URL("../../lib/autosaveDraftStorage.ts", import.meta.url), "utf8");
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
assert.match(
  app,
  /persistedDocumentTitle: coverLetterEditor\.persistedDocumentTitle,\s*dirty: coverLetterEditor\.dirty/,
  "cover-letter recovery compares the live title with its durable baseline"
);
assert.doesNotMatch(
  coverDraft,
  /hasContent/,
  "title-only and style-only cover-letter changes are not gated on body content"
);
// Undoing a tailor belongs to the result summary in the rail, beside what was
// applied — not to a permanent toolbar button competing with Open and Save.
assert.doesNotMatch(coverToolbar, /Restore source|Restore previous/, "the letter toolbar owns no restore button");
assert.match(
  coverReview,
  /canRestore \? \([\s\S]{0,200}?Restore previous/,
  "Restore appears with the tailored result and disappears with it"
);
assert.doesNotMatch(cover, /onCaptureSource/, "the workflow hook never owns the document snapshot the editor owns");
assert.match(
  coverDraft,
  /saveTabDraft\("cover"/,
  "the letter's draft is written under its own kind, never the resume's key"
);
assert.match(
  coverEditor,
  /editor\.markClean\(\);\s*commitPersistenceBaseline\(payload\);[\s\S]{0,200}?clearCoverLetterAutosaveDraft\(\)/,
  "the recovery draft is cleared only once the letter and title baseline are durable"
);
assert.match(
  coverEditor,
  /const openRecoveryDraft[\s\S]{0,400}?editor\.markClean\(\)/,
  "restoring a letter draft seeds clean, like the resume restore"
);
assert.match(coverTab, /DraftRestoreBar/, "the letter offers the same restore bar the resume does");
assert.match(
  draftStorage,
  /if \(ownerId !== myId && live\.has\(ownerId\)\) continue;/,
  "one shared recovery rule protects a live sibling tab's draft for both editors"
);
assert.match(
  app,
  /completeAutoDocumentTitle\("coverLetter", current, applicantName, company, COVER_LETTER_TITLE_PLACEHOLDERS\)/,
  "the letter is named on the same Name_Company_<kind> rule as the resume"
);
assert.match(
  resumeTab,
  /const documentContext = \[jobTarget\?\.role, jobTarget\?\.company\]\.filter\(Boolean\)\.join\(" at "\)/,
  "the resume editor uses the same role-at-company sublabel as the cover-letter editor"
);
assert.doesNotMatch(
  resumeTab,
  /AI suggestions|resultSourceLabel/,
  "the resume title sublabel does not mix source provenance into job-target context"
);
assert.match(
  coverTab,
  /const targetLine = \[jobTarget\?\.role, jobTarget\?\.company\]\.filter\(Boolean\)\.join\(" at "\)/,
  "the cover-letter editor keeps the shared role-at-company sublabel"
);
for (const kind of ["resume", "coverLetter"]) {
  assert.equal(
    app.match(new RegExp(`documentTitleForJob\\("${kind}"`, "g"))?.length,
    3,
    `job import, prepared-title edits, and tracker restore retitle the ${kind} for the current role`
  );
}

console.log(`Client workflow guards eval: ${checkCount}/${checkCount} checks passed`);
