import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage {
  #entries = new Map();

  get length() {
    return this.#entries.size;
  }

  key(index) {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#entries.get(key) ?? null;
  }

  setItem(key, value) {
    this.#entries.set(key, String(value));
  }

  removeItem(key) {
    this.#entries.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
sessionStorage.setItem("rolefit:tabId", "current-tab");

const { clearTabDraft, recoverTabDraft, saveTabDraft } = await import(
  "../autosaveDraftStorage.ts"
);
const { keyForTab } = await import("../autosaveDraftRegistry.ts");
const { draftAutosaveStateForRevision } = await import(
  "../../hooks/useDebouncedRecoveryDraft.ts"
);
const { extensionImportClaimTokenFromHref } = await import(
  "../extensionImportClaim.ts"
);

const parse = (raw) => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value.savedAt === "string" && typeof value.payload === "string"
      ? value
      : null;
  } catch {
    return null;
  }
};

const currentKey = keyForTab("resume", "current-tab");
const otherKey = keyForTab("resume", "closed-tab");
const expiredOtherKey = keyForTab("resume", "expired-closed-tab");
const otherKindKey = keyForTab("cover", "closed-tab");
const unrelatedKey = "rolefit:workspacePreferences";
const fresh = new Date().toISOString();
const expired = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();

localStorage.setItem(otherKey, JSON.stringify({ payload: "other", savedAt: fresh }));
localStorage.setItem(expiredOtherKey, JSON.stringify({ payload: "expired-other", savedAt: expired }));
localStorage.setItem(otherKindKey, JSON.stringify({ payload: "other-kind", savedAt: expired }));
localStorage.setItem(unrelatedKey, "keep");
assert.equal(
  recoverTabDraft("resume", parse),
  null,
  "a new tab never adopts a valid recovery draft from a closed tab"
);
assert.equal(
  parse(localStorage.getItem(otherKey))?.payload,
  "other",
  "a valid recovery draft owned by another tab remains untouched"
);
assert.equal(localStorage.getItem(expiredOtherKey), null, "expired dead-tab data is garbage-collected");
assert.notEqual(localStorage.getItem(otherKindKey), null, "one document kind never clears the other kind");

localStorage.setItem(currentKey, JSON.stringify({ payload: "current", savedAt: fresh }));
assert.equal(
  recoverTabDraft("resume", parse)?.payload,
  "current",
  "a reload may recover this tab's own fresh draft"
);

localStorage.setItem(currentKey, JSON.stringify({ payload: "expired", savedAt: expired }));
assert.equal(recoverTabDraft("resume", parse), null, "this tab's 24-hour-old draft expires");
assert.equal(localStorage.getItem(currentKey), null, "expiry removes only the expired recovery key");
assert.notEqual(localStorage.getItem(otherKey), null, "expiry leaves a valid other-tab draft alone");
assert.equal(localStorage.getItem(unrelatedKey), "keep", "expiry never clears unrelated localStorage");

assert.equal(
  saveTabDraft("resume", { payload: "latest", savedAt: fresh }),
  true,
  "saving writes the current tab recovery entry"
);
assert.equal(parse(localStorage.getItem(currentKey))?.payload, "latest");
clearTabDraft("resume");
assert.equal(localStorage.getItem(currentKey), null, "clearing removes the current tab recovery entry");
assert.notEqual(localStorage.getItem(otherKey), null, "clearing leaves other tabs' recovery entries alone");
assert.equal(localStorage.getItem(unrelatedKey), "keep", "clearing never wipes localStorage");

const savedRevision = {};
const nextRevision = {};
assert.equal(
  draftAutosaveStateForRevision(true, savedRevision, savedRevision, "saved"),
  "saved",
  "a successful write applies only to the exact revision it saved"
);
assert.equal(
  draftAutosaveStateForRevision(true, nextRevision, savedRevision, "saved"),
  "pending",
  "a newer edit becomes pending during render, before its debounce effect runs"
);
assert.equal(
  draftAutosaveStateForRevision(false, nextRevision, savedRevision, "saved"),
  "idle",
  "a clean document reports no pending recovery write"
);

assert.equal(
  extensionImportClaimTokenFromHref("http://127.0.0.1:5181/?extensionImport=claim-1"),
  "claim-1",
  "a fresh extension tab exposes its one-shot import claim before inbox polling"
);
assert.equal(
  extensionImportClaimTokenFromHref("http://127.0.0.1:5181/?extensionImport=%20%20"),
  "",
  "a blank extension claim never suppresses ordinary recovery"
);
assert.equal(
  extensionImportClaimTokenFromHref("not a URL"),
  "",
  "malformed locations fail closed"
);

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const autosaveHook = readFileSync(
  new URL("../../hooks/useAutosaveDraft.ts", import.meta.url),
  "utf8"
);
const debouncedAutosaveHook = readFileSync(
  new URL("../../hooks/useDebouncedRecoveryDraft.ts", import.meta.url),
  "utf8"
);
const extensionInboxHook = readFileSync(
  new URL("../../hooks/useExtensionInbox.ts", import.meta.url),
  "utf8"
);
const resumeTab = readFileSync(new URL("../../sections/tabs/ResumeTab.tsx", import.meta.url), "utf8");
const coverTab = readFileSync(new URL("../../sections/tabs/CoverLetterTab.tsx", import.meta.url), "utf8");
const extensionBoundaryStart = app.indexOf("function handleExtensionNewPreparation()");
const extensionBoundaryEnd = app.indexOf("const {", extensionBoundaryStart);
assert.ok(extensionBoundaryStart >= 0 && extensionBoundaryEnd > extensionBoundaryStart);
const extensionBoundary = app.slice(extensionBoundaryStart, extensionBoundaryEnd);
assert.match(extensionBoundary, /setPendingAutosaveDraft\(null\)/);
assert.match(extensionBoundary, /setPendingCoverDraft\(null\)/);
assert.doesNotMatch(
  extensionBoundary,
  /clearAutosaveDraft|clearCoverLetterAutosaveDraft/,
  "extension intake suppresses recovery UI without deleting recoverable work"
);
assert.match(
  app,
  /onExtensionPrepareStarted: handleExtensionNewPreparation,[\s\S]{0,100}?onExtensionJobReceived: handleExtensionNewPreparation/,
  "both extension delivery phases use the same recovery boundary"
);
const recoveryMountStart = app.indexOf("// ----- Effects -----");
const recoveryMountEnd = app.indexOf("// Once the user starts editing", recoveryMountStart);
assert.ok(recoveryMountStart >= 0 && recoveryMountEnd > recoveryMountStart);
const recoveryMount = app.slice(recoveryMountStart, recoveryMountEnd);
assert.match(
  recoveryMount,
  /const suppressRecoveryPrompt = Boolean\(\s*extensionImportClaimTokenFromHref\(window\.location\.href\)\s*\)/,
  "a fresh extension claim is detected before recovery prompts are populated"
);
assert.match(
  recoveryMount,
  /if \(draft && !suppressRecoveryPrompt\) setPendingAutosaveDraft\(draft\)/,
  "a claim-token extension tab never renders the prior resume recovery prompt"
);
assert.match(
  recoveryMount,
  /if \(coverDraft && !suppressRecoveryPrompt\) setPendingCoverDraft\(coverDraft\)/,
  "a claim-token extension tab never renders the prior cover-letter recovery prompt"
);
assert.match(
  autosaveHook,
  /const dirtyRef = useRef\(dirty\);\s*dirtyRef\.current = dirty;/,
  "the registered before-unload handler sees the current render's guard value"
);
assert.match(
  debouncedAutosaveHook,
  /const currentRequest = currentRequestRef\.current;\s*if \(!currentRequest\.shouldSave \|\| currentRequest\.revision !== revision\) return;/,
  "a retired debounce timer cannot write after a newer or clean render"
);
const missingClaimStart = extensionInboxHook.indexOf(
  'if (data === null || typeof data !== "object")'
);
const missingClaimEnd = extensionInboxHook.indexOf("const obj = data as", missingClaimStart);
assert.ok(missingClaimStart >= 0 && missingClaimEnd > missingClaimStart);
const missingClaimBoundary = extensionInboxHook.slice(missingClaimStart, missingClaimEnd);
assert.match(
  missingClaimBoundary,
  /if \(claimToken\)[\s\S]*clearExtensionImportParam\(\)/,
  "a definitive no-entry response removes a stale claim token so later reloads can recover normally"
);
assert.match(resumeTab, /label="Recovery draft available"/, "resume recovery uses interruption copy");
assert.match(coverTab, /label="Recovery draft available"/, "cover recovery uses interruption copy");

console.log("autosave draft storage isolation: PASS");
