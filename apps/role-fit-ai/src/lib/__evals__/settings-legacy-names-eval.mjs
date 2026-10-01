// Settings saved before the 2026-09-29 naming pass must load with every value
// under its current name, through each boundary that reads stored settings:
// the browser cache, the canonical workspace file, and a portable backup.

import assert from "node:assert/strict";

import { loadSettings, migrateStoredSettings, normalizeSettings } from "../settings.ts";
import {
  WORKSPACE_PREFERENCES_FORMAT,
  WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  parsePortableWorkspacePreferences,
  parseStoredWorkspacePreferences
} from "../workspaceBackupContract.ts";

const legacy = {
  jobAnalysisProvider: "claude-cli",
  jobAnalysisSelectedModel: "claude-sonnet-5",
  jobAnalysisCliReasoningEffort: "medium",
  fitAssessmentProvider: "claude-cli",
  fitAssessmentSelectedModel: "claude-sonnet-5",
  fitAssessmentCliReasoningEffort: "low",
  aiProvider: "codex-cli",
  selectedModel: "gpt-6-sol",
  cliReasoningEffort: "high",
  coverProvider: "claude-cli",
  coverSelectedModel: "claude-opus-5",
  coverCliReasoningEffort: "max",
  answersProvider: "openai",
  answersSelectedModel: "gpt-5.6-terra",
  answersCliReasoningEffort: "",
  finalReviewProvider: "claude-cli",
  finalReviewSelectedModel: "claude-sonnet-5",
  finalReviewCliReasoningEffort: "medium",
  honestContext: "## Slotwise (personal project, 2025–present)\nBuilt scheduling services.",
  customInstructions: "Keep it direct.",
  stageCustomInstructions: {
    "resume-polish": "One page.",
    cover: "Warm but brief.",
    answers: "Two sentences each."
  },
  boldBulletKeywords: false,
  runFitAssessment: false,
  autoPolishResume: true,
  resumeAutoPolishThreshold: "STRETCH",
  autoPolishCoverLetter: true,
  coverLetterAutoPolishThreshold: "REASONABLE",
  citizenshipStatus: "us-citizen",
  gpa: 3.5
};

const current = {
  jobAnalysisProvider: "claude-cli",
  jobAnalysisSelectedModel: "claude-sonnet-5",
  jobAnalysisCliReasoningEffort: "medium",
  fitAssessmentProvider: "claude-cli",
  fitAssessmentSelectedModel: "claude-sonnet-5",
  fitAssessmentCliReasoningEffort: "low",
  resumePolishProvider: "codex-cli",
  resumePolishSelectedModel: "gpt-6-sol",
  resumePolishCliReasoningEffort: "high",
  coverPolishProvider: "claude-cli",
  coverPolishSelectedModel: "claude-opus-5",
  coverPolishCliReasoningEffort: "max",
  applicationAnswersProvider: "openai",
  applicationAnswersSelectedModel: "gpt-5.6-terra",
  applicationAnswersCliReasoningEffort: "",
  applicationReviewProvider: "claude-cli",
  applicationReviewSelectedModel: "claude-sonnet-5",
  applicationReviewCliReasoningEffort: "medium",
  profileBackground: "## Slotwise (personal project, 2025–present)\nBuilt scheduling services.",
  customInstructions: "Keep it direct.",
  stageCustomInstructions: {
    "resume-polish": "One page.",
    "cover-polish": "Warm but brief.",
    "application-answers": "Two sentences each."
  },
  boldBulletKeywords: false,
  fitAssessmentAuto: false,
  resumePolishAuto: true,
  resumePolishAutoThreshold: "STRETCH",
  coverPolishAuto: true,
  coverPolishAutoThreshold: "REASONABLE",
  citizenshipStatus: "us-citizen",
  gpa: 3.5
};

const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

assert.deepEqual(normalizeSettings(current), current, "the current-name fixture is already canonical");
assert.deepEqual(sorted(migrateStoredSettings(legacy)), sorted(current), "every old name converts with its value");
assert.deepEqual(migrateStoredSettings(current), current, "current names pass through unchanged");
assert.deepEqual(
  migrateStoredSettings(migrateStoredSettings(legacy)),
  migrateStoredSettings(legacy),
  "a second load changes nothing"
);
assert.deepEqual(legacy.stageCustomInstructions.cover, "Warm but brief.", "conversion does not mutate its input");

assert.deepEqual(
  migrateStoredSettings({ aiProvider: "openai", resumePolishProvider: "claude-cli", honestContext: "old", profileBackground: "new" }),
  { resumePolishProvider: "claude-cli", profileBackground: "new" },
  "a stored current name wins over its old name"
);
assert.deepEqual(
  migrateStoredSettings({ stageCustomInstructions: { cover: "old", "cover-polish": "new" } }),
  { stageCustomInstructions: { "cover-polish": "new" } },
  "a current stage override wins over its old stage id"
);

assert.deepEqual(
  sorted(parsePortableWorkspacePreferences({ settings: legacy, lastBaseResume: "" }).settings),
  sorted(current),
  "an old backup restores every value under current names"
);
assert.throws(
  () => parsePortableWorkspacePreferences({ settings: { ...legacy, credential: "must-not-travel" }, lastBaseResume: "" }),
  "an unknown key still fails closed after conversion"
);

const stored = {
  format: WORKSPACE_PREFERENCES_FORMAT,
  schemaVersion: WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  updatedAt: "2026-09-29T12:00:00.000Z",
  source: "workspace",
  settings: legacy,
  lastBaseResume: ""
};
assert.deepEqual(
  sorted(parseStoredWorkspacePreferences(stored).settings),
  sorted(current),
  "an old canonical workspace file reads under current names"
);

const cache = new Map([["rolefit:settings", JSON.stringify(legacy)]]);
globalThis.localStorage = {
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => cache.set(key, String(value)),
  removeItem: (key) => cache.delete(key)
};
assert.deepEqual(sorted(loadSettings()), sorted(current), "an old browser cache loads under current names");

console.log("settings legacy-name probes passed");
