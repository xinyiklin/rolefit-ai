import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, utilityProcess } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  startOrReuseDesktopServer,
  type DesktopServerHandle,
  type RoleFitServerOwnership
} from "./server-process.cjs";
import {
  buildCliProcessEnvironment,
  createCliProviderManager,
  packagedCliSearchPaths,
  type CliProviderManager
} from "./cli-providers.cjs";
import {
  createProviderVault,
  type ProviderVault,
  type ProviderVaultConfiguredState,
  type ProviderVaultCredentialSnapshot
} from "./provider-vault.cjs";
import { hardenWindow, installSessionSecurity } from "./security.cjs";
import {
  ROLEFIT_API_PROVIDER_IDS,
  ROLEFIT_CLI_PROVIDER_IDS,
  ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT,
  ROLEFIT_PROVIDER_IDS,
  createRoleFitDesktopRuntimeInfo,
  normalizeRoleFitExtensionOrigin,
  type RoleFitCliProviderStatus,
  type RoleFitDesktopRuntimeInfo,
  type RoleFitDesktopSiteSettings,
  type RoleFitExtensionPairingSettings,
  type RoleFitProviderConnection,
  type RoleFitProviderId
} from "./ipc-contract.cjs";
import { installCompanionIpc } from "./ipc.cjs";
import { resolveDesktopRuntimePaths } from "./runtime-paths.cjs";
import {
  createDesktopSettingsManager,
  probeLocalSitePortAvailability,
  type DesktopSettingsManager
} from "./desktop-settings.cjs";

const APP_NAME = "RoleFit Local Companion";
const DEFAULT_HOST = "127.0.0.1" as const;
const PROVIDER_SNAPSHOT_REFRESH_INTERVAL_MS = 5_000;

type DesktopMode = "development" | "production";

type SmokeResult = {
  rootRendered: boolean;
  companionReady: boolean;
  hasRequire: boolean;
  hasProcess: boolean;
  hasBuffer: boolean;
  hasDesktopBridge: boolean;
  bridgeFrozen: boolean;
  bridgeKeys: string[];
  runtimeInfo: unknown;
  runtimeInfoError: string | null;
  localSiteSettings: unknown;
  localSiteSettingsError: string | null;
  providerStatus: unknown;
  providerStatusError: string | null;
  providerMutationError: string | null;
  providerLandmarks: number;
  providerDescriptions: number;
  providerOrdinals: number;
  replayingProviderAnimations: number;
  descriptiveChromeAbsent: boolean;
  providerBackgroundRefreshes: number;
  sitePortForms: number;
  sitePortValue: string;
  sitePortLocked: boolean;
  sitePortLockReported: boolean;
  fullWorkspaceAbsent: boolean;
  correctTitle: boolean;
};

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId("com.squirrel.RoleFitLocalCompanion.RoleFitLocalCompanion");
}
if (process.env.ROLEFIT_DESKTOP_USER_DATA) {
  if (!isAbsolute(process.env.ROLEFIT_DESKTOP_USER_DATA)) {
    throw new Error("ROLEFIT_DESKTOP_USER_DATA must be an absolute path.");
  }
  app.setPath("userData", resolve(process.env.ROLEFIT_DESKTOP_USER_DATA));
}
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let desktopServer: DesktopServerHandle | null = null;
let cliProviderManager: CliProviderManager | null = null;
let providerVault: ProviderVault | null = null;
let desktopSettingsManager: DesktopSettingsManager | null = null;
let localSiteSettings: RoleFitDesktopSiteSettings | null = null;
let extensionPairingSettings: RoleFitExtensionPairingSettings | null = null;
let removeSessionSecurity: (() => void) | null = null;
let removeDesktopIpc: (() => void) | null = null;
let shuttingDown = false;
let rendererErrorCount = 0;
const rendererErrorSamples: string[] = [];
let activeMode: DesktopMode = "development";
let providerSnapshotQueue: Promise<void> = Promise.resolve();
let providerSnapshotRefreshTimer: NodeJS.Timeout | null = null;
let providerBackgroundRefreshes = 0;
let providerRefreshWarningActive = false;
let relaunchScheduled = false;

const PROVIDER_INSTALL_GUIDES = Object.freeze({
  "claude-cli": "https://code.claude.com/docs/en/getting-started",
  "codex-cli": "https://developers.openai.com/codex/cli/",
  "antigravity-cli": "https://antigravity.google/docs/cli-install"
} as const);

function getDesktopRuntimeInfo(): RoleFitDesktopRuntimeInfo {
  return createRoleFitDesktopRuntimeInfo(
    process.platform,
    app.getVersion(),
    process.versions.electron ?? ""
  );
}

function requireProviderVault(): ProviderVault {
  if (!providerVault) throw new Error("Provider storage is unavailable.");
  return providerVault;
}

function getLocalSiteSettings(): RoleFitDesktopSiteSettings {
  if (!localSiteSettings) throw new Error("Local site settings are unavailable.");
  return localSiteSettings;
}

async function getExtensionPairingSettings(): Promise<RoleFitExtensionPairingSettings> {
  if (!extensionPairingSettings) throw new Error("Extension pairing settings are unavailable.");
  if (!desktopServer || localSiteSettings?.localSitePort !== 5_181) {
    return extensionPairingSettings;
  }
  const response = await fetch(`${desktopServer.origin}/api/extension/pairing-requests`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(1_000)
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Extension pairing requests are unavailable.");
  }
  const body = await response.text();
  if (body.length > 4_096) throw new Error("Extension pairing response is too large.");
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid extension pairing response.");
  }
  const origins = (value as { origins?: unknown }).origins;
  if (!Array.isArray(origins) || origins.length > ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT) {
    throw new Error("Invalid extension pairing response.");
  }
  const pendingOrigins = origins.map(normalizeRoleFitExtensionOrigin);
  if (pendingOrigins.some((origin) => !origin) || new Set(pendingOrigins).size !== pendingOrigins.length) {
    throw new Error("Invalid extension pairing response.");
  }
  return Object.freeze({
    schemaVersion: extensionPairingSettings.schemaVersion,
    origins: extensionPairingSettings.origins,
    pendingOrigins: Object.freeze(pendingOrigins)
  });
}

function requireOwnedServerForProviderMutation(): void {
  if (desktopServer?.ownership !== "owned") {
    throw new Error(
      "Stop the standalone RoleFit server and reopen RoleFit through this companion before changing providers."
    );
  }
}

function requireOwnedServerForExtensionPairing(): void {
  if (desktopServer?.ownership !== "owned") {
    throw new Error(
      "Stop the standalone RoleFit server and reopen RoleFit through this companion before pairing the browser extension."
    );
  }
}

function configuredProviderIds(state: ProviderVaultConfiguredState): Set<RoleFitProviderId> {
  return new Set(
    state.providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.id)
  );
}

function apiProviderConnection(
  id: "openai" | "anthropic",
  configured: boolean,
  decryptable: boolean,
  managedServer: boolean
): RoleFitProviderConnection {
  const label = id === "openai" ? "OpenAI" : "Claude";
  const ready = configured && decryptable && managedServer;
  return Object.freeze({
    id,
    kind: "api",
    configured,
    ready,
    installed: null,
    authState: "not-applicable",
    setupFlow: "api-key",
    signInRunning: false,
    guidance: configured
      ? ready
        ? `${label} API access is stored securely on this device.`
        : !managedServer
          ? `Restart the standalone RoleFit server through this companion to use its saved ${label} credential.`
          : `${label} API access is saved, but the operating-system credential store could not unlock it.`
      : `Add a ${label} API key to use this provider in RoleFit.`
  });
}

function cliProviderConnection(
  status: RoleFitCliProviderStatus,
  configured: boolean,
  managedServer: boolean
): RoleFitProviderConnection {
  const setupFlow = status.signInFlow === "managed" ? "managed-login" : "manual-login";
  // Antigravity 1.1.x has no side-effect-free, non-interactive auth-status
  // command. Do not turn that missing API into a permanent false negative:
  // configured + installed makes the manual provider eligible for a real
  // request, while authState remains truthfully unknown until `agy` itself
  // accepts or rejects the provider-owned keyring session.
  const authEligible = status.authState === "signed-in" ||
    (setupFlow === "manual-login" && status.authState === "unknown");
  const ready = configured && managedServer && status.installed && authEligible;
  let guidance = status.guidance;
  if (!configured) {
    guidance = status.installed
      ? `Add ${status.label} to RoleFit. Its provider-owned sign-in stays outside RoleFit.`
      : `Install ${status.label}, then add it to RoleFit.`;
  } else if (!managedServer) {
    guidance = `Restart the standalone RoleFit server through this companion to use ${status.label}.`;
  }
  return Object.freeze({
    id: status.id,
    kind: "cli",
    configured,
    ready,
    installed: status.installed,
    authState: status.authState,
    setupFlow,
    signInRunning: status.signInRunning,
    guidance
  });
}

type ProviderConnectionState = Readonly<{
  connections: readonly RoleFitProviderConnection[];
  credentials: ProviderVaultCredentialSnapshot;
}>;

async function readProviderConnectionState(): Promise<ProviderConnectionState> {
  if (!cliProviderManager) throw new Error("CLI provider manager is unavailable.");
  const vault = requireProviderVault();
  const [state, cliStatuses] = await Promise.all([
    vault.getConfiguredState(),
    cliProviderManager.getStatuses()
  ]);
  const configured = configuredProviderIds(state);
  const managedServer = desktopServer?.ownership === "owned";
  const configuredApiIds = ROLEFIT_API_PROVIDER_IDS.filter((id) => configured.has(id));
  const decryptableApiIds = new Set<RoleFitProviderId>();
  let credentials: ProviderVaultCredentialSnapshot = Object.freeze({});
  if (managedServer && configuredApiIds.length > 0) {
    try {
      credentials = await vault.decryptApiCredentialSnapshot();
      for (const id of configuredApiIds) {
        if (typeof credentials[id] === "string" && credentials[id]) decryptableApiIds.add(id);
      }
    } catch {
      // Keep shape-only configured state visible, but never claim an API
      // credential is ready when the OS credential store cannot unlock it.
    }
  }
  const cliById = new Map(cliStatuses.map((status) => [status.id, status]));
  const connections: RoleFitProviderConnection[] = [];
  for (const id of ROLEFIT_CLI_PROVIDER_IDS) {
    const status = cliById.get(id);
    if (!status) throw new Error("A CLI provider status is unavailable.");
    connections.push(cliProviderConnection(status, configured.has(id), managedServer));
  }
  for (const id of ROLEFIT_API_PROVIDER_IDS) {
    connections.push(apiProviderConnection(id, configured.has(id), decryptableApiIds.has(id), managedServer));
  }
  return Object.freeze({
    connections: Object.freeze(connections),
    credentials
  });
}

async function getProviderConnection(id: RoleFitProviderId): Promise<RoleFitProviderConnection> {
  const connection = (await readProviderConnectionState()).connections.find((candidate) => candidate.id === id);
  if (!connection) throw new Error("Provider connection status is unavailable.");
  return connection;
}

async function performProviderSnapshotSync(): Promise<readonly RoleFitProviderConnection[]> {
  const state = await readProviderConnectionState();
  if (desktopServer?.ownership !== "owned") return state.connections;
  const providers = state.connections
    .filter((connection) => connection.configured)
    .map((connection) => Object.freeze({
      id: connection.id,
      kind: connection.kind,
      configured: true as const,
      ready: connection.ready,
      authState: connection.authState,
      guidance: connection.guidance
    }));
  const delivered = desktopServer.updateProviderSnapshot(Object.freeze({
    type: "rolefit-provider-snapshot",
    schemaVersion: 1 as const,
    providers: Object.freeze(providers),
    credentials: state.credentials
  }));
  if (!delivered) throw new Error("The managed provider state could not reach the local server.");
  return state.connections;
}

function synchronizeProviderSnapshot(): Promise<readonly RoleFitProviderConnection[]> {
  // Serialize vault reads, CLI probes, and owned-server updates. A provider
  // mutation queued behind a background refresh must publish the post-mutation
  // state rather than joining an older in-flight snapshot.
  const request = providerSnapshotQueue.then(
    performProviderSnapshotSync,
    performProviderSnapshotSync
  );
  providerSnapshotQueue = request.then(() => undefined, () => undefined);
  return request;
}

function stopProviderSnapshotRefreshLoop(): void {
  if (providerSnapshotRefreshTimer) clearTimeout(providerSnapshotRefreshTimer);
  providerSnapshotRefreshTimer = null;
}

function startProviderSnapshotRefreshLoop(): void {
  stopProviderSnapshotRefreshLoop();
  const schedule = (): void => {
    if (shuttingDown || !cliProviderManager || desktopServer?.ownership !== "owned") return;
    providerSnapshotRefreshTimer = setTimeout(() => {
      providerSnapshotRefreshTimer = null;
      // The visible companion already polls through typed IPC for its status
      // cards. Main owns the fallback refresh only while that renderer is
      // hidden or closed, keeping the browser/server snapshot current without
      // doubling every CLI probe during normal setup use.
      if (mainWindow?.isVisible() && process.env.ROLEFIT_DESKTOP_SMOKE !== "companion") {
        schedule();
        return;
      }
      void synchronizeProviderSnapshot()
        .then(() => {
          providerBackgroundRefreshes += 1;
          if (providerRefreshWarningActive) {
            providerRefreshWarningActive = false;
            console.info("[companion] Provider status refresh recovered.");
          }
        })
        .catch(() => {
          if (!providerRefreshWarningActive) {
            providerRefreshWarningActive = true;
            console.error("[companion] Provider status could not be refreshed; the previous shape-only snapshot remains active.");
          }
        })
        .finally(schedule);
    }, PROVIDER_SNAPSHOT_REFRESH_INTERVAL_MS);
    providerSnapshotRefreshTimer.unref?.();
  };
  schedule();
}

async function getProviderConnections(): Promise<readonly RoleFitProviderConnection[]> {
  return synchronizeProviderSnapshot();
}

function runtimeInfoMatches(value: unknown, expected: RoleFitDesktopRuntimeInfo): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const info = value as Record<string, unknown>;
  return info.apiVersion === expected.apiVersion &&
    info.runtime === expected.runtime &&
    info.platform === expected.platform &&
    info.appVersion === expected.appVersion &&
    info.electronVersion === expected.electronVersion &&
    Object.keys(info).length === 5;
}

function siteSettingsMatch(
  value: unknown,
  expectedPort: number,
  expectedLocked: boolean
): value is RoleFitDesktopSiteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return settings.schemaVersion === 1 &&
    settings.localSitePort === expectedPort &&
    (expectedLocked
      ? settings.source === "environment"
      : settings.source !== "environment") &&
    (settings.source === "default" || settings.source === "saved" || settings.source === "environment") &&
    settings.locked === expectedLocked &&
    (settings.warning === null ||
      settings.warning === "saved-settings-invalid" ||
      settings.warning === "saved-settings-unreadable") &&
    Object.keys(settings).length === 5;
}

function providerStatusesMatch(value: unknown): value is readonly RoleFitProviderConnection[] {
  if (!Array.isArray(value) || value.length !== 5) return false;
  const expectedIds = [...ROLEFIT_PROVIDER_IDS].sort();
  const ids = value.map((item) => item && typeof item === "object"
    ? String((item as Record<string, unknown>).id ?? "")
    : "").sort();
  return ids.every((id, index) => id === expectedIds[index]) && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const status = item as Record<string, unknown>;
    return (status.kind === "cli" || status.kind === "api") &&
      typeof status.configured === "boolean" &&
      typeof status.ready === "boolean" &&
      (typeof status.installed === "boolean" || status.installed === null) &&
      (status.authState === "signed-in" || status.authState === "signed-out" || status.authState === "unknown" || status.authState === "not-applicable") &&
      (status.setupFlow === "managed-login" || status.setupFlow === "manual-login" || status.setupFlow === "api-key") &&
      typeof status.signInRunning === "boolean" &&
      typeof status.guidance === "string" &&
      Object.keys(status).length === 9;
  });
}

function providerPayloadMatches(value: unknown, ownership: RoleFitServerOwnership): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.providers) || Object.keys(payload).length !== 3) {
    return false;
  }
  if (ownership === "reused") {
    return payload.companionManaged === false && payload.providers.length === 0;
  }
  if (payload.companionManaged !== true || payload.providers.length !== 1) return false;
  const provider = payload.providers[0];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) return false;
  const connection = provider as Record<string, unknown>;
  return connection.id === "antigravity-cli" &&
    connection.kind === "cli" &&
    connection.configured === true &&
    connection.ready === true &&
    connection.authState === "unknown" &&
    typeof connection.guidance === "string" &&
    Object.keys(connection).length === 6;
}

function readDesktopMode(): DesktopMode {
  const argument = process.argv.find((value) => value.startsWith("--rolefit-mode="));
  const rawMode = process.env.ROLEFIT_DESKTOP_MODE ?? argument?.split("=", 2)[1] ?? "development";
  if (rawMode !== "development" && rawMode !== "production") {
    throw new Error("ROLEFIT_DESKTOP_MODE must be development or production.");
  }
  return rawMode;
}

function canonicalBrowserOrigin(serverOrigin: string): string {
  const url = new URL(serverOrigin);
  url.hostname = "localhost";
  return url.origin;
}

function scheduleDesktopRelaunch(): void {
  if (relaunchScheduled) return;
  relaunchScheduled = true;
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 250);
}

function bringWindowForward(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function inspectSmokeRenderer(
  ownership: RoleFitServerOwnership,
  companionUrl: string,
  serverOrigin: string
): Promise<void> {
  if (!mainWindow) throw new Error("Desktop smoke companion window was not created.");
  console.log(`ROLEFIT_DESKTOP_SMOKE_READY ownership=${ownership} mode=${activeMode} phase=companion`);
  const holdMs = Number(process.env.ROLEFIT_DESKTOP_SMOKE_HOLD_MS ?? 0);
  if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 10_000) {
    throw new Error("ROLEFIT_DESKTOP_SMOKE_HOLD_MS must be between 0 and 10000.");
  }
  if (holdMs > 0) await delay(holdMs);
  const result = await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve) => setTimeout(async () => {
      const bridge = window.roleFitDesktop;
      let runtimeInfo = null;
      let runtimeInfoError = null;
      let localSiteSettings = null;
      let localSiteSettingsError = null;
      let providerStatus = null;
      let providerStatusError = null;
      let providerMutationError = null;
      try {
        runtimeInfo = bridge ? await bridge.getRuntimeInfo() : null;
      } catch (error) {
        runtimeInfoError = error instanceof Error ? error.message : String(error);
      }
      try {
        localSiteSettings = bridge ? await bridge.getLocalSiteSettings() : null;
      } catch (error) {
        localSiteSettingsError = error instanceof Error ? error.message : String(error);
      }
      try {
        if (bridge) await bridge.setCliProviderEnabled('antigravity-cli', true);
      } catch (error) {
        providerMutationError = error instanceof Error ? error.message : String(error);
      }
      try {
        providerStatus = bridge ? await bridge.getProviderConnections() : null;
      } catch (error) {
        providerStatusError = error instanceof Error ? error.message : String(error);
      }
      resolve({
        rootRendered: Boolean(document.querySelector('[data-companion-root]')),
        companionReady: document.querySelector('[data-companion-root]')?.getAttribute('data-status') === 'ready',
        hasRequire: typeof window.require !== 'undefined',
        hasProcess: typeof window.process !== 'undefined',
        hasBuffer: typeof window.Buffer !== 'undefined',
        hasDesktopBridge: typeof bridge !== 'undefined',
        bridgeFrozen: bridge ? Object.isFrozen(bridge) : false,
        bridgeKeys: bridge ? Object.keys(bridge).sort() : [],
        runtimeInfo,
        runtimeInfoError,
        localSiteSettings,
        localSiteSettingsError,
        providerStatus,
        providerStatusError,
        providerMutationError,
        providerLandmarks: document.querySelectorAll('[data-provider-list] > [data-provider-id]').length,
        providerDescriptions: document.querySelectorAll('.provider-card__detail').length,
        providerOrdinals: document.querySelectorAll('.provider-card__ordinal').length,
        replayingProviderAnimations: document.querySelectorAll('.provider-card.is-entering').length,
        descriptiveChromeAbsent: !document.querySelector('.intro, .privacy-note'),
        sitePortForms: document.querySelectorAll('#local-site-port-form').length,
        sitePortValue: document.querySelector('#local-site-port')?.value ?? '',
        sitePortLocked: Boolean(document.querySelector('#local-site-port')?.disabled),
        sitePortLockReported: document.querySelector('#local-site-port-status')?.textContent?.includes('ROLEFIT_DESKTOP_PORT') ?? false,
        fullWorkspaceAbsent: !document.querySelector('header[aria-label="Workspace header"], main[aria-label="Output workspace"]'),
        correctTitle: document.title === 'RoleFit Local Companion'
      });
    }, 900))
  `) as SmokeResult;
  result.providerBackgroundRefreshes = providerBackgroundRefreshes;

  const expectedRuntimeInfo = getDesktopRuntimeInfo();
  const expectedSiteSettings = getLocalSiteSettings();
  const expectedBridgeKeys = [
    "applyLocalSitePort",
    "beginCliSignIn",
    "cancelCliSignIn",
    "getExtensionPairingSettings",
    "getLocalSiteSettings",
    "getProviderConnections",
    "getRuntimeInfo",
    "openBrowserApp",
    "openCliSignInTerminal",
    "openProviderInstallGuide",
    "removeExtensionOrigin",
    "removeProvider",
    "saveApiProvider",
    "saveExtensionOrigin",
    "setCliProviderEnabled"
  ];

  if (
    !result.rootRendered ||
    !result.companionReady ||
    result.hasRequire ||
    result.hasProcess ||
    result.hasBuffer ||
    !result.hasDesktopBridge ||
    !result.bridgeFrozen ||
    result.bridgeKeys.length !== expectedBridgeKeys.length ||
    !result.bridgeKeys.every((key, index) => key === expectedBridgeKeys[index]) ||
    result.runtimeInfoError !== null ||
    !runtimeInfoMatches(result.runtimeInfo, expectedRuntimeInfo) ||
    result.localSiteSettingsError !== null ||
    !siteSettingsMatch(
      result.localSiteSettings,
      expectedSiteSettings.localSitePort,
      expectedSiteSettings.locked
    ) ||
    result.providerStatusError !== null ||
    (ownership === "owned"
      ? result.providerMutationError !== null
      : typeof result.providerMutationError !== "string" ||
        !result.providerMutationError.includes("standalone RoleFit server")) ||
    !providerStatusesMatch(result.providerStatus) ||
    result.providerLandmarks !== 5 ||
    result.providerDescriptions !== 0 ||
    result.providerOrdinals !== 0 ||
    result.replayingProviderAnimations !== 0 ||
    !result.descriptiveChromeAbsent ||
    result.sitePortForms !== 1 ||
    result.sitePortValue !== String(expectedSiteSettings.localSitePort) ||
    result.sitePortLocked !== expectedSiteSettings.locked ||
    result.sitePortLockReported !== expectedSiteSettings.locked ||
    (holdMs >= PROVIDER_SNAPSHOT_REFRESH_INTERVAL_MS && result.providerBackgroundRefreshes < 1) ||
    !result.fullWorkspaceAbsent ||
    !result.correctTitle ||
    rendererErrorCount > 0
  ) {
    throw new Error(
      `Electron companion renderer security smoke failed (${JSON.stringify(result)}, errors=${rendererErrorCount}, samples=${JSON.stringify(rendererErrorSamples)}).`
    );
  }

  let providerPayload: unknown = null;
  const providerDeadline = Date.now() + 2_000;
  while (Date.now() < providerDeadline) {
    const response = await fetch(`${serverOrigin}/api/providers`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error"
    });
    if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.text();
      if (body.length <= 8_192) {
        providerPayload = JSON.parse(body);
        if (providerPayloadMatches(providerPayload, ownership)) break;
      }
    }
    await delay(50);
  }
  if (!providerPayloadMatches(providerPayload, ownership)) {
    throw new Error("Electron companion provider snapshot did not match its owned/reused server boundary.");
  }

  if (!(await verifyUntrustedBridgeRejected(companionUrl))) {
    throw new Error("Electron companion accepted IPC from an untrusted window.");
  }

  const screenshotPath = process.env.ROLEFIT_DESKTOP_SMOKE_SCREENSHOT;
  if (screenshotPath) {
    if (!isAbsolute(screenshotPath)) {
      throw new Error("ROLEFIT_DESKTOP_SMOKE_SCREENSHOT must be an absolute path.");
    }
    const image = await mainWindow.webContents.capturePage();
    await writeFile(screenshotPath, image.toPNG());
  }

  console.log(`ROLEFIT_DESKTOP_SMOKE_OK ownership=${ownership} mode=${activeMode} phase=companion`);
  await shutdownAndExit(0);
}

async function verifyUntrustedBridgeRejected(companionUrl: string): Promise<boolean> {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      allowRunningInsecureContent: false
    }
  });
  try {
    await probe.loadURL("data:text/html,<meta charset=utf-8><title>Untrusted</title>");
    return await probe.webContents.executeJavaScript(`
      window.roleFitDesktop.getRuntimeInfo().then(
        () => false,
        (error) => String(error).includes('Untrusted companion IPC sender')
      )
    `) as boolean;
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
    void companionUrl;
  }
}

function createMainWindow(
  companionPath: string,
  companionUrl: string,
  ownership: RoleFitServerOwnership,
  serverOrigin: string
): BrowserWindow {
  const smokeMode = process.env.ROLEFIT_DESKTOP_SMOKE === "companion";
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 760,
    height: 760,
    minWidth: 620,
    minHeight: 620,
    show: !smokeMode,
    backgroundColor: "#eef1ec",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });

  hardenWindow(window, companionUrl);
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") {
      rendererErrorCount += 1;
      if (rendererErrorSamples.length < 3) {
        rendererErrorSamples.push(
          event.message.includes("Content Security Policy") ? "csp-violation" : "renderer-console-error"
        );
      }
    }
  });
  window.webContents.on("render-process-gone", () => {
    if (!shuttingDown) failStartup(new Error("The RoleFit companion renderer stopped unexpectedly."));
  });
  window.once("ready-to-show", () => {
    if (!smokeMode) window.show();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      void inspectSmokeRenderer(ownership, companionUrl, serverOrigin).catch((error: unknown) => failStartup(error));
    });
  }
  void window.loadFile(companionPath).catch(() => {
    if (!shuttingDown) failStartup(new Error("The RoleFit companion could not load."));
  });
  return window;
}

async function shutdownAndExit(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProviderSnapshotRefreshLoop();
  let finalExitCode = exitCode;
  try {
    removeDesktopIpc?.();
  } catch {
    finalExitCode = 1;
    console.error("[companion] The IPC handlers did not detach cleanly.");
  } finally {
    removeDesktopIpc = null;
  }
  await providerSnapshotQueue;
  try {
    await cliProviderManager?.shutdown();
  } catch {
    finalExitCode = 1;
    console.error("[companion] A CLI sign-in process did not stop cleanly.");
  } finally {
    cliProviderManager = null;
    providerVault = null;
    desktopSettingsManager = null;
    localSiteSettings = null;
  }
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  } catch {
    finalExitCode = 1;
    console.error("[companion] The setup window did not close cleanly.");
  } finally {
    mainWindow = null;
  }
  try {
    removeSessionSecurity?.();
  } catch {
    finalExitCode = 1;
    console.error("[companion] The session security handlers did not detach cleanly.");
  } finally {
    removeSessionSecurity = null;
  }
  try {
    await desktopServer?.close();
  } catch {
    finalExitCode = 1;
    console.error("[companion] The owned RoleFit server did not close cleanly.");
  } finally {
    desktopServer = null;
    app.exit(finalExitCode);
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown companion startup failure.";
}

function failStartup(error: unknown): void {
  const message = safeErrorMessage(error);
  console.error(`[companion] ${message}`);
  if (process.env.ROLEFIT_DESKTOP_SMOKE !== "companion") {
    dialog.showErrorBox(`${APP_NAME} could not start`, message);
  }
  void shutdownAndExit(1);
}

async function startDesktop(): Promise<void> {
  const paths = resolveDesktopRuntimePaths({
    packaged: app.isPackaged,
    sourceAppRoot: resolve(__dirname, "..", ".."),
    packagedAppRoot: app.getAppPath(),
    userDataDirectory: app.getPath("userData"),
    workspaceOverride: process.env.ROLEFIT_WORKSPACE_DIR
  });
  await mkdir(paths.serverCwd, { recursive: true });
  const cliSearchPaths = app.isPackaged
    ? packagedCliSearchPaths(process.platform, app.getPath("home"), process.env)
    : Object.freeze([]);
  const cliProcessEnvironment = buildCliProcessEnvironment(process.env, cliSearchPaths);
  // The owned server has its own closed allowlist, including non-secret model
  // and extension-origin configuration that vendor CLI children must not see.
  // Feed it the original source with only the packaged CLI PATH augmentation;
  // startOrReuseDesktopServer filters this object before the utility fork.
  const desktopServerSourceEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ...(cliProcessEnvironment.PATH === undefined
      ? {}
      : { PATH: cliProcessEnvironment.PATH })
  };
  const mode = readDesktopMode();
  activeMode = mode;
  desktopSettingsManager = createDesktopSettingsManager({
    userDataDirectory: app.getPath("userData"),
    environmentPort: process.env.ROLEFIT_DESKTOP_PORT,
    isPortAvailable: async (candidatePort) =>
      candidatePort === localSiteSettings?.localSitePort ||
      probeLocalSitePortAvailability(candidatePort)
  });
  localSiteSettings = await desktopSettingsManager.load();
  extensionPairingSettings = await desktopSettingsManager.loadExtensionPairingSettings();
  desktopServerSourceEnvironment.EXTENSION_ALLOWED_ORIGINS =
    extensionPairingSettings.origins.length > 0
      ? extensionPairingSettings.origins.join(",")
      : undefined;
  const port = localSiteSettings.localSitePort;

  desktopServer = await startOrReuseDesktopServer({
    appRoot: paths.appRoot,
    serverEntry: paths.serverEntry,
    serverCwd: paths.serverCwd,
    workspaceDir: paths.workspaceDir,
    sourceEnvironment: desktopServerSourceEnvironment,
    mode,
    host: DEFAULT_HOST,
    port,
    onUnexpectedExit: () => {
      if (!shuttingDown) failStartup(new Error("The RoleFit local server stopped unexpectedly."));
    },
    forkServer: ({ modulePath, cwd, env }) =>
      utilityProcess.fork(modulePath, [], {
        cwd,
        env,
        serviceName: "RoleFit Local Service",
        stdio: "inherit"
      })
  });

  const smokePidFile = process.env.ROLEFIT_DESKTOP_SMOKE_SERVER_PID_FILE;
  if (smokePidFile && desktopServer.pid !== undefined) {
    if (!isAbsolute(smokePidFile)) {
      throw new Error("ROLEFIT_DESKTOP_SMOKE_SERVER_PID_FILE must be an absolute path.");
    }
    await writeFile(smokePidFile, String(desktopServer.pid), "utf8");
  }

  const companionPath = join(__dirname, "companion.html");
  const companionUrl = pathToFileURL(companionPath).href;
  const browserOrigin = canonicalBrowserOrigin(desktopServer.origin);
  providerVault = createProviderVault({
    userDataDirectory: app.getPath("userData"),
    safeStorage
  });
  cliProviderManager = createCliProviderManager({
    processEnvironment: cliProcessEnvironment
  });
  await synchronizeProviderSnapshot();
  startProviderSnapshotRefreshLoop();
  removeSessionSecurity = installSessionSecurity(session.defaultSession);
  removeDesktopIpc = installCompanionIpc({
    ipc: ipcMain,
    companionUrl,
    getTrustedWebContentsId: () => mainWindow?.webContents.id ?? null,
    getRuntimeInfo: getDesktopRuntimeInfo,
    getLocalSiteSettings,
    applyLocalSitePort: async (nextPort) => {
      if (relaunchScheduled) {
        throw new Error("A companion restart is already scheduled.");
      }
      if (!desktopSettingsManager) throw new Error("Local site settings are unavailable.");
      localSiteSettings = await desktopSettingsManager.saveLocalSitePort(nextPort);
      scheduleDesktopRelaunch();
      return localSiteSettings;
    },
    getExtensionPairingSettings,
    saveExtensionOrigin: async (origin) => {
      if (relaunchScheduled) throw new Error("A companion restart is already scheduled.");
      requireOwnedServerForExtensionPairing();
      if (localSiteSettings?.localSitePort !== 5_181) {
        throw new Error("Browser extension pairing requires local site port 5181.");
      }
      if (!desktopSettingsManager) throw new Error("Extension pairing settings are unavailable.");
      extensionPairingSettings = await desktopSettingsManager.saveExtensionOrigin(origin);
      scheduleDesktopRelaunch();
      return extensionPairingSettings;
    },
    removeExtensionOrigin: async (origin) => {
      if (relaunchScheduled) throw new Error("A companion restart is already scheduled.");
      requireOwnedServerForExtensionPairing();
      if (!desktopSettingsManager) throw new Error("Extension pairing settings are unavailable.");
      extensionPairingSettings = await desktopSettingsManager.removeExtensionOrigin(origin);
      scheduleDesktopRelaunch();
      return extensionPairingSettings;
    },
    getProviderConnections,
    saveApiProvider: async (provider, apiKey) => {
      requireOwnedServerForProviderMutation();
      await requireProviderVault().saveApiCredential(provider, apiKey);
      await synchronizeProviderSnapshot();
      return getProviderConnection(provider);
    },
    removeProvider: async (provider) => {
      requireOwnedServerForProviderMutation();
      await requireProviderVault().removeProvider(provider);
      await synchronizeProviderSnapshot();
      return getProviderConnection(provider);
    },
    setCliProviderEnabled: async (provider, enabled) => {
      requireOwnedServerForProviderMutation();
      await requireProviderVault().setCliProviderEnabled(provider, enabled);
      await synchronizeProviderSnapshot();
      return getProviderConnection(provider);
    },
    beginCliSignIn: async (provider) => {
      if (!cliProviderManager) throw new Error("CLI provider manager is unavailable.");
      const connection = await getProviderConnection(provider);
      if (!connection.configured) throw new Error("Add this CLI provider before signing in.");
      const result = await cliProviderManager.beginSignIn(provider);
      await synchronizeProviderSnapshot();
      return result;
    },
    cancelCliSignIn: async (operationId) => {
      const canceled = await (cliProviderManager?.cancelSignIn(operationId) ?? Promise.resolve(false));
      await synchronizeProviderSnapshot();
      return canceled;
    },
    openCliSignInTerminal: async (provider) => {
      if (!cliProviderManager) throw new Error("CLI provider manager is unavailable.");
      const connection = await getProviderConnection(provider);
      if (!connection.configured) throw new Error("Add this CLI provider before signing in.");
      if (connection.installed !== true) throw new Error("Install this CLI provider before signing in.");
      return cliProviderManager.openSignInInTerminal(provider);
    },
    openProviderInstallGuide: async (provider) => {
      await shell.openExternal(PROVIDER_INSTALL_GUIDES[provider]);
    },
    openBrowserApp: async () => {
      await shell.openExternal(browserOrigin);
    }
  });
  mainWindow = createMainWindow(
    companionPath,
    companionUrl,
    desktopServer.ownership,
    desktopServer.origin
  );
}

const isSquirrelStartup = process.platform === "win32" && squirrelStartup;
const hasSingleInstanceLock = !isSquirrelStartup && app.requestSingleInstanceLock();
if (isSquirrelStartup || !hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (shuttingDown) return;
    if (process.env.ROLEFIT_DESKTOP_SMOKE === "companion") {
      console.log("ROLEFIT_DESKTOP_SECOND_INSTANCE_FOCUSED");
    }
    if (mainWindow) bringWindowForward();
    else if (desktopServer) {
      const companionPath = join(__dirname, "companion.html");
      mainWindow = createMainWindow(
        companionPath,
        pathToFileURL(companionPath).href,
        desktopServer.ownership,
        desktopServer.origin
      );
    }
  });
  app.on("activate", () => {
    if (shuttingDown) return;
    if (!mainWindow && desktopServer) {
      const companionPath = join(__dirname, "companion.html");
      mainWindow = createMainWindow(
        companionPath,
        pathToFileURL(companionPath).href,
        desktopServer.ownership,
        desktopServer.origin
      );
    }
  });
  // macOS keeps the local companion resident and restores its window through
  // the standard activate path. Windows exits through normal app.quit cleanup
  // until a future distribution phase explicitly owns a tray lifecycle.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !shuttingDown) app.quit();
  });
  app.on("before-quit", (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      void shutdownAndExit(0);
    }
  });
  app.on("will-quit", () => desktopServer?.terminateNow());
  void app.whenReady().then(startDesktop).catch(failStartup);
}
