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
  /const coverLetterNeedsUnloadGuard = applicationDocumentNeedsUnloadGuard\(\{[\s\S]{0,180}?dirty: coverLetterEditor\.recoveryDirty,[\s\S]{0,350}?useBeforeUnloadGuard\([\s\S]{0,180}?coverLetterNeedsUnloadGuard/,
  "title-only edits feed the persistence-aware unload guard"
);
assert.match(
  app,
  /handleRestoreCoverDraft[\s\S]{0,300}?coverLetterEditor\.recoveryDirty && !\(await confirmReplaceCoverLetter\(\)\)/,
  "restoring recovery asks before replacing a title-only edit"
);
console.log("cover-letter recovery decisions: PASS");
