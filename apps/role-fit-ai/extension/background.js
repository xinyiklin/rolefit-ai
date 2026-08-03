// Keyboard-shortcut import. The popup is the ordinary surface; this event page
// exists only so `import-job` can capture the active posting and hand it to a
// fresh RoleFit tab without a popup round trip.
//
// It runs the same bridge flow as the popup, so page text still leaves the
// browser only after the same-port status handshake identifies an approved
// RoleFit service. With no popup rendered, failures are reported through the
// toolbar badge plus a one-shot notice the popup shows the next time it opens.
//
// The `import-job` command is a user gesture, which is what grants `activeTab`
// for the capture; the extension keeps no broad host permission for job boards.

// popup.html loads the install seed as a classic script; the event page has no
// document, so it must pull the same global in. Without it, a shortcut pressed
// before the popup has ever run has no seed to migrate from and fails.
import "./runtime-config.js";
import {
  capturePageData,
  confirmPairedService,
  importPosting,
  openImportTab,
  randomClaimToken
} from "./bridge.js";
import { createLocalSiteOrigin, loadExtensionSettings, saveShortcutNotice } from "./settings.js";

const IMPORT_COMMAND = "import-job";
const BADGE_WORKING = "···";
const BADGE_FAILED = "!";
const BADGE_INK = "#23664f";
const BADGE_ALERT = "#8a3324";

const action = globalThis.chrome?.action ?? globalThis.browser?.action;
const commands = globalThis.chrome?.commands ?? globalThis.browser?.commands;

// One import at a time: a held-down shortcut must not fan out captures of the
// same page into several tracker entries.
let importInFlight = false;

// Firefox's action methods return promises, so results are absorbed explicitly;
// a bare call would leave an unhandled rejection behind the try/catch, which
// only guards the synchronous Chrome form.
function setBadge(text, color) {
  const absorb = (result) => {
    if (result && typeof result.then === "function") result.catch(() => {});
  };
  try {
    absorb(action?.setBadgeText?.({ text }));
    if (text && color) absorb(action?.setBadgeBackgroundColor?.({ color }));
  } catch {
    // A browser without badge support still completes the import itself.
  }
}

async function reportFailure(message) {
  setBadge(BADGE_FAILED, BADGE_ALERT);
  try {
    await saveShortcutNotice(message);
  } catch {
    // The badge alone still signals that the keyboard import did not land.
  }
}

async function runShortcutImport() {
  if (importInFlight) return;
  importInFlight = true;
  setBadge(BADGE_WORKING, BADGE_INK);

  try {
    const settings = await loadExtensionSettings();
    const apiBase = createLocalSiteOrigin(settings.localSitePort);
    const { pageData, sourceTab } = await capturePageData();

    // Identity and approval first; only then does the posting text leave.
    const { paired } = await confirmPairedService(apiBase);
    if (!paired) {
      await reportFailure("Approve this extension in the RoleFit companion, then try the shortcut again.");
      return;
    }

    const claimToken = randomClaimToken();
    await importPosting(apiBase, pageData, claimToken);
    try {
      await openImportTab(apiBase, claimToken, sourceTab?.cookieStoreId);
    } catch {
      // The posting is queued server-side; only the tab hand-off failed.
      await reportFailure("The posting was captured, but RoleFit could not be opened. Open RoleFit to finish.");
      return;
    }
    setBadge("", null);
  } catch (error) {
    await reportFailure(error instanceof Error && error.message
      ? error.message
      : "The keyboard import did not complete.");
  } finally {
    importInFlight = false;
  }
}

commands?.onCommand?.addListener((command) => {
  if (command !== IMPORT_COMMAND) return;
  void runShortcutImport();
});
