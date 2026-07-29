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
  /const COVER_LETTER_STARTER = `\[Date\]\r?\n\r?\nDear \[Hiring manager\],[\s\S]*\r?\n\r?\nSincerely,/,
  "the starter stays plain text so the shared parser applies the default to every paragraph"
);

console.log("Cover-letter remembered-variant preferences passed");
