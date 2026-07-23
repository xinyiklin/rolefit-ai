import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  ROLEFIT_API_KEY_MAX_BYTES,
  ROLEFIT_DESKTOP_API_VERSION,
  ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
  ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT,
  ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH,
  ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES,
  ROLEFIT_WORKSPACE_BASE_RESUME_RE,
  ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE,
  ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH,
  ROLEFIT_WORKSPACE_STAT_FILE_MAX_BYTES,
  createRoleFitDesktopRuntimeInfo,
  isRoleFitApiProviderId,
  isRoleFitCliProviderId,
  isRoleFitConnectionServerState,
  isRoleFitProviderId,
  isRoleFitWorkspaceBackupFileName,
  normalizeRoleFitExtensionOrigin,
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
  extensionSettings: "rolefit:companion:get-extension-pairing-settings",
  saveExtension: "rolefit:companion:save-extension-origin",
  removeExtension: "rolefit:companion:remove-extension-origin",
  providers: "rolefit:companion:get-provider-connections",
  saveApi: "rolefit:companion:save-api-provider",
  remove: "rolefit:companion:remove-provider",
  configureCli: "rolefit:companion:set-cli-provider-enabled",
  terminal: "rolefit:companion:open-cli-sign-in-terminal",
  installGuide: "rolefit:companion:open-provider-install-guide",
  extensionDirectory: "rolefit:companion:open-extension-directory",
  open: "rolefit:companion:open-browser-app",
  workspaceOverview: "rolefit:companion:get-workspace-overview",
  workspaceBackup: "rolefit:companion:backup-workspace-to-file",
  workspaceRestore: "rolefit:companion:restore-workspace-from-file",
  workspaceFolder: "rolefit:companion:open-workspace-folder",
  connectionStatus: "rolefit:companion:get-connection-status"
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
const firefoxOrigin = "moz-extension://b933a57d-2237-411b-b6db-5ea8fca14731";
const extensionPairingSettings = Object.freeze({
  schemaVersion: 1,
  origins: Object.freeze([firefoxOrigin]),
  pendingOrigins: Object.freeze([])
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
    guidance: "Add an Anthropic API key."
  })
]);

assert.equal(ROLEFIT_DESKTOP_API_VERSION, 10);
assert.equal(ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION, 1);
assert.equal(ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT, 4);
assert.equal(ROLEFIT_API_KEY_MAX_BYTES, 16_384);
assert.equal(ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH, 240);
// The desktop project cannot import app src modules, so its byte-limit and
// managed-naming mirrors must stay in lockstep with the shared
// workspace-backup contract source.
const workspaceContractSource = await readFile(
  resolve(import.meta.dirname, "../../src/lib/workspaceBackupContract.ts"),
  "utf8"
);
const sharedJsonLimit = workspaceContractSource
  .match(/MAX_WORKSPACE_BACKUP_JSON_BYTES = ([\d_]+)/)?.[1];
assert.equal(Number(sharedJsonLimit?.replaceAll("_", "")), ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES);
const sharedFileLimit = workspaceContractSource
  .match(/MAX_WORKSPACE_BACKUP_FILE_BYTES = ([\d_]+)/)?.[1];
assert.equal(Number(sharedFileLimit?.replaceAll("_", "")), ROLEFIT_WORKSPACE_STAT_FILE_MAX_BYTES);
assert.ok(workspaceContractSource.includes(ROLEFIT_WORKSPACE_BASE_RESUME_RE.source));
assert.ok(workspaceContractSource.includes(ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE.source));
assert.equal(ROLEFIT_WORKSPACE_BASE_RESUME_RE.test("base-resume-swe_2.resume"), true);
assert.equal(ROLEFIT_WORKSPACE_BASE_RESUME_RE.test("base-resume.txt"), false);
assert.equal(ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE.test("base-resume.txt"), true);
assert.equal(isRoleFitConnectionServerState("owned"), true);
assert.equal(isRoleFitConnectionServerState("reused"), true);
assert.equal(isRoleFitConnectionServerState("starting"), true);
assert.equal(isRoleFitConnectionServerState("unreachable"), true);
assert.equal(isRoleFitConnectionServerState("stopped"), false);
assert.equal(isRoleFitWorkspaceBackupFileName("RoleFit-Workspace-2026-07-20.rolefit-backup"), true);
assert.equal(isRoleFitWorkspaceBackupFileName("my backup (2).rolefit-backup"), true);
assert.equal(isRoleFitWorkspaceBackupFileName("../escape.rolefit-backup"), false);
assert.equal(isRoleFitWorkspaceBackupFileName("nested/name.rolefit-backup"), false);
assert.equal(isRoleFitWorkspaceBackupFileName("windows\\name.rolefit-backup"), false);
assert.equal(isRoleFitWorkspaceBackupFileName("C:drive.rolefit-backup"), false);
assert.equal(isRoleFitWorkspaceBackupFileName(".hidden.rolefit-backup"), false);
assert.equal(isRoleFitWorkspaceBackupFileName("plain.json"), false);
assert.equal(isRoleFitWorkspaceBackupFileName(`${"n".repeat(300)}.rolefit-backup`), false);
assert.equal(normalizeRoleFitDesktopPlatform("darwin"), "darwin");
assert.equal(normalizeRoleFitDesktopPlatform("freebsd"), "other");
assert.equal(isRoleFitCliProviderId("claude-cli"), true);
assert.equal(isRoleFitCliProviderId("openai"), false);
assert.equal(isRoleFitApiProviderId("openai"), true);
assert.equal(isRoleFitApiProviderId("claude-cli"), false);
assert.equal(isRoleFitProviderId("anthropic"), true);
assert.equal(isRoleFitProviderId("shell"), false);
assert.equal(normalizeRoleFitExtensionOrigin(`${firefoxOrigin}/`), firefoxOrigin);
assert.equal(normalizeRoleFitExtensionOrigin("https://example.com"), "");
assert.deepEqual(runtimeInfo, {
  apiVersion: 10,
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
let openedTerminalProvider = null;
let openedInstallGuide = null;
let extensionDirectoryOpens = 0;
let browserOpenCount = 0;
let appliedLocalSitePort = null;
let savedExtensionOrigin = null;
let removedExtensionOrigin = null;
let extensionPairingFailure = null;
let siteSettingsFailure = null;
let saveShouldLeak = false;
let terminalShouldLeak = false;
let workspaceOverviewResult = {
  workspacePath: "/private/rolefit/workspaces/job-search-workspace",
  workspaceDisplayPath: "~/workspaces/job-search-workspace",
  activeBrowserTabs: 0,
  serverReady: true,
  workspaceTransferReady: true,
  hasBaseResume: true,
  applicationCount: 12,
  stagingDir: "/must-not-cross-ipc"
};
let connectionStatusResult = {
  port: 5_181,
  siteUrl: "http://localhost:5181",
  serverState: "owned",
  activeBrowserTabs: 2,
  serverPid: "must-not-cross-ipc"
};
let workspaceBackupResult = {
  status: "saved",
  filePath: "RoleFit-Workspace-2026-07-20.rolefit-backup",
  fileCount: 4,
  includesPreferences: true,
  absolutePath: "/must-not-cross-ipc"
};
let workspaceRestoreResult = {
  status: "restored",
  restoredFiles: 4,
  previousWorkspaceKept: true,
  previousDir: "/must-not-cross-ipc"
};
let workspaceFolderOpens = 0;
let workspaceFolderFailure = null;

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
  getExtensionPairingSettings: () => ({
    ...extensionPairingSettings,
    workspaceDir: "/must-not-cross-ipc"
  }),
  saveExtensionOrigin: async (origin) => {
    savedExtensionOrigin = origin;
    if (extensionPairingFailure) throw extensionPairingFailure;
    return extensionPairingSettings;
  },
  removeExtensionOrigin: async (origin) => {
    removedExtensionOrigin = origin;
    if (extensionPairingFailure) throw extensionPairingFailure;
    return { schemaVersion: 1, origins: [], pendingOrigins: [] };
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
  openExtensionDirectory: async () => {
    extensionDirectoryOpens += 1;
  },
  openBrowserApp: async () => {
    browserOpenCount += 1;
  },
  getWorkspaceOverview: async () => workspaceOverviewResult,
  backupWorkspaceToFile: async () => workspaceBackupResult,
  restoreWorkspaceFromFile: async () => workspaceRestoreResult,
  openWorkspaceFolder: async () => {
    workspaceFolderOpens += 1;
    if (workspaceFolderFailure) throw workspaceFolderFailure;
  },
  getConnectionStatus: async () => connectionStatusResult
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
const handledExtensionSettings = await installedHandlers.get(channels.extensionSettings)(requestEvent());
assert.deepEqual(handledExtensionSettings, extensionPairingSettings);
assert.notEqual(handledExtensionSettings, extensionPairingSettings);
assert.doesNotMatch(JSON.stringify(handledExtensionSettings), /workspace/);
assert.deepEqual(
  await installedHandlers.get(channels.saveExtension)(requestEvent(), `${firefoxOrigin}/`),
  extensionPairingSettings
);
assert.equal(savedExtensionOrigin, firefoxOrigin);
assert.deepEqual(
  await installedHandlers.get(channels.removeExtension)(requestEvent(), firefoxOrigin),
  { schemaVersion: 1, origins: [], pendingOrigins: [] }
);
assert.equal(removedExtensionOrigin, firefoxOrigin);
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
    "setupFlow"
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
await installedHandlers.get(channels.extensionDirectory)(requestEvent());
assert.equal(extensionDirectoryOpens, 1);
await installedHandlers.get(channels.open)(requestEvent());
assert.equal(browserOpenCount, 1);

const handledWorkspaceOverview = await installedHandlers.get(channels.workspaceOverview)(requestEvent());
assert.deepEqual(handledWorkspaceOverview, {
  workspacePath: "/private/rolefit/workspaces/job-search-workspace",
  workspaceDisplayPath: "~/workspaces/job-search-workspace",
  activeBrowserTabs: 0,
  serverReady: true,
  workspaceTransferReady: true,
  hasBaseResume: true,
  applicationCount: 12
});
assert.notEqual(handledWorkspaceOverview, workspaceOverviewResult);
assert.doesNotMatch(JSON.stringify(handledWorkspaceOverview), /must-not-cross-ipc/);
workspaceOverviewResult = { ...workspaceOverviewResult, activeBrowserTabs: null, applicationCount: null };
const handledNullOverview = await installedHandlers.get(channels.workspaceOverview)(requestEvent());
assert.equal(handledNullOverview.activeBrowserTabs, null);
assert.equal(handledNullOverview.applicationCount, null);
workspaceOverviewResult = { ...workspaceOverviewResult, activeBrowserTabs: -1 };
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent()),
  /workspace overview is unavailable/
);
workspaceOverviewResult = { ...workspaceOverviewResult, activeBrowserTabs: 2, workspacePath: "" };
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent()),
  /workspace overview is unavailable/
);
workspaceOverviewResult = { ...workspaceOverviewResult, workspacePath: "/private/rolefit/workspaces/job-search-workspace", applicationCount: 1.5 };
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent()),
  /workspace overview is unavailable/
);
workspaceOverviewResult = { ...workspaceOverviewResult, applicationCount: 12, hasBaseResume: "yes" };
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent()),
  /workspace overview is unavailable/
);
workspaceOverviewResult = {
  workspacePath: "/private/rolefit/workspaces/job-search-workspace",
  workspaceDisplayPath: "~/workspaces/job-search-workspace",
  activeBrowserTabs: 2,
  serverReady: true,
  workspaceTransferReady: true,
  hasBaseResume: true,
  applicationCount: 12
};

const handledConnectionStatus = await installedHandlers.get(channels.connectionStatus)(requestEvent());
assert.deepEqual(handledConnectionStatus, {
  port: 5_181,
  siteUrl: "http://localhost:5181",
  serverState: "owned",
  activeBrowserTabs: 2
});
assert.notEqual(handledConnectionStatus, connectionStatusResult);
assert.doesNotMatch(JSON.stringify(handledConnectionStatus), /must-not-cross-ipc/);
connectionStatusResult = { ...connectionStatusResult, serverState: "unreachable", activeBrowserTabs: null };
const handledUnreachableStatus = await installedHandlers.get(channels.connectionStatus)(requestEvent());
assert.equal(handledUnreachableStatus.serverState, "unreachable");
assert.equal(handledUnreachableStatus.activeBrowserTabs, null);
connectionStatusResult = { ...connectionStatusResult, serverState: "stopped" };
await assert.rejects(
  installedHandlers.get(channels.connectionStatus)(requestEvent()),
  /connection status is unavailable/
);
connectionStatusResult = { ...connectionStatusResult, serverState: "owned", siteUrl: "https://example.com" };
await assert.rejects(
  installedHandlers.get(channels.connectionStatus)(requestEvent()),
  /connection status is unavailable/
);
connectionStatusResult = { ...connectionStatusResult, siteUrl: "http://localhost:5181", port: 0 };
await assert.rejects(
  installedHandlers.get(channels.connectionStatus)(requestEvent()),
  /connection status is unavailable/
);
connectionStatusResult = {
  port: 5_181,
  siteUrl: "http://localhost:5181",
  serverState: "owned",
  activeBrowserTabs: 2
};

const handledBackup = await installedHandlers.get(channels.workspaceBackup)(requestEvent());
assert.deepEqual(handledBackup, {
  status: "saved",
  filePath: "RoleFit-Workspace-2026-07-20.rolefit-backup",
  fileCount: 4,
  includesPreferences: true
});
assert.doesNotMatch(JSON.stringify(handledBackup), /must-not-cross-ipc/);
workspaceBackupResult = { status: "cancelled", ignored: "extra" };
assert.deepEqual(
  await installedHandlers.get(channels.workspaceBackup)(requestEvent()),
  { status: "cancelled" }
);
workspaceBackupResult = {
  status: "error",
  message: `  private\n${"m".repeat(ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH + 40)}  `
};
const backupError = await installedHandlers.get(channels.workspaceBackup)(requestEvent());
assert.equal(backupError.status, "error");
assert.equal(backupError.message.length, ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH);
assert.doesNotMatch(backupError.message, /\n/);
workspaceBackupResult = {
  status: "saved",
  filePath: "/Users/private/RoleFit-Workspace-2026-07-20.rolefit-backup",
  fileCount: 4,
  includesPreferences: false
};
await assert.rejects(
  installedHandlers.get(channels.workspaceBackup)(requestEvent()),
  /workspace backup did not complete/
);
try {
  await installedHandlers.get(channels.workspaceBackup)(requestEvent());
  assert.fail("An absolute backup path crossed IPC.");
} catch (error) {
  assert.doesNotMatch(error.message, /Users\/private/);
}
workspaceBackupResult = { status: "saved", filePath: "ok.rolefit-backup", fileCount: -1, includesPreferences: false };
await assert.rejects(
  installedHandlers.get(channels.workspaceBackup)(requestEvent()),
  /workspace backup did not complete/
);
workspaceBackupResult = {
  status: "saved",
  filePath: "RoleFit-Workspace-2026-07-20.rolefit-backup",
  fileCount: 4,
  includesPreferences: true
};

const handledRestore = await installedHandlers.get(channels.workspaceRestore)(requestEvent());
assert.deepEqual(handledRestore, {
  status: "restored",
  restoredFiles: 4,
  previousWorkspaceKept: true
});
assert.doesNotMatch(JSON.stringify(handledRestore), /must-not-cross-ipc/);
workspaceRestoreResult = { status: "cancelled" };
assert.deepEqual(
  await installedHandlers.get(channels.workspaceRestore)(requestEvent()),
  { status: "cancelled" }
);
workspaceRestoreResult = {
  status: "error",
  message: "Close the RoleFit browser tabs before restoring, then try again."
};
assert.deepEqual(
  await installedHandlers.get(channels.workspaceRestore)(requestEvent()),
  workspaceRestoreResult
);
workspaceRestoreResult = { status: "restored", restoredFiles: 1.5, previousWorkspaceKept: false };
await assert.rejects(
  installedHandlers.get(channels.workspaceRestore)(requestEvent()),
  /workspace restore did not complete/
);
workspaceRestoreResult = { status: "error", message: "   " };
await assert.rejects(
  installedHandlers.get(channels.workspaceRestore)(requestEvent()),
  /workspace restore did not complete/
);
workspaceRestoreResult = { status: "restored", restoredFiles: 4, previousWorkspaceKept: true };

await installedHandlers.get(channels.workspaceFolder)(requestEvent());
assert.equal(workspaceFolderOpens, 1);
workspaceFolderFailure = new Error("ENOENT: /private/workspace/path leaked");
try {
  await installedHandlers.get(channels.workspaceFolder)(requestEvent());
  assert.fail("A failing workspace-folder open did not reject.");
} catch (error) {
  assert.match(error.message, /workspace folder could not be opened/);
  assert.doesNotMatch(error.message, /private\/workspace\/path/);
}
workspaceFolderFailure = null;

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
  installedHandlers.get(channels.extensionSettings)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.saveExtension)(requestEvent(), "https://example.com"),
  /Invalid browser-extension origin/
);
await assert.rejects(
  installedHandlers.get(channels.removeExtension)(requestEvent(), "moz-extension://not-a-uuid"),
  /Invalid browser-extension origin/
);
const extensionOriginBeforeUntrusted = savedExtensionOrigin;
await assert.rejects(
  installedHandlers.get(channels.saveExtension)(requestEvent({ senderId: 99 }), firefoxOrigin),
  /Untrusted/
);
assert.equal(savedExtensionOrigin, extensionOriginBeforeUntrusted);
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
  installedHandlers.get(channels.extensionDirectory)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.open)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceBackup)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceRestore)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceFolder)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.connectionStatus)(requestEvent(), "extra"),
  /does not accept arguments/
);
await assert.rejects(
  installedHandlers.get(channels.connectionStatus)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
const workspaceFolderOpensBeforeUntrusted = workspaceFolderOpens;
await assert.rejects(
  installedHandlers.get(channels.workspaceBackup)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceRestore)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceFolder)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
await assert.rejects(
  installedHandlers.get(channels.workspaceOverview)(requestEvent({ senderId: 99 })),
  /Untrusted/
);
assert.equal(workspaceFolderOpens, workspaceFolderOpensBeforeUntrusted);
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

extensionPairingFailure = new Error("private settings path must not cross IPC");
let sanitizedPairingError = null;
try {
  await installedHandlers.get(channels.saveExtension)(requestEvent(), firefoxOrigin);
} catch (error) {
  sanitizedPairingError = error;
}
assert.ok(sanitizedPairingError instanceof Error);
assert.match(sanitizedPairingError.message, /could not be saved/);
assert.doesNotMatch(sanitizedPairingError.message, /private settings path/);
extensionPairingFailure = new Error("Browser extension pairing requires local site port 5181.");
await assert.rejects(
  installedHandlers.get(channels.saveExtension)(requestEvent(), firefoxOrigin),
  /requires local site port 5181/
);
extensionPairingFailure = null;

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
const companionRendererSource = await readFile(
  resolve(appRoot, "desktop/companion-renderer.js"),
  "utf8"
);
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
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetExtensionPairingSettings/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.SaveExtensionOrigin/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.RemoveExtensionOrigin/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetProviderConnections/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.SaveApiProvider/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.RemoveProvider/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.SetCliProviderEnabled/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenCliSignInTerminal/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenProviderInstallGuide/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenExtensionDirectory/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenBrowserApp/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetWorkspaceOverview/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.BackupWorkspaceToFile/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.RestoreWorkspaceFromFile/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.OpenWorkspaceFolder/);
assert.match(preloadSource, /RoleFitDesktopIpcChannel\.GetConnectionStatus/);
for (const channel of Object.values(channels)) assert.doesNotMatch(preloadSource, new RegExp(channel));
assert.match(companionRendererSource, /PROVIDER_VISIBLE_POLL_INTERVAL_MS = 5_000/);
assert.match(
  companionRendererSource,
  /function schedulePoll\(\)[\s\S]*document\.visibilityState === "hidden"[\s\S]*PROVIDER_VISIBLE_POLL_INTERVAL_MS/,
  "the visible companion owns one bounded provider refresh timer at the normal cadence"
);
assert.match(
  companionRendererSource,
  /async function refreshProviders[\s\S]*window\.clearTimeout\(pollTimer\)[\s\S]*finally[\s\S]*schedulePoll\(\)/,
  "each provider refresh clears its predecessor and schedules one successor only after settling"
);
const renderProvidersSource = companionRendererSource.slice(
  companionRendererSource.indexOf("function renderProviders()"),
  companionRendererSource.indexOf("function renderCheckingProviders()")
);
assert.doesNotMatch(
  renderProvidersSource,
  /schedulePoll\(/,
  "ordinary renders cannot start a provider poll while an owning refresh is still running"
);
assert.match(
  companionRendererSource,
  /document\.addEventListener\("visibilitychange",[\s\S]*window\.clearTimeout\(pollTimer\)[\s\S]*refreshProviders/,
  "hidden windows stop renderer polling and refresh immediately when visible again"
);
assert.doesNotMatch(
  companionRendererSource,
  /if \(!needed \|\| !hasUsableBridge\(\)\) return/,
  "terminal and external auth changes are not stranded behind managed-sign-in-only polling"
);
assert.match(
  companionRendererSource,
  /"Sign in",\s*"terminal-sign-in"/,
  "every unavailable CLI uses the same terminal-owned Sign in action"
);
assert.doesNotMatch(
  companionRendererSource,
  /beginCliSignIn|cancelCliSignIn|Sign in in terminal/,
  "the renderer never exposes an in-app credential flow or inconsistent terminal label"
);

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
          if (channel === channels.extensionSettings ||
              channel === channels.saveExtension ||
              channel === channels.removeExtension) {
            return Promise.resolve(extensionPairingSettings);
          }
          if (channel === channels.providers) return Promise.resolve(providerConnections);
          if (channel === channels.saveApi ||
              channel === channels.remove ||
              channel === channels.configureCli) {
            return Promise.resolve(providerConnections[0]);
          }
          if (channel === channels.workspaceOverview) {
            return Promise.resolve({
              workspacePath: "/private/rolefit/workspaces/job-search-workspace",
              workspaceDisplayPath: "~/workspaces/job-search-workspace",
              activeBrowserTabs: 0,
              serverReady: true,
              workspaceTransferReady: true,
              hasBaseResume: true,
              applicationCount: 0
            });
          }
          if (channel === channels.workspaceBackup || channel === channels.workspaceRestore) {
            return Promise.resolve({ status: "cancelled" });
          }
          if (channel === channels.connectionStatus) {
            return Promise.resolve({
              port: 5_181,
              siteUrl: "http://localhost:5181",
              serverState: "owned",
              activeBrowserTabs: 0
            });
          }
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
    "backupWorkspaceToFile",
    "getConnectionStatus",
    "getExtensionPairingSettings",
    "getLocalSiteSettings",
    "getProviderConnections",
    "getRuntimeInfo",
    "getWorkspaceOverview",
    "openBrowserApp",
    "openCliSignInTerminal",
    "openExtensionDirectory",
    "openProviderInstallGuide",
    "openWorkspaceFolder",
    "removeExtensionOrigin",
    "removeProvider",
    "restoreWorkspaceFromFile",
    "saveApiProvider",
    "saveExtensionOrigin",
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
await exposedApi.getExtensionPairingSettings();
await exposedApi.saveExtensionOrigin(firefoxOrigin);
await exposedApi.removeExtensionOrigin(firefoxOrigin);
await exposedApi.getProviderConnections();
await exposedApi.saveApiProvider("openai", "sk-private");
await exposedApi.removeProvider("anthropic");
await exposedApi.setCliProviderEnabled("codex-cli", true);
await exposedApi.openCliSignInTerminal("codex-cli");
await exposedApi.openProviderInstallGuide("antigravity-cli");
await exposedApi.openExtensionDirectory();
await exposedApi.openBrowserApp();
await exposedApi.getWorkspaceOverview();
await exposedApi.backupWorkspaceToFile();
await exposedApi.restoreWorkspaceFromFile();
await exposedApi.openWorkspaceFolder();
await exposedApi.getConnectionStatus();
assert.deepEqual(invocations, [
  { channel: channels.runtime, args: [] },
  { channel: channels.settings, args: [] },
  { channel: channels.applyPort, args: [5_191] },
  { channel: channels.extensionSettings, args: [] },
  { channel: channels.saveExtension, args: [firefoxOrigin] },
  { channel: channels.removeExtension, args: [firefoxOrigin] },
  { channel: channels.providers, args: [] },
  { channel: channels.saveApi, args: ["openai", "sk-private"] },
  { channel: channels.remove, args: ["anthropic"] },
  { channel: channels.configureCli, args: ["codex-cli", true] },
  { channel: channels.terminal, args: ["codex-cli"] },
  { channel: channels.installGuide, args: ["antigravity-cli"] },
  { channel: channels.extensionDirectory, args: [] },
  { channel: channels.open, args: [] },
  { channel: channels.workspaceOverview, args: [] },
  { channel: channels.workspaceBackup, args: [] },
  { channel: channels.workspaceRestore, args: [] },
  { channel: channels.workspaceFolder, args: [] },
  { channel: channels.connectionStatus, args: [] }
]);

console.log("desktop provider-management and workspace IPC contract and preload probes: passed");
