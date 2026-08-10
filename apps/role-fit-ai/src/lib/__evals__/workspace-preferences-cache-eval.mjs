import assert from "node:assert/strict";

import {
  clearStoredSettings,
  loadSettings,
  saveSettings,
  setSettingsSaveListener
} from "../settings.ts";
import {
  loadLastBaseResumeName,
  saveLastBaseResumeName,
  setLastBaseResumeSaveListener
} from "../baseResumePrefs.ts";

// The workspace notification is the durable path. It must still receive the
// normalized snapshot when localStorage is missing (privacy mode, policy, or a
// failed cache), otherwise the supposedly canonical workspace would secretly
// depend on browser persistence.
delete globalThis.localStorage;

let savedSettings = null;
setSettingsSaveListener((settings) => {
  savedSettings = settings;
});
saveSettings({
  runFitAssessment: true,
  gpa: 3.86,
  availabilityNotice: "two-weeks",
  experienceProfile: [{ category: "professional", years: 2.5, count: 2 }]
});
assert.deepEqual(savedSettings, {
  runFitAssessment: true,
  gpa: 3.86,
  availabilityNotice: "two-weeks",
  experienceProfile: [{ category: "professional", years: 2.5, count: 2 }]
}, "a missing browser cache does not suppress the normalized workspace settings notification");
assert.deepEqual(loadSettings(), savedSettings, "the live app can read adopted settings from memory when localStorage is unavailable");

clearStoredSettings();
assert.deepEqual(savedSettings, {}, "reset notifies the workspace even without a browser cache");
setSettingsSaveListener(null);

let savedBaseResume = null;
setLastBaseResumeSaveListener((fileName) => {
  savedBaseResume = fileName;
});
saveLastBaseResumeName("  default.resume  ");
assert.equal(savedBaseResume, "default.resume", "base-resume selection reaches the workspace without localStorage");
assert.equal(loadLastBaseResumeName(), "default.resume", "the live app can read the selected base resume from memory without localStorage");
saveLastBaseResumeName("");
assert.equal(savedBaseResume, "", "clearing the base-resume selection also reaches the workspace");
setLastBaseResumeSaveListener(null);

console.log("workspace preference cache probes passed");
