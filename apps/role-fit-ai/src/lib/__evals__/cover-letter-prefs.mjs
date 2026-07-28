import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};

const {
  coverLetterStartupIsCurrent,
  loadLastCoverLetterName,
  migrateStoredCoverLetterStyle,
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

const legacyStyle = {
  fontFamily: "carlito",
  fontSizePt: 11,
  lineHeight: 1.25,
  paragraphGapPt: 10,
  marginTopPt: 72,
  marginRightPt: 72,
  marginBottomPt: 72,
  marginLeftPt: 72,
  contactDivider: "|"
};
assert.deepEqual(
  migrateStoredCoverLetterStyle(legacyStyle),
  {
    ...legacyStyle,
    lineHeight: 2,
    paragraphGapPt: 8,
    marginTopPt: 36,
    marginRightPt: 54,
    marginBottomPt: 36,
    marginLeftPt: 54
  },
  "the exact legacy default snapshot migrates to the current physical defaults"
);
const previousStyle = {
  ...legacyStyle,
  lineHeight: 2,
  paragraphGapPt: 0,
  marginTopPt: 54,
  marginRightPt: 54,
  marginBottomPt: 54,
  marginLeftPt: 54
};
assert.deepEqual(
  migrateStoredCoverLetterStyle(previousStyle),
  {
    ...previousStyle,
    lineHeight: 2,
    paragraphGapPt: 8,
    marginTopPt: 36,
    marginRightPt: 54,
    marginBottomPt: 36,
    marginLeftPt: 54
  },
  "the previous shipped default snapshot migrates to the current physical defaults"
);
const paragraphGapStyle = {
  ...previousStyle,
  lineHeight: 1.15,
  paragraphGapPt: 8,
  marginTopPt: 36,
  marginBottomPt: 36
};
assert.deepEqual(
  migrateStoredCoverLetterStyle(paragraphGapStyle),
  {
    ...paragraphGapStyle,
    lineHeight: 2
  },
  "the locally applied paragraph-gap default migrates to double spacing"
);
const dateOnlyStyle = {
  ...paragraphGapStyle,
  lineHeight: 2,
  paragraphGapPt: 0
};
assert.deepEqual(
  migrateStoredCoverLetterStyle(dateOnlyStyle),
  {
    ...dateOnlyStyle,
    paragraphGapPt: 8
  },
  "the locally applied date-only spacing default gains paragraph gaps"
);
const customizedStyle = { ...legacyStyle, marginLeftPt: 60 };
assert.equal(
  migrateStoredCoverLetterStyle(customizedStyle),
  customizedStyle,
  "a customized persisted style is preserved by identity"
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
  /openWorkspaceCoverLetter\([\s\S]*startup\.fileName,[\s\S]*true,[\s\S]*coverLetterStartupIsCurrent/,
  "the selected response rechecks cancellation and edits before adopting its payload"
);
assert.match(
  hook,
  /const COVER_LETTER_STARTER = `<space-before=8>\[Date\]<\/space-before>\r?\n\r?\nDear \[Hiring manager\],[\s\S]*\r?\n\r?\nSincerely,/,
  "the starter adds paragraph spacing before the date only"
);

console.log("Cover-letter remembered-variant preferences passed");
