import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, utilityProcess } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  connectToCompatibleDesktopServer,
  probeCompatibleDesktopServer,
  probeDesktopServerLaunchKind,
  startOrReuseDesktopServer,
  type DesktopServerConflict,
  type DesktopServerHandle,
  type DesktopServerIdentity,
  type DesktopServerOptions,
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
  ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES,
  ROLEFIT_WORKSPACE_BASE_RESUME_RE,
  ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE,
  ROLEFIT_WORKSPACE_STAT_FILE_MAX_BYTES,
  createRoleFitDesktopRuntimeInfo,
  isRoleFitWorkspaceBackupFileName,
  normalizeRoleFitExtensionOrigin,
  type RoleFitCliProviderStatus,
  type RoleFitConnectionStatus,
  type RoleFitDesktopRuntimeInfo,
  type RoleFitDesktopSiteSettings,
  type RoleFitExtensionPairingSettings,
  type RoleFitProviderConnection,
  type RoleFitProviderId,
  type RoleFitWorkspaceBackupResult,
  type RoleFitWorkspaceOverview,
  type RoleFitWorkspaceRestoreResult
} from "./ipc-contract.cjs";
import { installCompanionIpc } from "./ipc.cjs";
import { readBoundedResponseText } from "./bounded-response.cjs";
import { materializeRoleFitExtension } from "./extension-bundle.cjs";
import { resolveDesktopRuntimePaths } from "./runtime-paths.cjs";
import {
  DesktopSitePortUnavailableError,
  createDesktopSettingsManager,
  probeLocalSitePortAvailability,
  type DesktopSettingsManager
} from "./desktop-settings.cjs";
import { findLoopbackListenerPid } from "./listener-process.cjs";

// Preserve the existing runtime name because Electron derives the userData
// directory from it. Packaging and window chrome use the public name RoleFit AI.
const INTERNAL_APP_NAME = "RoleFit Local Companion";
const PUBLIC_APP_NAME = "RoleFit AI";
const DEFAULT_HOST = "127.0.0.1" as const;
const PROVIDER_SNAPSHOT_REFRESH_INTERVAL_MS = 5_000;
const WORKSPACE_ACTIVITY_TIMEOUT_MS = 1_500;
const WORKSPACE_SMALL_RESPONSE_MAX_BYTES = 4_096;
const ALTERNATE_PORT_SCAN_LIMIT = 512;
const LISTENER_SHUTDOWN_TIMEOUT_MS = 5_000;

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
  navigationRegions: number;
  navigationItems: number;
  panels: number;
  visiblePanels: number;
  activeSection: string;
  visibleSection: string;
  workspaceControlsPresent: boolean;
  connectionControlsPresent: boolean;
  panelCopyConcise: boolean;
  workspaceOverview: unknown;
  workspaceOverviewError: string | null;
  connectionStatus: unknown;
  connectionStatusError: string | null;
  fullWorkspaceAbsent: boolean;
  correctTitle: boolean;
};

app.setName(INTERNAL_APP_NAME);
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
let activeWorkspaceDir: string | null = null;
let workspaceTransferActive = false;

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
  if (desktopServer?.ownership !== "owned") {
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
      "Restart RoleFit and let this companion start the local service before changing providers."
    );
  }
}

function requireOwnedServerForExtensionPairing(): void {
  if (desktopServer?.ownership !== "owned") {
    throw new Error(
      "Restart RoleFit and let this companion start the local service before changing extension access."
    );
  }
}

function requireWorkspaceDir(): string {
  if (!activeWorkspaceDir) throw new Error("The workspace location is unavailable.");
  return activeWorkspaceDir;
}

function toWorkspaceDisplayPath(workspacePath: string): string {
  try {
    const home = app.getPath("home");
    if (home && workspacePath === home) return "~";
    if (home && workspacePath.startsWith(home + sep)) {
      return `~${workspacePath.slice(home.length)}`;
    }
  } catch {
    // Fall through to the absolute path when no home directory is resolvable.
  }
  return workspacePath;
}

async function readWorkspaceActivity(origin: string): Promise<number | null> {
  try {
    const response = await fetch(`${origin}/api/workspace/activity`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(WORKSPACE_ACTIVITY_TIMEOUT_MS)
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return null;
    }
    const body = await readBoundedResponseText(response, WORKSPACE_SMALL_RESPONSE_MAX_BYTES);
    const value = JSON.parse(body) as unknown;
    const activeTabs = value && typeof value === "object" && !Array.isArray(value)
      ? (value as { activeTabs?: unknown }).activeTabs
      : undefined;
    return typeof activeTabs === "number" && Number.isSafeInteger(activeTabs) && activeTabs >= 0
      ? activeTabs
      : null;
  } catch {
    return null;
  }
}

async function safeWorkspaceDirents(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Shape-only application count: a bounded, defensive read of applications.json
// that never throws and never lets record contents cross IPC.
async function readApplicationCount(filePath: string): Promise<number | null> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > ROLEFIT_WORKSPACE_STAT_FILE_MAX_BYTES) return null;
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") {
      const applications = (value as { applications?: unknown }).applications;
      if (Array.isArray(applications)) return applications.length;
    }
    return null;
  } catch {
    return null;
  }
}

type WorkspaceStats = Readonly<{
  hasBaseResume: boolean;
  applicationCount: number | null;
}>;

const EMPTY_WORKSPACE_STATS: WorkspaceStats = Object.freeze({
  hasBaseResume: false,
  applicationCount: null
});

async function readWorkspaceStats(workspaceDir: string): Promise<WorkspaceStats> {
  try {
    const rootEntries = await safeWorkspaceDirents(workspaceDir);
    const resumeEntries = await safeWorkspaceDirents(join(workspaceDir, "resumes"));
    const hasBaseResume = resumeEntries.some((entry) => entry.isFile() &&
      (ROLEFIT_WORKSPACE_BASE_RESUME_RE.test(entry.name) ||
        ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE.test(entry.name)));
    const applicationCount = rootEntries.some((entry) => entry.isFile() && entry.name === "applications.json")
      ? await readApplicationCount(join(workspaceDir, "applications.json"))
      : null;
    return Object.freeze({ hasBaseResume, applicationCount });
  } catch {
    return EMPTY_WORKSPACE_STATS;
  }
}

async function getWorkspaceOverview(): Promise<RoleFitWorkspaceOverview> {
  const workspacePath = requireWorkspaceDir();
  const [activeBrowserTabs, stats] = await Promise.all([
    desktopServer ? readWorkspaceActivity(desktopServer.origin) : Promise.resolve(null),
    readWorkspaceStats(workspacePath)
  ]);
  return Object.freeze({
    workspacePath,
    workspaceDisplayPath: toWorkspaceDisplayPath(workspacePath),
    activeBrowserTabs,
    serverReady: desktopServer !== null,
    workspaceTransferReady: desktopServer?.ownership === "owned",
    hasBaseResume: stats.hasBaseResume,
    applicationCount: stats.applicationCount
  });
}

async function getConnectionStatus(): Promise<RoleFitConnectionStatus> {
  const settings = getLocalSiteSettings();
  const server = desktopServer;
  const siteUrl = server
    ? canonicalBrowserOrigin(server.origin)
    : `http://localhost:${settings.localSitePort}`;
  let serverState: RoleFitConnectionStatus["serverState"] = "starting";
  let activeBrowserTabs: number | null = null;
  if (server) {
    const liveLaunchKind = activeWorkspaceDir
      ? await probeDesktopServerLaunchKind({
          host: DEFAULT_HOST,
          mode: activeMode,
          port: settings.localSitePort,
          workspaceDir: activeWorkspaceDir
        })
      : null;
    serverState = liveLaunchKind
      ? server.ownership === "owned" && liveLaunchKind === "companion"
        ? "owned"
        : liveLaunchKind === "standalone"
          ? "reused-standalone"
          : "reused-companion"
      : "unreachable";
    if (liveLaunchKind) activeBrowserTabs = await readWorkspaceActivity(server.origin);
  }
  return Object.freeze({
    port: settings.localSitePort,
    siteUrl,
    serverState,
    activeBrowserTabs
  });
}

function workspaceBackupFileName(candidate: string): string {
  if (isRoleFitWorkspaceBackupFileName(candidate)) return candidate;
  return `RoleFit-Workspace-${new Date().toISOString().slice(0, 10)}.rolefit-backup`;
}

function defaultBackupSavePath(fileName: string): string {
  try {
    return join(app.getPath("downloads"), fileName);
  } catch {
    return fileName;
  }
}

function workspaceError(message: string): Readonly<{ status: "error"; message: string }> {
  return Object.freeze({ status: "error" as const, message });
}

async function backupWorkspaceToFile(): Promise<RoleFitWorkspaceBackupResult> {
  if (workspaceTransferActive) {
    return workspaceError("A workspace backup or restore is already running.");
  }
  const server = desktopServer;
  const window = mainWindow;
  if (!server) {
    return workspaceError("The local RoleFit server is not running. Restart the companion and try again.");
  }
  if (!window || window.isDestroyed()) {
    return workspaceError("The companion window is unavailable.");
  }
  workspaceTransferActive = true;
  try {
    let transfer;
    try {
      transfer = await server.backupWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      return workspaceError(message || "The workspace could not be backed up safely.");
    }
    const { body } = transfer;
    if (Buffer.byteLength(body, "utf8") > ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES) {
      return workspaceError("The workspace backup is larger than the supported 96 MB limit.");
    }
    // Minimal shape probe only; the server already validated the envelope and
    // the file is written verbatim. Never log or echo envelope contents.
    let fileCount = 0;
    let includesPreferences = false;
    try {
      const envelope = JSON.parse(body) as unknown;
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
          !Array.isArray((envelope as { files?: unknown }).files)) {
        throw new Error("Unexpected backup envelope.");
      }
      fileCount = (envelope as { files: readonly unknown[] }).files.length;
      includesPreferences = "browser" in envelope;
    } catch {
      return workspaceError("The local server returned an unexpected backup format.");
    }
    const saveResult = await dialog.showSaveDialog(window, {
      title: "Save workspace backup",
      defaultPath: defaultBackupSavePath(
        workspaceBackupFileName(transfer.fileName)
      ),
      filters: [{ name: "RoleFit workspace backup", extensions: ["rolefit-backup"] }]
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return Object.freeze({ status: "cancelled" as const });
    }
    const targetPath = saveResult.filePath.endsWith(".rolefit-backup")
      ? saveResult.filePath
      : `${saveResult.filePath}.rolefit-backup`;
    const temporaryPath = join(dirname(targetPath), `.rolefit-backup-${process.pid}-${randomUUID()}.tmp`);
    try {
      // Never truncate an existing backup before the replacement bytes are
      // complete. The sibling temporary file keeps the final rename on the same
      // volume and owner-only permissions protect the sensitive plaintext JSON.
      await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, targetPath);
    } catch {
      return workspaceError("The backup file could not be written. Choose another location and try again.");
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return Object.freeze({
      status: "saved" as const,
      filePath: basename(targetPath),
      fileCount,
      includesPreferences
    });
  } finally {
    workspaceTransferActive = false;
  }
}

async function restoreWorkspaceFromFile(): Promise<RoleFitWorkspaceRestoreResult> {
  if (workspaceTransferActive) {
    return workspaceError("A workspace backup or restore is already running.");
  }
  const server = desktopServer;
  const window = mainWindow;
  if (!server) {
    return workspaceError("The local RoleFit server is not running. Restart the companion and try again.");
  }
  if (!window || window.isDestroyed()) {
    return workspaceError("The companion window is unavailable.");
  }
  workspaceTransferActive = true;
  try {
    const openResult = await dialog.showOpenDialog(window, {
      title: "Restore workspace backup",
      properties: ["openFile"],
      filters: [{ name: "RoleFit workspace backup", extensions: ["rolefit-backup"] }]
    });
    const backupPath = openResult.filePaths[0];
    if (openResult.canceled || !backupPath) {
      return Object.freeze({ status: "cancelled" as const });
    }
    try {
      const details = await stat(backupPath);
      if (!details.isFile()) {
        return workspaceError("Choose a regular .rolefit-backup file.");
      }
      // Refuse oversized files before reading them into memory.
      if (details.size > ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES) {
        return workspaceError("That file is larger than the supported 96 MB backup limit.");
      }
    } catch {
      return workspaceError("The selected backup file could not be read.");
    }
    let body: string;
    try {
      body = (await readFile(backupPath, "utf8")).replace(/^\uFEFF/, "");
    } catch {
      return workspaceError("The selected backup file could not be read.");
    }
    try {
      const value = JSON.parse(body) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Not a backup envelope.");
      }
    } catch {
      return workspaceError("This is not a valid RoleFit workspace backup.");
    }
    const confirmation = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Cancel", "Replace Workspace"],
      defaultId: 0,
      cancelId: 0,
      message: "Replace the saved workspace with this backup?",
      detail: "The current saved workspace is kept as a local safety copy. Close any open RoleFit browser tabs first."
    });
    if (confirmation.response !== 1) {
      return Object.freeze({ status: "cancelled" as const });
    }
    try {
      const record = await server.restoreWorkspace(body);
      return Object.freeze({
        status: "restored" as const,
        restoredFiles: record.restoredFiles,
        previousWorkspaceKept: record.previousWorkspaceKept
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      return workspaceError(message || "The workspace could not be restored safely.");
    }
  } finally {
    workspaceTransferActive = false;
  }
}

async function openWorkspaceFolder(): Promise<void> {
  const workspacePath = requireWorkspaceDir();
  try {
    // The server's ensureJobWorkspace performs the same recursive mkdir before
    // touching the workspace; opening an empty-but-real folder mirrors that.
    await mkdir(workspacePath, { recursive: true });
  } catch {
    throw new Error("The workspace folder could not be created. Check folder permissions.");
  }
  const failure = await shell.openPath(workspacePath);
  if (failure) throw new Error("The workspace folder could not be opened.");
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
    guidance: configured
      ? ready
        ? `${label} API access is stored securely on this device.`
        : !managedServer
          ? `Restart RoleFit and let this companion start the local service to use its saved ${label} credential.`
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
    guidance = `Restart RoleFit and let this companion start the local service to use ${status.label}.`;
  }
  return Object.freeze({
    id: status.id,
    kind: "cli",
    configured,
    ready,
    installed: status.installed,
    authState: status.authState,
    setupFlow,
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

function nullableCountMatches(value: unknown): boolean {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function workspaceOverviewMatches(
  value: unknown,
  expectedPath: string | null,
  expectedState: RoleFitServerOwnership
): boolean {
  if (!expectedPath || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const overview = value as Record<string, unknown>;
  return overview.workspacePath === expectedPath &&
    typeof overview.workspaceDisplayPath === "string" &&
    overview.workspaceDisplayPath.length > 0 &&
    nullableCountMatches(overview.activeBrowserTabs) &&
    overview.serverReady === true &&
    overview.workspaceTransferReady === (expectedState === "owned") &&
    typeof overview.hasBaseResume === "boolean" &&
    nullableCountMatches(overview.applicationCount) &&
    Object.keys(overview).length === 7;
}

function connectionStatusMatches(
  value: unknown,
  expectedPort: number,
  expectedSiteUrl: string,
  expectedState: RoleFitConnectionStatus["serverState"]
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return status.port === expectedPort &&
    status.siteUrl === expectedSiteUrl &&
    status.serverState === expectedState &&
    nullableCountMatches(status.activeBrowserTabs) &&
    Object.keys(status).length === 4;
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
      typeof status.guidance === "string" &&
      Object.keys(status).length === 8;
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
  const rawMode = process.env.ROLEFIT_DESKTOP_MODE ??
    argument?.split("=", 2)[1] ??
    (app.isPackaged ? "production" : "development");
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
  launchKind: DesktopServerHandle["launchKind"],
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
      let workspaceOverview = null;
      let workspaceOverviewError = null;
      let connectionStatus = null;
      let connectionStatusError = null;
      try {
        runtimeInfo = bridge ? await bridge.getRuntimeInfo() : null;
      } catch (error) {
        runtimeInfoError = error instanceof Error ? error.message : String(error);
      }
      try {
        workspaceOverview = bridge ? await bridge.getWorkspaceOverview() : null;
      } catch (error) {
        workspaceOverviewError = error instanceof Error ? error.message : String(error);
      }
      try {
        connectionStatus = bridge ? await bridge.getConnectionStatus() : null;
      } catch (error) {
        connectionStatusError = error instanceof Error ? error.message : String(error);
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
        navigationRegions: document.querySelectorAll('nav.companion-nav').length,
        navigationItems: document.querySelectorAll('[data-companion-tab]').length,
        panels: document.querySelectorAll('[data-companion-panel]').length,
        visiblePanels: [...document.querySelectorAll('[data-companion-panel]')].filter((panel) => !panel.hidden).length,
        activeSection: document.querySelector('[data-companion-tab][aria-current="page"]')?.getAttribute('data-companion-tab') ?? '',
        visibleSection: document.querySelector('[data-companion-panel]:not([hidden])')?.getAttribute('data-companion-panel') ?? '',
        workspaceControlsPresent: ['workspace-path', 'open-workspace-folder', 'backup-workspace', 'restore-workspace', 'workspace-status', 'stat-base-resume', 'stat-applications'].every((id) => Boolean(document.getElementById(id))) &&
          ['workspace-activity', 'stat-pdfs', 'stat-history'].every((id) => !document.getElementById(id)),
        connectionControlsPresent: ['connection-state', 'connection-state-text', 'connection-browser-tabs'].every((id) => Boolean(document.getElementById(id))),
        panelCopyConcise: [...document.querySelectorAll('main p')].every((paragraph) => (paragraph.textContent ?? '').trim().length <= 160),
        workspaceOverview,
        workspaceOverviewError,
        connectionStatus,
        connectionStatusError,
        fullWorkspaceAbsent: !document.querySelector('header[aria-label="Workspace header"], main[aria-label="Output workspace"]'),
        correctTitle: document.title === 'RoleFit AI'
      });
    }, 900))
  `) as SmokeResult;
  result.providerBackgroundRefreshes = providerBackgroundRefreshes;

  const expectedRuntimeInfo = getDesktopRuntimeInfo();
  const expectedSiteSettings = getLocalSiteSettings();
  const expectedConnectionState: RoleFitConnectionStatus["serverState"] =
    ownership === "owned"
      ? "owned"
      : launchKind === "standalone"
        ? "reused-standalone"
        : "reused-companion";
  const expectedBridgeKeys = [
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
  ];

  const smokeChecks: ReadonlyArray<readonly [string, boolean]> = [
    ["root rendered", result.rootRendered],
    ["companion ready", result.companionReady],
    ["Node require absent", !result.hasRequire],
    ["Node process absent", !result.hasProcess],
    ["Node Buffer absent", !result.hasBuffer],
    ["desktop bridge present", result.hasDesktopBridge],
    ["desktop bridge frozen", result.bridgeFrozen],
    ["desktop bridge keys", result.bridgeKeys.length === expectedBridgeKeys.length &&
      result.bridgeKeys.every((key, index) => key === expectedBridgeKeys[index])],
    ["runtime info request", result.runtimeInfoError === null],
    ["runtime info contract", runtimeInfoMatches(result.runtimeInfo, expectedRuntimeInfo)],
    ["site settings request", result.localSiteSettingsError === null],
    ["site settings contract", siteSettingsMatch(
      result.localSiteSettings,
      expectedSiteSettings.localSitePort,
      expectedSiteSettings.locked
    )],
    ["provider status request", result.providerStatusError === null],
    ["provider mutation boundary", ownership === "owned"
      ? result.providerMutationError === null
      : typeof result.providerMutationError === "string" &&
        result.providerMutationError.includes("let this companion start the local service")],
    ["provider status contract", providerStatusesMatch(result.providerStatus)],
    ["provider landmarks", result.providerLandmarks === 5],
    ["provider descriptions absent", result.providerDescriptions === 0],
    ["provider ordinals absent", result.providerOrdinals === 0],
    ["provider entry animations settled", result.replayingProviderAnimations === 0],
    ["legacy descriptive chrome absent", result.descriptiveChromeAbsent],
    ["site port form", result.sitePortForms === 1],
    ["site port value", result.sitePortValue === String(expectedSiteSettings.localSitePort)],
    ["site port lock", result.sitePortLocked === expectedSiteSettings.locked],
    ["site port lock status", result.sitePortLockReported === expectedSiteSettings.locked],
    ["sidebar navigation", result.navigationRegions === 1 && result.navigationItems === 5],
    ["section panels", result.panels === 5 && result.visiblePanels === 1],
    ["active section", ["overview", "providers", "workspace", "extension", "settings"].includes(result.activeSection) &&
      result.visibleSection === result.activeSection],
    ["workspace controls", result.workspaceControlsPresent],
    ["connection controls", result.connectionControlsPresent],
    ["concise panel copy", result.panelCopyConcise],
    ["workspace overview request", result.workspaceOverviewError === null],
    ["workspace overview contract", workspaceOverviewMatches(result.workspaceOverview, activeWorkspaceDir, ownership)],
    ["connection status request", result.connectionStatusError === null],
    ["connection status contract", connectionStatusMatches(
      result.connectionStatus,
      expectedSiteSettings.localSitePort,
      canonicalBrowserOrigin(serverOrigin),
      expectedConnectionState
    )],
    ["provider background refresh", holdMs < PROVIDER_SNAPSHOT_REFRESH_INTERVAL_MS ||
      result.providerBackgroundRefreshes >= 1],
    ["full browser workspace absent", result.fullWorkspaceAbsent],
    ["window title", result.correctTitle],
    ["renderer console", rendererErrorCount === 0]
  ];
  const failedChecks = smokeChecks.filter(([, passed]) => !passed).map(([label]) => label);
  if (failedChecks.length > 0) {
    throw new Error(
      `Electron companion renderer security smoke failed (${failedChecks.join(", ")}; ${JSON.stringify(result)}, errors=${rendererErrorCount}, samples=${JSON.stringify(rendererErrorSamples)}).`
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
  launchKind: DesktopServerHandle["launchKind"],
  serverOrigin: string
): BrowserWindow {
  const smokeMode = process.env.ROLEFIT_DESKTOP_SMOKE === "companion";
  const window = new BrowserWindow({
    title: PUBLIC_APP_NAME,
    // Packaged builds take the "R" icon from the signed executable (forge
    // `icon.ico`/`icon.icns`); dev needs it pointed at the source asset so the
    // window/taskbar icon is the same "R" mark, not the default Electron icon.
    icon: app.isPackaged
      ? undefined
      : join(__dirname, "..", "..", "desktop", "assets", "icon.ico"),
    width: 900,
    height: 620,
    minWidth: 900,
    minHeight: 620,
    maxWidth: 900,
    maxHeight: 620,
    resizable: false,
    maximizable: false,
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
      void inspectSmokeRenderer(ownership, launchKind, companionUrl, serverOrigin)
        .catch((error: unknown) => failStartup(error));
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
    console.error("[companion] The CLI provider manager did not stop cleanly.");
  } finally {
    cliProviderManager = null;
    providerVault = null;
    desktopSettingsManager = null;
    localSiteSettings = null;
    activeWorkspaceDir = null;
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
    dialog.showErrorBox(`${PUBLIC_APP_NAME} could not start`, message);
  }
  void shutdownAndExit(1);
}

function alternatePortCandidate(port: number, offset: number): number {
  const firstUnprivilegedPort = 1_024;
  const availablePortCount = 65_535 - firstUnprivilegedPort + 1;
  const normalizedStart = Math.max(port, firstUnprivilegedPort);
  return firstUnprivilegedPort +
    ((normalizedStart - firstUnprivilegedPort + offset) % availablePortCount);
}

async function persistNextAvailablePort(blockedPort: number): Promise<number> {
  if (!desktopSettingsManager || !localSiteSettings) {
    throw new Error("Local site settings are unavailable.");
  }
  if (localSiteSettings.locked) {
    throw new Error(
      "ROLEFIT_DESKTOP_PORT locks this port. Remove the override before choosing another port."
    );
  }
  for (let offset = 1; offset <= ALTERNATE_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = alternatePortCandidate(blockedPort, offset);
    try {
      localSiteSettings = await desktopSettingsManager.saveLocalSitePort(candidate);
      return candidate;
    } catch (error) {
      if (error instanceof DesktopSitePortUnavailableError) continue;
      throw error;
    }
  }
  throw new Error("RoleFit could not find an available local port nearby.");
}

async function waitForPortToFree(port: number): Promise<boolean> {
  const deadline = Date.now() + LISTENER_SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeLocalSitePortAvailability(port)) return true;
    await delay(100);
  }
  return probeLocalSitePortAvailability(port);
}

async function gracefullyStopCompatibleListener(
  options: DesktopServerIdentity
): Promise<boolean> {
  if (process.platform !== "darwin" && process.platform !== "linux") return false;
  const listenerPid = await findLoopbackListenerPid(options.port);
  if (!listenerPid || listenerPid === process.pid) return false;
  // Revalidate RoleFit between PID resolutions so a replacement listener
  // cannot inherit the user's takeover authorization.
  if (!(await probeCompatibleDesktopServer(options))) return false;
  if (await findLoopbackListenerPid(options.port) !== listenerPid) return false;
  try {
    process.kill(listenerPid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return waitForPortToFree(options.port);
    }
    return false;
  }
  return waitForPortToFree(options.port);
}

async function chooseAfterTakeoverFailure(
  conflict: DesktopServerConflict
): Promise<"alternate" | "connect" | "quit"> {
  if (conflict.kind !== "compatible-rolefit") {
    throw new Error("Only a compatible RoleFit listener can reach takeover recovery.");
  }
  const canChangePort = localSiteSettings?.locked === false;
  const listenerLabel = conflict.launchKind === "standalone"
    ? "development server"
    : "previous RoleFit service";
  const connectLabel = conflict.launchKind === "standalone"
    ? "Connect to development server"
    : "Use existing service";
  const buttons = canChangePort
    ? ["Use another port", connectLabel, "Quit"]
    : [connectLabel, "Quit"];
  const response = await dialog.showMessageBox({
    type: "warning",
    title: "RoleFit could not restart the local service",
    message: `The ${listenerLabel} is still running on port ${conflict.port}.`,
    detail: canChangePort
      ? "It did not stop within five seconds. RoleFit did not force it to quit."
      : "It did not stop within five seconds. RoleFit did not force it to quit, and ROLEFIT_DESKTOP_PORT prevents choosing another port.",
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  });
  if (canChangePort && response.response === 0) return "alternate";
  if (response.response === (canChangePort ? 1 : 0)) return "connect";
  return "quit";
}

async function resolveDesktopServer(
  baseOptions: Omit<DesktopServerOptions, "port">
): Promise<DesktopServerHandle | null> {
  if (!localSiteSettings) throw new Error("Local site settings are unavailable.");
  let port = localSiteSettings.localSitePort;
  while (true) {
    const options: DesktopServerOptions = { ...baseOptions, port };
    const outcome = await startOrReuseDesktopServer(options);
    if (outcome.status === "ready") return outcome.server;
    if (process.env.ROLEFIT_DESKTOP_SMOKE === "companion") {
      if (outcome.kind === "compatible-rolefit") {
        return connectToCompatibleDesktopServer(outcome);
      }
      throw new Error(
        `Port ${port} is already in use by a service that is not a compatible RoleFit server.`
      );
    }

    if (outcome.kind === "foreign-service") {
      const canChangePort = localSiteSettings.locked === false;
      const buttons = canChangePort ? ["Use another port", "Quit"] : ["Quit"];
      const response = await dialog.showMessageBox({
        type: "warning",
        title: "Local site port is in use",
        message: `Port ${port} is in use by another application.`,
        detail: canChangePort
          ? ""
          : "ROLEFIT_DESKTOP_PORT locks this port. Remove the override or stop the other application before reopening RoleFit.",
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true
      });
      if (!canChangePort || response.response !== 0) return null;
      port = await persistNextAvailablePort(port);
      continue;
    }

    const canChangePort = localSiteSettings.locked === false;
    const canTakeOver = process.platform === "darwin" || process.platform === "linux";
    const actions: Array<"connect" | "takeover" | "alternate"> = ["connect"];
    if (canTakeOver) actions.push("takeover");
    if (canChangePort) actions.push("alternate");
    const standalone = outcome.launchKind === "standalone";
    const title = standalone
      ? "RoleFit development server detected"
      : "RoleFit service is already running";
    const message = standalone
      ? `A development server is already using port ${port}.`
      : `A RoleFit service from another companion session is using port ${port}.`;
    const detail = standalone
      ? canTakeOver
        ? "Connect without companion-managed features, stop the development server gracefully so this companion can start its own service, or use another port."
        : "Connect without companion-managed features or use another port. Windows cannot gracefully stop an arbitrary listener."
      : canTakeOver
        ? "This companion does not own the active service's private connection. Use it without management, restart it gracefully, or use another port."
        : "This companion does not own the active service's private connection. Use it without management or choose another port; Windows cannot gracefully stop an arbitrary listener.";
    const response = await dialog.showMessageBox({
      type: "warning",
      title,
      message,
      detail,
      buttons: actions.map((action) => ({
        connect: standalone ? "Connect to development server" : "Use existing service",
        takeover: standalone ? "Stop development server" : "Restart RoleFit service",
        alternate: "Use another port"
      })[action]),
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    const action = actions[response.response] ?? "connect";
    if (action === "connect") {
      const recheck = await startOrReuseDesktopServer(options);
      if (recheck.status === "ready") return recheck.server;
      if (recheck.kind === "compatible-rolefit") {
        return connectToCompatibleDesktopServer(recheck);
      }
      continue;
    }
    if (action === "alternate") {
      port = await persistNextAvailablePort(port);
      continue;
    }

    const recheck = await startOrReuseDesktopServer(options);
    if (recheck.status === "ready") return recheck.server;
    if (recheck.kind === "foreign-service") continue;
    if (await gracefullyStopCompatibleListener(options)) continue;
    const fallback = await chooseAfterTakeoverFailure(recheck);
    if (fallback === "quit") return null;
    if (fallback === "connect") {
      const connectRecheck = await startOrReuseDesktopServer(options);
      if (connectRecheck.status === "ready") return connectRecheck.server;
      if (connectRecheck.kind === "compatible-rolefit") {
        return connectToCompatibleDesktopServer(connectRecheck);
      }
      continue;
    }
    port = await persistNextAvailablePort(port);
  }
}

async function startDesktop(): Promise<void> {
  const paths = resolveDesktopRuntimePaths({
    packaged: app.isPackaged,
    sourceAppRoot: resolve(__dirname, "..", ".."),
    packagedAppRoot: app.getAppPath(),
    userDataDirectory: app.getPath("userData"),
    workspaceOverride: process.env.ROLEFIT_WORKSPACE_DIR
  });
  // The same runtime-paths resolution feeds ROLEFIT_WORKSPACE_DIR to the owned
  // server, so the Workspace tab always describes the server's workspace.
  activeWorkspaceDir = paths.workspaceDir;
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
  desktopServer = await resolveDesktopServer({
    appRoot: paths.appRoot,
    serverEntry: paths.serverEntry,
    serverCwd: paths.serverCwd,
    workspaceDir: paths.workspaceDir,
    sourceEnvironment: desktopServerSourceEnvironment,
    mode,
    host: DEFAULT_HOST,
    onUnexpectedExit: (code) => {
      if (shuttingDown) return;
      if (code === 0) {
        // Another companion may have performed the user-approved graceful
        // restart. The old owner should close without reporting a crash.
        void shutdownAndExit(0);
        return;
      }
      failStartup(new Error("The RoleFit local server stopped unexpectedly."));
    },
    forkServer: ({ modulePath, cwd, env }) =>
      utilityProcess.fork(modulePath, [], {
        cwd,
        env,
        serviceName: "RoleFit Local Service",
        stdio: "inherit"
      })
  });
  if (!desktopServer) {
    await shutdownAndExit(0);
    return;
  }
  const extensionDirectory = await materializeRoleFitExtension({
    sourceDirectory: join(paths.appRoot, "extension"),
    userDataDirectory: app.getPath("userData"),
    localSitePort: localSiteSettings.localSitePort
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
    openExtensionDirectory: async () => {
      const errorMessage = await shell.openPath(extensionDirectory);
      if (errorMessage) throw new Error("Could not open the RoleFit browser-extension folder.");
    },
    openBrowserApp: async () => {
      await shell.openExternal(browserOrigin);
    },
    getWorkspaceOverview,
    backupWorkspaceToFile,
    restoreWorkspaceFromFile,
    openWorkspaceFolder,
    getConnectionStatus
  });
  mainWindow = createMainWindow(
    companionPath,
    companionUrl,
    desktopServer.ownership,
    desktopServer.launchKind,
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
        desktopServer.launchKind,
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
        desktopServer.launchKind,
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
