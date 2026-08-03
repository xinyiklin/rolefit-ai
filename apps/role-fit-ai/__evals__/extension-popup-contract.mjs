import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The extension directory is loaded directly by Chrome, Edge, and Firefox, so it
// is a shipping artifact and not a place for tooling. Chrome refuses to load a
// directory containing any entry whose name starts with "_" — the reason these
// contracts live in the app's own __evals__ directory instead of beside the popup.
//
// The shipped set is read from desktop/extension-bundle.cts rather than repeated
// here: that module decides what the companion materializes, and a file present
// in one place but not the other is exactly the drift that once shipped an
// extension whose popup could not load. Its source is parsed instead of imported
// because the compiled bundle may not exist when this eval runs on its own.
const bundleSource = readFileSync(
  new URL("../desktop/extension-bundle.cts", import.meta.url),
  "utf8"
);
const shippedBlock = /export const EXTENSION_FILES = Object\.freeze\(\[([\s\S]*?)\]\s*as const\)/
  .exec(bundleSource);
assert.ok(shippedBlock, "EXTENSION_FILES must stay a literal array this contract can read");
const shipped = [...shippedBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.ok(shipped.length >= 8, "the shipped extension file list parsed as suspiciously short");

const extensionRoot = new URL("../extension/", import.meta.url);
// Dotfiles are ignored: macOS drops .DS_Store into any folder Finder shows, and
// the install flow asks the user to pick this exact folder. They are invisible to
// the browser's reserved-name rule and must not fail the gate.
function listTracked(directory) {
  return readdirSync(new URL(directory, extensionRoot), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."));
}

const guides = new Set(["AGENTS.md", "README.md"]);
const allowedTopLevel = new Set([...guides, ...shipped.map((file) => file.split("/")[0])]);
for (const entry of listTracked(".")) {
  assert.doesNotMatch(
    entry.name,
    /^_/,
    `extension root must not contain the reserved name "${entry.name}" — Chrome refuses to load it`
  );
  assert.ok(
    allowedTopLevel.has(entry.name),
    `${entry.name} is not shipped and not a guide; the browser loads this directory verbatim`
  );
  if (entry.isDirectory()) {
    for (const nested of listTracked(`${entry.name}/`)) {
      assert.doesNotMatch(nested.name, /^_/, `reserved name in extension/${entry.name}`);
    }
  }
}
for (const file of shipped) {
  assert.ok(
    readFileSync(new URL(file, extensionRoot)).length > 0,
    `shipped extension file is missing or empty: ${file}`
  );
}

const read = (name) => {
  const url = new URL(`../extension/${name}`, import.meta.url);
  execFileSync(process.execPath, ["--check", fileURLToPath(url)], { stdio: "pipe" });
  return readFileSync(url, "utf8");
};

const popup = read("popup.js");
const bridge = read("bridge.js");
const background = read("background.js");
read("settings.js");
const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8")
);

// ── Popup states ───────────────────────────────────────────────────────────

for (const state of [
  "loading",
  "job",
  "settings",
  "connection-error",
  "pairing-required",
  "unsupported-page",
  "request-error"
]) {
  assert.ok(popup.includes(`"${state}"`), `explicit popup state: ${state}`);
}

assert.match(
  popup,
  /import\s*\{[\s\S]*createLocalSiteOrigin[\s\S]*loadExtensionSettings[\s\S]*resetExtensionSettings[\s\S]*saveExtensionPort[\s\S]*validateLocalSitePort[\s\S]*\}\s*from\s*["']\.\/settings\.js["']/,
  "popup imports the settings module"
);
assert.match(
  popup,
  /from\s*["']\.\/bridge\.js["']/,
  "popup reaches the local server only through the shared bridge"
);

// ── The bridge owns the service handshake ──────────────────────────────────

assert.match(bridge, /function validateStatusResponse\(payload\)/, "status marker validation has a named boundary");
assert.match(bridge, /service === "rolefit-ai-extension"/, "status validates the RoleFit marker");
assert.match(bridge, /schemaVersion === 1/, "status validates schemaVersion 1");
assert.match(bridge, /status === "ok"/, "status validates the ok marker");
assert.match(bridge, /typeof payload\.paired === "boolean"/, "status validates the paired boolean");
assert.match(
  bridge,
  /export async function confirmPairedService[\s\S]*await getExtensionStatus/,
  "the pairing gate begins with the same-port status request"
);
// The status and pairing calls stay module-private so no caller can reach a
// send path around the gate.
assert.doesNotMatch(bridge, /export\s+(async\s+)?function getExtensionStatus/, "status is not exported");
assert.doesNotMatch(bridge, /export\s+(async\s+)?function requestExtensionPairing/, "pairing is not exported");
assert.match(
  bridge,
  /confirmPairedService[\s\S]*requestExtensionPairing/,
  "an unpaired status is re-checked through the origin-bearing pairing POST"
);

// Every request is bounded. An unbounded fetch hangs the popup behind a progress
// bar with no exit, and strands the keyboard command with no popup to report it.
// Matched on the request line itself rather than on the word "fetch", so a
// comment mentioning fetch cannot fail this gate with a misleading count.
const requestSites = [...bridge.matchAll(/fetch\(`\$\{apiBase\}\/api\/extension\/([a-z-]+)`/g)];
assert.deepEqual(
  requestSites.map((site) => site[1]).sort(),
  ["analyze", "import", "pairing-request", "status"],
  "the bridge calls exactly the four known extension routes"
);
for (const site of requestSites) {
  assert.match(
    bridge.slice(site.index, site.index + 400),
    /signal: timeoutSignal\(/,
    `no timeout on /api/extension/${site[1]}`
  );
}
assert.match(bridge, /AbortSignal\.timeout/, "timeouts use the platform abort signal");
assert.match(bridge, /function isTimeout\(error\)/, "a timed-out request is distinguished from an unreachable port");

// Both entry points must clear the same gate before any page text is sent.
// Compare call sites, not the import list at the top of each module.
for (const [name, source, sender] of [
  ["popup", popup, "await analyzePosting("],
  ["background", background, "await importPosting("]
]) {
  const gate = source.indexOf("await confirmPairedService(");
  const send = source.indexOf(sender);
  assert.ok(gate >= 0, `${name} awaits the pairing gate`);
  assert.ok(send > gate, `${name} sends page text only after the pairing gate`);
}

// ── Import wire contract ───────────────────────────────────────────────────

const importStart = bridge.indexOf("export async function importPosting");
const importEnd = bridge.indexOf("async function createTab", importStart);
const importFlow = bridge.slice(importStart, importEnd);
assert.ok(importStart >= 0 && importEnd > importStart, "import flow is bounded");
assert.match(
  importFlow,
  /body:\s*JSON\.stringify\(\{\s*text:\s*pageData\.text,\s*url:\s*pageData\.url,\s*claimToken\s*\}\)/,
  "import wire body contains only text, url, and claimToken"
);
assert.match(
  bridge,
  /extensionImport=\$\{encodeURIComponent\(claimToken\)\}/,
  "the claim token reaches the fresh tab"
);
assert.match(bridge, /cookieStoreId/, "Firefox container identity reaches fresh-tab creation");
assert.match(bridge, /text\.slice\(0, 50000\)/, "page extraction keeps the 50,000-character limit");
for (const source of [popup, background]) {
  assert.match(source, /const claimToken = randomClaimToken\(\)/, "each import creates one claim token");
}
for (const [name, source] of [["popup", popup], ["background", background]]) {
  assert.doesNotMatch(source, /fetch\(/, `${name} does not open its own request path`);
  assert.doesNotMatch(source, /tabs\.update\(/, `${name} never replaces the current RoleFit tab`);
}
assert.doesNotMatch(bridge, /tabs", "update"|tabs\.update\(/, "imports never replace the current RoleFit tab");

// ── Keyboard import ────────────────────────────────────────────────────────

assert.deepEqual(manifest.commands?.["import-job"]?.suggested_key, {
  default: "Ctrl+Shift+U",
  mac: "Command+Shift+U"
}, "manifest declares the direct-import shortcut");
assert.ok(
  typeof manifest.commands?.["import-job"]?.description === "string" &&
    manifest.commands["import-job"].description.trim().length > 0,
  "the import command is labeled in the browser shortcut editor"
);
assert.deepEqual(manifest.commands?._execute_action?.suggested_key, {
  default: "Ctrl+Shift+Y",
  mac: "Command+Shift+Y"
}, "manifest keeps the popup shortcut");
assert.equal(manifest.background?.service_worker, "background.js", "Chrome loads the event page as a service worker");
assert.deepEqual(manifest.background?.scripts, ["background.js"], "Firefox loads the same event page");
assert.equal(manifest.background?.type, "module", "the event page shares the popup's ES modules");

assert.match(
  background,
  /import\s+["']\.\/runtime-config\.js["']/,
  "the event page loads the install seed the popup gets from a classic script"
);
assert.match(background, /commands\?\.onCommand/, "the background listens for the shortcut command");
assert.match(background, /command !== IMPORT_COMMAND/, "the background handles only its own command");
assert.match(background, /importInFlight/, "a held shortcut cannot fan out duplicate imports");
assert.match(background, /saveShortcutNotice/, "a headless failure is reported back to the popup");
assert.match(popup, /readShortcutNotice[\s\S]*clearShortcutNotice/, "the popup shows the notice once and clears it");

// A failure that is followed by a clean reconnect must still leave a trace, or
// a failed import redraws an identical card and reads as a dead button.
assert.match(
  popup,
  /controller\.notice = error instanceof Error/,
  "an import failure is carried into the view it returns to"
);
assert.match(
  popup,
  /importState = "opened"/,
  "a completed import reaches a terminal state instead of staying 'Preparing'"
);
assert.match(popup, /opened: "Opened in RoleFit"/, "the terminal import state is labeled");
assert.match(popup, /pairingTitle = "Approval unconfirmed"/, "an unanswered pairing request is not reported as a refusal");

// Storage-backed side effects absorb their own rejections; `void` on a promise
// leaves an unhandled rejection behind a try/catch that only guards sync throws.
assert.doesNotMatch(popup, /void clearShortcutNotice\(\)/, "the notice clear handles its own failure");
assert.doesNotMatch(popup, /void extensionApi\?\.action\?\.setBadgeText/, "the badge clear handles its own failure");
assert.doesNotMatch(background, /void action\?\.setBadge/, "background badge writes handle their own failure");
assert.match(popup, /commands, "getAll"/, "the popup reads the actual assigned shortcuts");
assert.match(popup, /not assigned/, "the popup exposes an unassigned shortcut state");
// A failed or empty query is not the same fact as a deliberately cleared key.
assert.match(popup, /status: "unavailable"/, "an unreadable shortcut query is reported as unavailable");
assert.match(
  popup,
  /if \(!all\.length\) return \{ status: "unavailable" \}/,
  "a browser that registered no commands is not reported as two cleared keys"
);
assert.match(popup, /openShortcutSettings/, "Firefox shortcut management is feature-detected");
// The engine test must not be a feature that only newer Firefox ships, or an
// older Firefox gets routed to a chrome:// URL it may not open.
assert.match(
  popup,
  /function isFirefoxRuntime\(\)[\s\S]*getBrowserInfo/,
  "Firefox is detected by a long-standing Firefox-only API"
);
assert.doesNotMatch(
  popup,
  /function isFirefox\w*\(\)\s*\{\s*return Boolean\(globalThis\.browser\?\.commands\?\.openShortcutSettings\)/,
  "engine detection no longer depends on openShortcutSettings"
);
assert.match(popup, /about:addons/, "Firefox without the deep link is sent to its add-ons page");
assert.match(popup, /edge:\/\/extensions\/shortcuts/, "Edge shortcut settings fallback is present");
assert.match(popup, /chrome:\/\/extensions\/shortcuts/, "Chrome shortcut settings fallback is present");

// A module that fails to load must not open as a blank popup.
const popupHtml = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
assert.match(popupHtml, /id="root"[\s\S]*boot-error/, "popup.html carries a pre-render failure message");

// Rendering replaces #root wholesale, so anything that must survive a render —
// the live region and keyboard focus — cannot live inside it.
assert.match(
  popupHtml,
  /<\/div>[\s\S]*id="announcer"[\s\S]*role="status"/,
  "the live region sits outside the re-rendered root"
);
assert.match(popup, /function announce\(text\)/, "progress is announced through that one region");
assert.match(popup, /text === lastAnnouncement/, "an unchanged status is not re-announced on every render");
assert.match(
  popup,
  /const focusKey = active\?\.getAttribute\?\.\("data-focus-key"\)[\s\S]*replaceChildren[\s\S]*restored\.focus\(\)/,
  "focus is captured before the rebuild and restored after it"
);
for (const key of ["settings-toggle", "primary", "port", "save-port", "reset-port", "change-shortcuts"]) {
  assert.ok(popup.includes(`"${key}"`), `focusable control keeps its key: ${key}`);
}

// The keyboard path must not widen what the extension may reach.
assert.deepEqual(
  [...manifest.permissions].sort(),
  ["activeTab", "cookies", "scripting", "storage"],
  "the shortcut adds no permission beyond the popup's"
);
assert.deepEqual(manifest.host_permissions, ["http://localhost/*"], "host access stays on localhost");

// ── Port recovery ──────────────────────────────────────────────────────────

assert.match(popup, /forcePairing/, "an explicit check re-sends the pairing request");
assert.match(
  popup,
  /Check again[\s\S]*forcePairing: true/,
  "check again retries pairing instead of reusing the throttled result"
);
assert.match(popup, /saveAndReconnect/, "connection recovery saves and reconnects in place");
assert.match(popup, /Reset to 5181/, "settings includes the default reset action");
assert.match(popup, /"Settings"/, "the masthead exposes a settings control");
assert.match(popup, /aria-expanded/, "the settings control reports its state");

for (const retired of [
  "LOCAL_SITE_PORT",
  "API_BASE",
  "autoTailor",
  "distillAi",
  "chrome.storage",
  "Prepare job details with AI",
  "Tailor resume after preparation",
  "RoleFit does not estimate fit locally"
]) {
  const pattern = new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const [name, source] of [["popup", popup], ["bridge", bridge], ["background", background]]) {
    assert.doesNotMatch(source, pattern, `retired contract is absent from ${name}: ${retired}`);
  }
}

console.log("Extension popup source contract eval: PASS");
