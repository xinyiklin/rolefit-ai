import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  hardenWindow,
  isAllowedRendererPermission,
  isTrustedCompanionUrl,
  installSessionSecurity
} from "../../dist-electron/desktop/security.cjs";

const companionUrl = "file:///tmp/rolefit%20companion/companion.html";

const desktopRoot = resolve(import.meta.dirname, "..");
const [mainEntitlements, inheritedEntitlements, forgeConfigSource, compiledMainSource] = await Promise.all([
  readFile(resolve(desktopRoot, "assets/entitlements.mac.plist"), "utf8"),
  readFile(resolve(desktopRoot, "assets/entitlements.mac.inherit.plist"), "utf8"),
  readFile(resolve(desktopRoot, "forge.config.cjs"), "utf8"),
  readFile(resolve(desktopRoot, "../dist-electron/desktop/main.cjs"), "utf8")
]);
assert.match(mainEntitlements, /com\.apple\.security\.automation\.apple-events/);
assert.doesNotMatch(inheritedEntitlements, /com\.apple\.security\.automation\.apple-events/);
assert.match(
  forgeConfigSource,
  /entitlementsInherit: path\.join\(assets, "entitlements\.mac\.inherit\.plist"\)/
);

// Every BrowserWindow the companion creates (the main companion window and the
// smoke-only untrusted-bridge probe window) must keep the hardened
// webPreferences flags. Assert against the compiled dist-electron output the
// packaged app actually runs (rebuilt by the test:desktop:security script), and
// extract each webPreferences object by balanced braces so the assertions do
// not depend on formatting.
function extractWebPreferencesBlocks(source) {
  const blocks = [];
  const marker = /webPreferences:\s*\{/g;
  for (let match = marker.exec(source); match !== null; match = marker.exec(source)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    assert.notEqual(end, -1, "Unterminated webPreferences object in compiled desktop main.");
    blocks.push(source.slice(start, end + 1));
  }
  return blocks;
}

const requiredWebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  allowRunningInsecureContent: false
};
const windowCreationCount =
  compiledMainSource.match(/\bnew\s+(?:[\w$]+\.)?BrowserWindow\s*\(/g)?.length ?? 0;
const webPreferencesBlocks = extractWebPreferencesBlocks(compiledMainSource);
assert.equal(
  windowCreationCount,
  2,
  "Expected exactly the two known BrowserWindow creation sites in desktop main; a new window must add its hardened webPreferences to this probe."
);
assert.equal(
  webPreferencesBlocks.length,
  windowCreationCount,
  "Every BrowserWindow in desktop main must declare an explicit webPreferences object."
);
for (const [blockIndex, block] of webPreferencesBlocks.entries()) {
  for (const [flag, safeValue] of Object.entries(requiredWebPreferences)) {
    assert.match(
      block,
      new RegExp(`\\b${flag}:\\s*${safeValue}\\b`),
      `webPreferences block ${blockIndex} must set ${flag}: ${safeValue}.`
    );
    assert.doesNotMatch(
      block,
      new RegExp(`\\b${flag}:\\s*${!safeValue}\\b`),
      `webPreferences block ${blockIndex} must not set ${flag}: ${!safeValue}.`
    );
  }
}

assert.equal(isTrustedCompanionUrl(companionUrl, companionUrl), true);
assert.equal(isTrustedCompanionUrl(`${companionUrl}#section`, companionUrl), false);
assert.equal(isTrustedCompanionUrl("file:///tmp/other/companion.html", companionUrl), false);
assert.equal(isTrustedCompanionUrl("http://127.0.0.1:5181/", companionUrl), false);
assert.equal(isTrustedCompanionUrl("data:text/html,untrusted", companionUrl), false);
assert.equal(isTrustedCompanionUrl("javascript:void 0", companionUrl), false);

assert.equal(isAllowedRendererPermission("clipboard-sanitized-write"), false);
assert.equal(isAllowedRendererPermission("clipboard-read"), false);
assert.equal(isAllowedRendererPermission("fileSystem"), false);

let permissionCheckHandler = null;
let permissionRequestHandler = null;
let devicePermissionHandler = null;
const session = {
  setPermissionCheckHandler(handler) {
    permissionCheckHandler = handler;
  },
  setPermissionRequestHandler(handler) {
    permissionRequestHandler = handler;
  },
  setDevicePermissionHandler(handler) {
    devicePermissionHandler = handler;
  }
};
const removeSessionSecurity = installSessionSecurity(session);
assert.equal(typeof permissionCheckHandler, "function");
assert.equal(typeof permissionRequestHandler, "function");
assert.equal(typeof devicePermissionHandler, "function");
assert.equal(permissionCheckHandler(null, "clipboard-sanitized-write", companionUrl, {}), false);
let permissionGranted = null;
permissionRequestHandler(
  { getURL: () => companionUrl },
  "clipboard-sanitized-write",
  (value) => {
    permissionGranted = value;
  },
  { requestingOrigin: companionUrl }
);
assert.equal(permissionGranted, false);
assert.equal(devicePermissionHandler({}), false);
removeSessionSecurity();
assert.equal(permissionCheckHandler, null);
assert.equal(permissionRequestHandler, null);
assert.equal(devicePermissionHandler, null);

const windowHandlers = new Map();
let windowOpenHandler = null;
const window = {
  webContents: {
    on(event, handler) {
      windowHandlers.set(event, handler);
    },
    setWindowOpenHandler(handler) {
      windowOpenHandler = handler;
    }
  }
};
hardenWindow(window, companionUrl);
assert.deepEqual(
  [...windowHandlers.keys()].sort(),
  ["will-attach-webview", "will-navigate", "will-redirect"]
);
let prevented = false;
windowHandlers.get("will-attach-webview")({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
prevented = false;
windowHandlers.get("will-navigate")({
  url: companionUrl,
  preventDefault: () => { prevented = true; }
});
assert.equal(prevented, false);
windowHandlers.get("will-navigate")({
  url: "https://example.com",
  preventDefault: () => { prevented = true; }
});
assert.equal(prevented, true);
prevented = false;
windowHandlers.get("will-redirect")({
  url: companionUrl,
  preventDefault: () => { prevented = true; }
});
assert.equal(prevented, true);
assert.deepEqual(windowOpenHandler({ url: "javascript:alert(1)" }), { action: "deny" });
assert.deepEqual(windowOpenHandler({ url: "https://example.com/provider" }), { action: "deny" });
assert.deepEqual(windowOpenHandler({ url: "mailto:support@example.com" }), { action: "deny" });
assert.deepEqual(windowOpenHandler({ url: companionUrl }), { action: "deny" });

console.log("desktop companion security probes: passed");
