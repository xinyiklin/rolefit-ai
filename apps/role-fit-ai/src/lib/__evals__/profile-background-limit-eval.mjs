// A boundary-sized Profile Background reaches cover-letter Polish and final
// review whole, in every line shape, and an over-limit Background is stored
// unchanged rather than shortened.
//
//   node src/lib/__evals__/profile-background-limit-eval.mjs

import assert from "node:assert/strict";

import {
  PROFILE_BACKGROUND_CHAR_LIMIT,
  profileBackgroundLimitError
} from "../../../shared/candidateProfileContract.ts";
import { applicationReviewEvidenceLimitError } from "../../../shared/applicationReviewContract.ts";
import { parseCoverLetterEvidenceItems } from "../../../server/ai/coverLetterContracts.ts";
import { COVER_EVIDENCE_PROMPT_CHAR_LIMIT, serializeJsonForPrompt } from "../../../server/ai/prompts.ts";
import { buildApplicationReviewInput } from "../applicationReview.ts";
import { buildCandidateFactsContext, mergeHonestContext } from "../candidateFacts.ts";
import { buildCoverLetterEvidence } from "../coverLetterEvidence.ts";
import { serializeResumeData } from "../resumeText.ts";
import { loadSettings, normalizeSettings, saveSettings, setSettingsSaveListener } from "../settings.ts";
import {
  WORKSPACE_PREFERENCES_FORMAT,
  WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  parsePortableWorkspacePreferences,
  parseStoredWorkspacePreferences
} from "../workspaceBackupContract.ts";

const facts = buildCandidateFactsContext({
  citizenshipStatus: "permanent-resident",
  legallyAuthorizedToWork: "no",
  requiresSponsorship: "no",
  educationLevel: "professional",
  major: "M".repeat(120),
  gpa: 3.99,
  availabilityNotice: "specific-date",
  availabilityDate: "2026-09-28"
});

function padTo(text) {
  return text + "x".repeat(PROFILE_BACKGROUND_CHAR_LIMIT - text.length);
}
const headed = Array.from({ length: 60 }, (_, index) => [
  `## Project ${index} (personal project, 2024–present)`,
  `- Built service ${index} with Python, SQL, and automated tests.`,
  ""
].join("\n")).join("\n");
const shapes = {
  "one line": "Built Python services end to end. ".repeat(400).slice(0, PROFILE_BACKGROUND_CHAR_LIMIT),
  "short lines": padTo(Array.from({ length: 6_000 }, (_, index) => String.fromCharCode(97 + (index % 26))).join("\n")),
  headed: padTo(headed)
};

// The evidence filter's documented contract: trimmed non-empty lines, minus
// label-only lines, with list markers stripped.
function keptLines(text) {
  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[A-Za-z][A-Za-z ]{1,40}:$/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim());
}

function syntheticResume(entryCount, bulletsPerEntry, bulletLength) {
  return {
    header: { visible: true, name: "Synthetic Candidate", contact: [] },
    sections: [{
      id: "experience",
      heading: "Experience",
      type: "standard",
      items: Array.from({ length: entryCount }, (_, entry) => ({
        id: `entry-${entry}`,
        titleLeft: `Engineer ${entry}`,
        titleRight: "2020-2024",
        subtitleLeft: `Synthetic Co ${entry}`,
        subtitleRight: "Remote",
        bullets: Array.from({ length: bulletsPerEntry }, (_, bullet) => ({
          id: `bullet-${entry}-${bullet}`,
          text: `Built service ${entry}-${bullet} `.padEnd(bulletLength, "z")
        }))
      }))
    }]
  };
}
const resumes = {
  "two-page": syntheticResume(5, 6, 180),
  "28,000-character": syntheticResume(10, 14, 200)
};

for (const [shape, background] of Object.entries(shapes)) {
  assert.equal(background.length, PROFILE_BACKGROUND_CHAR_LIMIT, `${shape}: boundary-sized`);
  assert.equal(profileBackgroundLimitError(background), null, `${shape}: exactly 12,000 runs`);
  const merged = mergeHonestContext(background, facts);
  const expected = keptLines(merged);

  for (const [resumeName, resumeData] of Object.entries(resumes)) {
    const evidence = buildCoverLetterEvidence({ resumeData, honestContext: merged });
    const profileItems = evidence.filter((item) => item.source === "honest_context");
    assert.ok(profileItems.length <= 200, `${shape}/${resumeName}: the Profile uses at most 200 cover items`);
    assert.deepEqual(
      profileItems.flatMap((item) => item.text.split("\n")),
      expected,
      `${shape}/${resumeName}: every kept Profile line reaches cover evidence in order and uncut`
    );
    const parsed = parseCoverLetterEvidenceItems(evidence);
    assert.equal(parsed.length, evidence.length, `${shape}/${resumeName}: the cover route accepts every item`);
    assert.deepEqual(parsed.map((item) => item.text), evidence.map((item) => item.text), `${shape}/${resumeName}: no item text is sliced`);
    const full = serializeJsonForPrompt(parsed, Number.MAX_SAFE_INTEGER);
    assert.equal(
      serializeJsonForPrompt(parsed, COVER_EVIDENCE_PROMPT_CHAR_LIMIT),
      full,
      `${shape}/${resumeName}: the cover prompt corpus is not clipped (${full.length} chars)`
    );
  }

  const review = buildApplicationReviewInput({
    jobText: "Build Python services.",
    company: "Synthetic Co",
    role: "Engineer",
    includeResume: true,
    includeCoverLetter: false,
    resumeText: "",
    coverLetterText: "",
    originalResumeText: serializeResumeData(resumes["28,000-character"]),
    candidateContext: merged
  });
  assert.equal(applicationReviewEvidenceLimitError(review.evidence), null, `${shape}: final review accepts the evidence`);
  assert.deepEqual(
    review.evidence.filter((item) => item.kind === "context").flatMap((item) => item.text.split("\n")),
    expected,
    `${shape}: every kept Profile line reaches final review in order and uncut`
  );
}

// Grouping many-line Profiles never joins two entries in one evidence item.
for (const [entries, bullets] of [[25, 8], [60, 8], [150, 2]]) {
  const background = Array.from({ length: entries }, (_, entry) => [
    `## Entry ${entry} (${entry % 2 ? "professional" : "personal project"}, 2020–2024)`,
    ...Array.from({ length: bullets }, (_, bullet) => `- Did ${entry}.${bullet}.`)
  ].join("\n")).join("\n\n");
  assert.ok(background.length <= PROFILE_BACKGROUND_CHAR_LIMIT, `${entries}x${bullets}: within the limit`);
  const merged = mergeHonestContext(background, facts);
  const items = buildCoverLetterEvidence({ resumeData: null, honestContext: merged })
    .filter((item) => item.source === "honest_context")
    .map((item) => item.text);
  assert.ok(items.length <= 200, `${entries}x${bullets}: at most 200 Profile items (${items.length})`);
  assert.deepEqual(items.flatMap((text) => text.split("\n")), keptLines(merged), `${entries}x${bullets}: every line survives in order`);
  for (const text of items) {
    assert.ok(
      text.split("\n").every((line, index) => index === 0 || !/^#{1,6}\s/.test(line)),
      `${entries}x${bullets}: an item never continues into another entry's heading`
    );
  }
}

// An over-limit Background is declined at run time, never shortened in storage.
let workspaceSettings = null;
setSettingsSaveListener((settings) => { workspaceSettings = settings; });
for (const length of [PROFILE_BACKGROUND_CHAR_LIMIT + 1, 30_000]) {
  const honestContext = "## Legacy (professional, 2019–2024)\n" + "p".repeat(length - 36);
  assert.equal(honestContext.length, length);
  assert.ok(profileBackgroundLimitError(honestContext), `${length}: runs decline`);
  assert.equal(normalizeSettings({ honestContext }).honestContext, honestContext, `${length}: normalization keeps it`);
  saveSettings({ honestContext });
  assert.equal(workspaceSettings.honestContext, honestContext, `${length}: the workspace write keeps it`);
  assert.equal(loadSettings().honestContext, honestContext, `${length}: reload keeps it`);
  assert.equal(
    parsePortableWorkspacePreferences({ settings: { honestContext }, lastBaseResume: "" }).settings.honestContext,
    honestContext,
    `${length}: backup restore keeps it`
  );
  assert.equal(
    parseStoredWorkspacePreferences({
      format: WORKSPACE_PREFERENCES_FORMAT,
      schemaVersion: WORKSPACE_PREFERENCES_SCHEMA_VERSION,
      updatedAt: "2026-09-28T00:00:00.000Z",
      source: "workspace",
      settings: { honestContext },
      lastBaseResume: ""
    }).settings.honestContext,
    honestContext,
    `${length}: the workspace file keeps it`
  );
}
setSettingsSaveListener(null);

console.log("Profile Background limit probes passed");
