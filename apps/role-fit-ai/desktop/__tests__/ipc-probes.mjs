import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  ROLEFIT_API_KEY_MAX_BYTES,
  ROLEFIT_DESKTOP_API_VERSION,
  ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
  ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH,
  createRoleFitDesktopRuntimeInfo,
  isRoleFitApiProviderId,
  isRoleFitCliProviderId,
  isRoleFitProviderId,
  normalizeRoleFitDesktopPlatform
} from "../../dist-electron/desktop/ipc-contract.cjs";
import {
  installCompanionIpc,
  isTrustedCompanionRequest
} from "../../dist-electron/desktop/ipc.cjs";

const companionUrl = "file:///tmp/rolefit-companion/companion.html";
const trustedSenderId = 41;
const bridgeKey = "roleFitDesktop";
const channels = Object.freeze({
  runtime: "rolefit:companion:get-runtime-info",
  settings: "rolefit:companion:get-local-site-settings",
  applyPort: "rolefit:companion:apply-local-site-port",
  providers: "rolefit:companion:get-provider-connections",
  saveApi: "rolefit:companion:save-api-provider",
  remove: "rolefit:companion:remove-provider",
  configureCli: "rolefit:companion:set-cli-provider-enabled",
  begin: "rolefit:companion:begin-cli-sign-in",
  cancel: "rolefit:companion:cancel-cli-sign-in",
  terminal: "rolefit:companion:open-cli-sign-in-terminal",
  installGuide: "rolefit:companion:open-provider-install-guide",
  open: "rolefit:companion:open-browser-app"
});
const providerIds = Object.freeze([
  "claude-cli",
  "codex-cli",
  "antigravity-cli",
  "openai",
  "anthropic"
]);
const runtimeInfo = createRoleFitDesktopRuntimeInfo("darwin", "0.1.0", "43.1.1");
const siteSettings = Object.freeze({
  schemaVersion: 1,
  localSitePort: 5_181,
  source: "default",
  locked: false,
  warning: null
});
const longGuidance = "g".repeat(ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH + 20);
const providerConnections = Object.freeze([
  Object.freeze({
    id: "claude-cli",
    kind: "cli",
    configured: true,
    ready: false,
    installed: true,
    authState: "signed-out",
    setupFlow: "managed-login",
    signInRunning: false,
    guidance: longGuidance
  }),
  Object.freeze({
    id: "codex-cli",
    kind: "cli",
    configured: true,
    ready: true,
    installed: true,
    authState: "signed-in",
    setupFlow: "managed-login",
    signInRunning: false,
    guidance: "Ready to use."
  }),
  Object.freeze({
    id: "antigravity-cli",
    kind: "cli",
    configured: false,
    ready: false,
    installed: false,
    authState: "unknown",
    setupFlow: "manual-login",
    signInRunning: false,
    guidance: "Install Antigravity before enabling it."
  }),
  Object.freeze({
    id: "openai",
    kind: "api",
    configured: true,
    ready: true,
    installed: null,
    authState: "not-applicable",
    setupFlow: "api-key",
    signInRunning: false,
    guidance: "Stored securely on this device.",
    apiKey: "must-not-cross-ipc"
  }),
  Object.freeze({
    id: "anthropic",
    kind: "api",
    configured: false,
    ready: false,
    installed: null,
    authState: "not-applicable",
    setupFlow: "api-key",
    signInRunning: false,
    guidance: "Add an Anthropic API key."
  })
]);

assert.equal(ROLEFIT_DESKTOP_API_VERSION, 5);
assert.equal(ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION, 1);
assert.equal(ROLEFIT_API_KEY_MAX_BYTES, 16_384);
assert.equal(normalizeRoleFitDesktopPlatform("darwin"), "darwin");
assert.equal(normalizeRoleFitDesktopPlatform("freebsd"), "other");
assert.equal(isRoleFitCliProviderId("claude-cli"), true);
assert.equal(isRoleFitCliProviderId("openai"), false);
assert.equal(isRoleFitApiProviderId("openai"), true);
assert.equal(isRoleFitApiProviderId("claude-cli"), false);
assert.equal(isRoleFitProviderId("anthropic"), true);
assert.equal(isRoleFitProviderId("shell"), false);
assert.deepEqual(runtimeInfo, {
  apiVersion: 5,
  runtime: "electron-companion",
  platform: "darwin",
  appVersion: "0.1.0",
  electronVersion: "43.1.1"
});
assert.equal(Object.isFrozen(runtimeInfo), true);
assert.throws(() => createRoleFitDesktopRuntimeInfo("linux", " ", "43.1.1"), /cannot be empty/);

function requestEvent({
  senderId = trustedSenderId,
  url = companionUrl,
  mainFrameMatches = true
} = {}) {
  const frame = { url };
  return {
    sender: { id: senderId, mainFrame: mainFrameMatches ? frame : { url } },
    senderFrame: frame
  };
}

assert.equal(isTrustedCompanionRequest(requestEvent(), companionUrl, trustedSenderId), true);
assert.equal(
  isTrustedCompanionRequest(requestEvent({ senderId: 99 }), companionUrl, trustedSenderId),
  false
);
assert.equal(
  isTrustedCompanionRequest(requestEvent({ url: "http://127.0.0.1:5181/" }), companionUrl, trustedSenderId),
  false
);
assert.equal(
  isTrustedCompanionRequest(requestEvent({ url: "data:text/html,untrusted" }), companionUrl, trustedSenderId),
  false
);
assert.equal(
  isTrustedCompanionRequest(requestEvent({ mainFrameMatches: false }), companionUrl, trustedSenderId),
  false
);
assert.equal(
  isTrustedCompanionRequest(
    { sender: { id: trustedSenderId, mainFrame: {} }, senderFrame: null },
    companionUrl,
    trustedSenderId
  ),
  false
);

const installedHandlers = new Map();
const removedChannels = [];
const fakeIpc = {
  handle(channel, handler) {
    assert.equal(installedHandlers.has(channel), false);
    installedHandlers.set(channel, handler);
  },
  removeHandler(channel) {
    removedChannels.push(channel);
    installedHandlers.delete(channel);
  }
};
let connectionsResult = [...providerConnections].reverse();
let savedApiProvider = null;
let savedApiKey = null;
let removedProvider = null;
let configuredCli = null;
let beganProvider = null;
let canceledOperation = null;
let openedTerminalProvider = null;
let openedInstallGuide = null;
let browserOpenCount = 0;
let appliedLocalSitePort = null;
let siteSettingsFailure = null;
let saveShouldLeak = false;
let terminalShouldLeak = false;

function connectionFor(id, overrides = {}) {
  const connection = providerConnections.find((candidate) => candidate.id === id);
  assert.ok(connection);
  return { ...connection, ...overrides };
}

const options = {
  ipc: fakeIpc,
  companionUrl,
  getTrustedWebContentsId: () => trustedSenderId,
  getRuntimeInfo: () => runtimeInfo,
  getLocalSiteSettings: () => ({
    ...siteSettings,
    workspaceDir: "/must-not-cross-ipc",
    apiKey: "must-not-cross-ipc"
  }),
  applyLocalSitePort: async (port) => {
    appliedLocalSitePort = port;
    if (siteSettingsFailure) throw siteSettingsFailure;
    return { ...siteSettings, localSitePort: port, source: "saved" };
  },
  getProviderConnections: async () => connectionsResult,
  saveApiProvider: async (provider, apiKey) => {
    savedApiProvider = provider;
    savedApiKey = apiKey;
    if (saveShouldLeak) throw new Error(`vault rejected ${apiKey}`);
    return connectionFor(provider, {
      configured: true,
      ready: true,
      apiKey
    });
  },
  removeProvider: async (provider) => {
    removedProvider = provider;
    return connectionFor(provider, { configured: false, ready: false, secret: "hidden" });
  },
  setCliProviderEnabled: async (provider, enabled) => {
    configuredCli = { provider, enabled };
    return connectionFor(provider, { configured: enabled });
  },
  beginCliSignIn: async (provider) => {
    beganProvider = provider;
    return {
      status: "started",
      operationId: "signin-operation-1",
      guidance: "Complete the official provider flow."
    };
  },
  cancelCliSignIn: async (operationId) => {
    canceledOperation = operationId;
    return true;
  },
  openCliSignInTerminal: async (provider) => {
    openedTerminalProvider = provider;
    if (terminalShouldLeak) throw new Error("private terminal launcher diagnostic");
    return {
      status: "opened",
      guidance: longGuidance,
      command: "must-not-cross-ipc"
    };
  },
  openProviderInstallGuide: async (provider) => {
    openedInstallGuide = provider;
  },
  openBrowserApp: async () => {
    browserOpenCount += 1;
  }
};

const removeHandlers = installCompanionIpc(options);
assert.deepEqual([...installedHandlers.keys()].sort(), Object.values(channels).sort());
assert.throws(() => installCompanionIpc(options), /already installed/);

const handledRuntimeInfo = await installedHandlers.get(channels.runtime)(requestEvent());
assert.deepEqual(handledRuntimeInfo, runtimeInfo);
assert.notEqual(handledRuntimeInfo, runtimeInfo);
const handledSiteSettings = await installedHandlers.get(channels.settings)(requestEvent());
assert.deepEqual(handledSiteSettings, siteSettings);
assert.notEqual(handledSiteSettings, siteSettings);
assert.doesNotMatch(JSON.stringify(handledSiteSettings), /must-not-cross-ipc/);
const appliedSiteSettings = await installedHandlers.get(channels.applyPort)(requestEvent(), 5_191);
assert.equal(appliedLocalSitePort, 5_191);
assert.deepEqual(appliedSiteSettings, {
  ...siteSettings,
  localSitePort: 5_191,
  source: "saved"
});
const handledConnections = await installedHandlers.get(channels.providers)(requestEvent());
assert.deepEqual(handledConnections.map(({ id }) => id), providerIds);
assert.equal(handledConnections.length, 5);
assert.equal(handledConnections[0].guidance.length, ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH);
assert.deepEqual(
  Object.keys(handledConnections.find(({ id }) => id === "openai")).sort(),
  [
    "authState",
    "configured",
    "guidance",
    "id",
    "installed",
    "kind",
    "ready",
    "setupFlow",
    "signInRunning"
  ]
);
assert.doesNotMatch(JSON.stringify(handledConnections), /must-not-cross-ipc/);

const savedConnection = await installedHandlers.get(channels.saveApi)(
  requestEvent(),
  "openai",
  "  sk-test-private  "
);
assert.equal(savedApiProvider, "openai");
assert.equal(savedApiKey, "sk-test-private");
assert.equal(savedConnection.id, "openai");
assert.equal(savedConnection.configured, true);
assert.equal("apiKey" in savedConnection, false);
assert.doesNotMatch(JSON.stringify(savedConnection), /sk-test-private/);

assert.equal(
  (await installedHandlers.get(channels.remove)(requestEvent(), "anthropic")).id,
  "anthropic"
);
assert.equal(removedProvider, "anthropic");
assert.equal(
  "secret" in await installedHandlers.get(channels.remove)(requestEvent(), "openai"),
  false
);
assert.equal(
  (await installedHandlers.get(channels.configureCli)(requestEvent(), "claude-cli", true)).id,
  "claude-cli"
);
assert.deepEqual(configuredCli, { provider: "claude-cli", enabled: true });
assert.deepEqual(
  await installedHandlers.get(channels.begin)(requestEvent(), "claude-cli"),
  {
    status: "started",
    operationId: "signin-operation-1",
    guidance: "Complete the official provider flow."
  }
);
assert.equal(beganProvider, "claude-cli");
assert.equal(
  await installedHandlers.get(channels.cancel)(requestEvent(), "signin-operation-1"),
  true
);
assert.equal(canceledOperation, "signin-operation-1");
const terminalResult = await installedHandlers.get(channels.terminal)(
  requestEvent(),
  "antigravity-cli"
);
assert.equal(openedTerminalProvider, "antigravity-cli");
assert.deepEqual(Object.keys(terminalResult).sort(), ["guidance", "status"]);
assert.equal(terminalResult.status, "opened");
assert.equal(terminalResult.guidance.length, ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH);
assert.doesNotMatch(JSON.stringify(terminalResult), /must-not-cross-ipc/);
await installedHandlers.get(channels.installGuide)(requestEvent(), "antigravity-cli");
assert.equal(openedInstallGuide, "antigravity-cli");
await installedHandlers.get(channels.open)(requestEvent());
assert.equal(browserOpenCount, 1);

assert.throws(
  () => installedHandlers.get(channels.runtime)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
assert.throws(
  () => installedHandlers.get(channels.settings)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
assert.throws(
  () => installedHandlers.get(channels.settings)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent()),
  /requires one port/
);
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent(), 0),
  /integer from 1 through 65535/
);
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent(), 65_536),
  /integer from 1 through 65535/
);
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent(), "5191"),
  /integer from 1 through 65535/
);
const appliedPortBeforeUntrusted = appliedLocalSitePort;
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent({ senderId: 99 }), 5_192),
  /Untrusted/
);
assert.equal(appliedLocalSitePort, appliedPortBeforeUntrusted);
await assert.rejects(
  installedHandlers.get(channels.providers)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.saveApi)(requestEvent(), "claude-cli", "secret"),
  /Invalid API-provider/
);
await assert.rejects(
  installedHandlers.get(channels.saveApi)(requestEvent(), "openai", "   "),
  /Invalid API credential/
);
await assert.rejects(
  installedHandlers.get(channels.saveApi)(requestEvent(), "openai", "x".repeat(ROLEFIT_API_KEY_MAX_BYTES + 1)),
  /Invalid API credential/
);
await assert.rejects(
  installedHandlers.get(channels.saveApi)(requestEvent(), "openai", 42),
  /Invalid API credential/
);
await assert.rejects(
  installedHandlers.get(channels.remove)(requestEvent(), "shell"),
  /Invalid provider removal/
);
await assert.rejects(
  installedHandlers.get(channels.configureCli)(requestEvent(), "openai", true),
  /Invalid CLI-provider/
);
await assert.rejects(
  installedHandlers.get(channels.configureCli)(requestEvent(), "codex-cli", "yes"),
  /Invalid CLI-provider/
);
await assert.rejects(
  installedHandlers.get(channels.begin)(requestEvent(), "shell"),
  /Invalid CLI provider/
);
await assert.rejects(
  installedHandlers.get(channels.cancel)(requestEvent(), "short"),
  /Invalid CLI sign-in operation/
);
await assert.rejects(
  installedHandlers.get(channels.terminal)(requestEvent(), "openai"),
  /Invalid CLI provider/
);
await assert.rejects(
  installedHandlers.get(channels.terminal)(requestEvent(), "codex-cli", "codex login"),
  /Invalid CLI provider/
);
await assert.rejects(
  installedHandlers.get(channels.installGuide)(requestEvent(), "openai"),
  /Invalid CLI provider/
);
await assert.rejects(
  installedHandlers.get(channels.open)(requestEvent(), "extra"),
  /does not accept arguments/
);
const saveCallsBeforeUntrusted = savedApiKey;
await assert.rejects(
  installedHandlers.get(channels.saveApi)(
    requestEvent({ senderId: 99 }),
    "openai",
    "untrusted-secret"
  ),
  /Untrusted/
);
assert.equal(savedApiKey, saveCallsBeforeUntrusted);
const terminalCallsBeforeUntrusted = openedTerminalProvider;
await assert.rejects(
  installedHandlers.get(channels.terminal)(
    requestEvent({ senderId: 99 }),
    "claude-cli"
  ),
  /Untrusted/
);
assert.equal(openedTerminalProvider, terminalCallsBeforeUntrusted);

saveShouldLeak = true;
const leakingSecret = "sk-never-echo-this";
let sanitizedError = null;
try {
  await installedHandlers.get(channels.saveApi)(requestEvent(), "anthropic", leakingSecret);
} catch (error) {
  sanitizedError = error;
}
assert.ok(sanitizedError instanceof Error);
assert.match(sanitizedError.message, /Unable to save API provider/);
assert.doesNotMatch(sanitizedError.message, new RegExp(leakingSecret));
saveShouldLeak = false;

terminalShouldLeak = true;
let sanitizedTerminalError = null;
try {
  await installedHandlers.get(channels.terminal)(requestEvent(), "codex-cli");
} catch (error) {
  sanitizedTerminalError = error;
}
assert.ok(sanitizedTerminalError instanceof Error);
assert.match(sanitizedTerminalError.message, /Unable to open CLI sign-in in a terminal/);
assert.doesNotMatch(sanitizedTerminalError.message, /private terminal launcher diagnostic/);
terminalShouldLeak = false;

siteSettingsFailure = Object.assign(new Error("private port-probe detail"), {
  code: "ROLEFIT_DESKTOP_PORT_UNAVAILABLE"
});
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent(), 5_193),
  /already in use/
);
siteSettingsFailure = Object.assign(new Error("private environment detail"), {
  code: "ROLEFIT_DESKTOP_SETTINGS_LOCKED"
});
await assert.rejects(
  installedHandlers.get(channels.applyPort)(requestEvent(), 5_194),
  /ROLEFIT_DESKTOP_PORT controls this setting/
);
siteSettingsFailure = new Error("private settings path must not cross IPC");
let sanitizedSettingsError = null;
try {
  await installedHandlers.get(channels.applyPort)(requestEvent(), 5_195);
} catch (error) {
  sanitizedSettingsError = error;
}
assert.ok(sanitizedSettingsError instanceof Error);
assert.match(sanitizedSettingsError.message, /could not be saved/);
assert.doesNotMatch(sanitizedSettingsError.message, /private settings path/);
siteSettingsFailure = null;

connectionsResult = providerConnections.slice(0, 4);
await assert.rejects(
  installedHandlers.get(channels.providers)(requestEvent()),
  /Invalid provider connection list/
);
connectionsResult = [
  providerConnections[0],
  providerConnections[0],
  ...providerConnections.slice(2)
];
await assert.rejects(
  installedHandlers.get(channels.providers)(requestEvent()),
  /Invalid provider connection list/
);
connectionsResult = [...providerConnections].reverse();

removeHandlers();
removeHandlers();
assert.equal(installedHandlers.size, 0);
assert.deepEqual([...new Set(removedChannels)].sort(), Object.values(channels).sort());

const removeReinstalledHandlers = installCompanionIpc(options);
removeReinstalledHandlers();

const appRoot = resolve(import.meta.dirname, "../..");
const preload = await readFile(resolve(appRoot, "dist-electron/desktop/preload.cjs"), "utf8");
const preloadSource = await readFile(resolve(appRoot, "desktop/preload.cts"), "utf8");
const requiredModules = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)]
  .map((match) => match[1]);
assert.deepEqual([...new Set(requiredModules)], ["electron"]);
assert.doesNotMatch(preload, /require\(["']\.\.?\//);
assert.doesNotMatch(preload, /ipcRenderer\.(?:send|sendSync|on|once|postMessage)/);
assert.match(preload, /Object\.freeze/);
for (const channel of Object.values(channels)) assert.match(preload, new RegExp(channel));
assert.match(preload, new RegExp(bridgeKey));
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetRuntimeInfo/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetLocalSiteSettings/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.ApplyLocalSitePort/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetProviderConnections/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.SaveApiProvider/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.RemoveProvider/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.SetCliProviderEnabled/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.BeginCliSignIn/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.CancelCliSignIn/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenCliSignInTerminal/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenProviderInstallGuide/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenBrowserApp/);
for (const channel of Object.values(channels)) assert.doesNotMatch(preloadSource, new RegExp(channel));

let exposedKey = null;
let exposedApi = null;
const invocations = [];
vm.runInNewContext(preload, {
  exports: {},
  require(moduleName) {
    assert.equal(moduleName, "electron");
    return {
      contextBridge: {
        exposeInMainWorld(key, api) {
          exposedKey = key;
          exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke(channel, ...args) {
          invocations.push({ channel, args });
          if (channel === channels.runtime) return Promise.resolve(runtimeInfo);
          if (channel === channels.settings || channel === channels.applyPort) {
            return Promise.resolve(siteSettings);
          }
          if (channel === channels.providers) return Promise.resolve(providerConnections);
          if (channel === channels.saveApi ||
              channel === channels.remove ||
              channel === channels.configureCli) {
            return Promise.resolve(providerConnections[0]);
          }
          if (channel === channels.begin) {
            return Promise.resolve({
              status: "started",
              operationId: "signin-operation-1",
              guidance: "Continue."
            });
          }
          if (channel === channels.cancel) return Promise.resolve(true);
          return Promise.resolve(undefined);
        }
      }
    };
  }
});
assert.equal(exposedKey, bridgeKey);
assert.deepEqual(
  Object.keys(exposedApi).sort(),
  [
    "applyLocalSitePort",
    "beginCliSignIn",
    "cancelCliSignIn",
    "getLocalSiteSettings",
    "getProviderConnections",
    "getRuntimeInfo",
    "openBrowserApp",
    "openCliSignInTerminal",
    "openProviderInstallGuide",
    "removeProvider",
    "saveApiProvider",
    "setCliProviderEnabled"
  ]
);
assert.equal(Object.isFrozen(exposedApi), true);
assert.equal("invoke" in exposedApi, false);
assert.equal("send" in exposedApi, false);
assert.equal("on" in exposedApi, false);
await exposedApi.getRuntimeInfo();
await exposedApi.getLocalSiteSettings();
await exposedApi.applyLocalSitePort(5_191);
await exposedApi.getProviderConnections();
await exposedApi.saveApiProvider("openai", "sk-private");
await exposedApi.removeProvider("anthropic");
await exposedApi.setCliProviderEnabled("codex-cli", true);
await exposedApi.beginCliSignIn("claude-cli");
await exposedApi.cancelCliSignIn("signin-operation-1");
await exposedApi.openCliSignInTerminal("codex-cli");
await exposedApi.openProviderInstallGuide("antigravity-cli");
await exposedApi.openBrowserApp();
assert.deepEqual(invocations, [
  { channel: channels.runtime, args: [] },
  { channel: channels.settings, args: [] },
  { channel: channels.applyPort, args: [5_191] },
  { channel: channels.providers, args: [] },
  { channel: channels.saveApi, args: ["openai", "sk-private"] },
  { channel: channels.remove, args: ["anthropic"] },
  { channel: channels.configureCli, args: ["codex-cli", true] },
  { channel: channels.begin, args: ["claude-cli"] },
  { channel: channels.cancel, args: ["signin-operation-1"] },
  { channel: channels.terminal, args: ["codex-cli"] },
  { channel: channels.installGuide, args: ["antigravity-cli"] },
  { channel: channels.open, args: [] }
]);

console.log("desktop provider-management IPC contract and preload probes: passed");
