import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};

const {
  coverLetterStartupIsCurrent,
  loadLastCoverLetterName,
  resolveCoverLetterStartup,
  saveLastCoverLetterName
} = await import("../coverLetterPrefs.ts");

assert.equal(
  coverLetterStartupIsCurrent("initial", "initial", false),
  true,
  "startup may adopt a saved letter while the editor is unchanged"
);
assert.equal(
  coverLetterStartupIsCurrent("initial", "typed", false),
  false,
  "typing before the response arrives keeps the user's draft"
);
assert.equal(
  coverLetterStartupIsCurrent("initial", "initial", true),
  false,
  "an explicitly cancelled startup cannot replace the current document"
);

assert.equal(loadLastCoverLetterName(), "", "a fresh browser has no remembered cover letter");
saveLastCoverLetterName("  backend-platform.cover  ");
assert.equal(
  values.get("rolefit:lastCoverLetter"),
  "backend-platform.cover",
  "the preference stores only the trimmed workspace filename"
);
assert.equal(
  loadLastCoverLetterName(),
  "backend-platform.cover",
  "the remembered workspace filename round-trips"
);
saveLastCoverLetterName(" ");
assert.equal(
  values.has("rolefit:lastCoverLetter"),
  false,
  "detached documents clear the preference"
);

const available = ["default.cover", "backend-platform.cover", "frontend.cover"];
assert.deepEqual(
  resolveCoverLetterStartup(available, "frontend.cover"),
  { fileName: "frontend.cover", stale: false },
  "startup prefers the remembered available variant"
);
assert.deepEqual(
  resolveCoverLetterStartup(available, "removed.cover"),
  { fileName: "default.cover", stale: true },
  "a stale preference falls back to the server's first option"
);
assert.deepEqual(
  resolveCoverLetterStartup(available, ""),
  { fileName: "default.cover", stale: false },
  "a fresh browser opens the server's first option"
);
assert.deepEqual(
  resolveCoverLetterStartup([], "removed.cover"),
  { fileName: "", stale: true },
  "an empty workspace clears stale identity without inventing a document"
);

const hook = readFileSync(new URL("../../hooks/useCoverLetterEditor.ts", import.meta.url), "utf8");
const identityHook = readFileSync(
  new URL("../../hooks/useCoverLetterDocumentIdentity.ts", import.meta.url),
  "utf8"
);
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const coverLetter = readFileSync(
  new URL("../../../../../packages/engine/src/lib/coverLetter.ts", import.meta.url),
  "utf8"
);
assert.match(
  hook,
  /resolveCoverLetterStartup\([\s\S]*loadLastCoverLetterName\(\)/,
  "cover-letter startup reads the remembered workspace variant"
);
assert.match(
  hook,
  /const initialFingerprint = startupFingerprintRef\.current[\s\S]*coverLetterStartupIsCurrent/,
  "startup snapshots the current editor fingerprint before loading the workspace"
);
assert.match(
  hook,
  /openWorkspaceCoverLetter\([\s\S]*startup\.fileName,[\s\S]*startup: true,[\s\S]*coverLetterStartupIsCurrent/,
  "the selected response rechecks cancellation and edits before adopting its payload"
);
assert.match(
  identityHook,
  /const documentTitleRef = useRef\(documentTitle\)[\s\S]*commitPersistenceBaseline = useCallback\([\s\S]{0,180}?documentTitleRef\.current[\s\S]{0,180}?\[\]\s*\)/,
  "document-title changes do not recreate the startup adoption callbacks"
);
assert.match(
  hook,
  /const \[isWorkspaceBootstrapping, setIsWorkspaceBootstrapping\] = useState\(true\)/,
  "cover-letter startup is pending before the workspace options or saved document are known"
);
assert.match(
  hook,
  /const snapshot = await refreshCoverWorkspace\(\)[\s\S]*finally \{[\s\S]*setIsWorkspaceBootstrapping\(false\)/,
  "cover-letter startup settles only after the workspace snapshot and optional saved-document open finish"
);
assert.match(
  hook,
  /return \{[\s\S]*isWorkspaceBootstrapping,[\s\S]*coverLetterOptions/,
  "the editor exposes startup readiness beside the workspace options it qualifies"
);
assert.match(
  app,
  /const coverVariantResolutionPending = Boolean\(\s*coverLetterEditor\.isWorkspaceBootstrapping\s*\|\|\s*coverLetterEditor\.isWorkspaceReplacing\s*\|\|\s*isSelectingCoverVariant/,
  "automatic Cover Letter Polish waits through startup and every editor-owned replacement transaction"
);
assert.match(
  app,
  /materialSelection\.coverLetter[\s\S]{0,120}?isGeneratingCover \|\| coverVariantResolutionPending/,
  "Apply readiness remains pending while the included cover letter is being replaced"
);
assert.match(
  hook,
  /withWorkspaceReplacement\([\s\S]{0,450}?confirmReplace[\s\S]{0,500}?selectCoverLetterWorkspaceDocument/,
  "opening a saved cover letter publishes pending state before replacement confirmation"
);
assert.match(
  hook,
  /restoreWorkspaceCoverLetter = useCallback\([\s\S]{0,250}?withWorkspaceReplacement/,
  "history restoration uses the same pending replacement boundary"
);
assert.match(
  hook,
  /const COVER_LETTER_STARTER = `\[Date\]\r?\n\r?\nDear \[Hiring manager\],[\s\S]*\r?\n\r?\nSincerely,/,
  "the starter stays plain text so the shared parser applies the default to every paragraph"
);

// Spell-check is off until the writer asks for it, and stays however they left
// it. It was previously forced on by the shared adapter's default view, which
// also meant a reload undid turning it off.
assert.match(
  hook,
  /SPELL_CHECK_STORAGE_KEY[\s\S]*localStorage\.getItem\(SPELL_CHECK_STORAGE_KEY\) === "on"/,
  "the letter's spell-check preference is read back from storage on load"
);
assert.match(
  hook,
  /localStorage\.setItem\(\s*SPELL_CHECK_STORAGE_KEY,\s*style\.spellCheck \? "on" : "off"\s*\)/,
  "toggling spell-check persists it rather than lasting only for the session"
);
assert.equal(
  DOC_STYLE_DEFAULTS.spellCheck,
  false,
  "a document starts with spell-check off in both editors"
);
assert.doesNotMatch(
  coverLetter,
  /spellCheck: true/,
  "no adapter default turns spell-check back on"
);

console.log("Cover-letter remembered-variant preferences passed");
