import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { coverLetterRecoveryDirty } from "../coverLetterRecovery.ts";

assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: false,
    documentTitle: "Cover letter",
    persistedDocumentTitle: "Cover letter"
  }),
  false,
  "an untouched blank default letter does not create recovery noise"
);
assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: false,
    documentTitle: "Acme cover letter",
    persistedDocumentTitle: "Cover letter"
  }),
  true,
  "a user-authored title-only change is recoverable"
);
assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: true,
    documentTitle: "Cover letter",
    persistedDocumentTitle: "Cover letter"
  }),
  true,
  "a style-only change to a blank letter is recoverable"
);

const identityHook = readFileSync(
  new URL("../../hooks/useCoverLetterDocumentIdentity.ts", import.meta.url),
  "utf8"
);
const editorHook = readFileSync(
  new URL("../../hooks/useCoverLetterEditor.ts", import.meta.url),
  "utf8"
);
const autosaveHook = readFileSync(
  new URL("../../hooks/useCoverLetterAutosaveDraft.ts", import.meta.url),
  "utf8"
);
const toolbar = readFileSync(
  new URL("../../sections/cover-letter/CoverLetterToolbar.tsx", import.meta.url),
  "utf8"
);
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

assert.match(
  identityHook,
  /const recoveryDirty = coverLetterRecoveryDirty\([\s\S]{0,250}?documentDirty,[\s\S]{0,150}?documentTitle,[\s\S]{0,150}?persistedDocumentTitle/,
  "the document identity owner derives title-inclusive recovery dirtiness once"
);
assert.match(
  editorHook,
  /return \{[\s\S]{0,350}?dirty,[\s\S]{0,80}?recoveryDirty,/,
  "the editor exposes the canonical title-inclusive dirty value"
);
assert.match(app, /const titleCompany = titleCompanyRef\.current;/, "titles follow the prepared company only");
assert.doesNotMatch(
  app,
  /titleCompanyRef\.current = \(?jobTracking/,
  "a draft edit to the job source (re-parsed jobTracking) never retitles documents"
);
assert.match(
  editorHook,
  /if \(startup\.fileName\) \{[\s\S]{0,700}?\} else \{[\s\S]{0,300}?starterCoverLetterData\(\);\s*openDocument\(data, true\);\s*editor\.markClean\(\);\s*commitPersistenceBaseline\(/,
  "with no saved letter a new session opens a clean Starter, as the resume does"
);
assert.match(
  autosaveHook,
  /recoveryDirty: boolean[\s\S]{0,650}?shouldSave: payload !== null && recoveryDirty/,
  "cover-letter autosave consumes the canonical dirty value"
);
assert.match(
  toolbar,
  /if \(!editor\.recoveryDirty\) return true[\s\S]*!editor\.recoveryDirty[\s\S]{0,250}?draftAutosaveState/,
  "replacement confirmation and recovery-save status include title-only edits"
);
assert.match(
  app,
  /if \(coverLetterEditor\.recoveryDirty\) setPendingCoverDraft\(null\)/,
  "title-only edits dismiss stale recovery offers"
);
assert.match(
  app,
  /const coverLetterNeedsUnloadGuard = applicationDocumentNeedsUnloadGuard\(\{[\s\S]{0,180}?dirty: coverLetterEditor\.recoveryDirty,[\s\S]{0,500}?useBeforeUnloadGuard\([\s\S]{0,180}?coverLetterNeedsUnloadGuard/,
  "title-only edits feed the persistence-aware unload guard"
);
assert.match(
  app,
  /handleRestoreCoverDraft[\s\S]{0,300}?coverLetterEditor\.recoveryDirty && !\(await confirmReplaceCoverLetter\(\)\)/,
  "restoring recovery asks before replacing a title-only edit"
);
// A letter past the strict .cover limits never throws during render: the
// codec refuses it with its own error, which the editor hook catches, keeps
// the last valid serialization as the recovery payload, and explains.
{
  const { coverLetterResumeData, serializeCoverLetterFile, CoverLetterFileError, COVER_LETTER_STYLE_DEFAULTS } = await import("@typeset/engine/lib/coverLetter.ts");
  const tooLong = coverLetterResumeData(Array.from({ length: 501 }, (_, index) => `Paragraph ${index + 1}.`), null);
  assert.throws(() => serializeCoverLetterFile(tooLong, COVER_LETTER_STYLE_DEFAULTS), CoverLetterFileError, "the codec refuses a 501-paragraph letter with its own error");
  const hookSource = readFileSync(new URL("../../hooks/useCoverLetterEditor.ts", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(hookSource, /catch \(error\) \{\s*if \(!\(error instanceof CoverLetterFileError\)\) throw error;\s*return \{ fingerprint: `over-limit:/, "the hook catches only the codec's refusal");
  assert.ok(hookSource.includes("fingerprint: `over-limit:${JSON.stringify([editor.editedResume, toDocumentStyle(style)])}`, limitProblem: error.message"), "an over-limit letter compares as changed, edit by edit, document style included and zoom or spell-check not");
  assert.match(appSource, /recoveryDraftSaved: coverDraftAutosaveState === "saved" && !coverLetterEditor.overLimit,/, "the unload guard never trusts an older recovery draft for an over-limit letter");
  assert.match(hookSource, /const recoveryPayload = limitProblem \? lastValidFingerprintRef\.current : currentFingerprint;/, "recovery keeps the last valid letter");
  assert.match(hookSource, /draftPayload: recoveryPayload,\s*\/\/[^\n]*\n\s*sourcePayload: limitProblem \? null : currentFingerprint/, "a saved copy is never compared with a letter that cannot be saved");
  assert.equal((hookSource.match(/if \(limitProblem\) \{\s*setStatus\(coverLimitStatus\(limitProblem\)\);\s*return( false)?;\s*\}/g) ?? []).length, 2, "both save paths explain instead of throwing");
  assert.match(hookSource, /capturePreTailorSnapshot\(editor\.editedResume && !limitProblem/, "accepting Polish over the limit skips the snapshot instead of throwing");
  assert.match(appSource, /documentFingerprint: coverLetterEditor\.sourcePayload \?\? ""/);
  assert.match(appSource, /currentCoverLetterSource: coverLetterEditor\.sourcePayload \?\? ""/);
}
console.log("cover-letter recovery decisions: PASS");
