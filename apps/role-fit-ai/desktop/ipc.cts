import { Buffer } from "node:buffer";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  ROLEFIT_API_KEY_MAX_BYTES,
  ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
  ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT,
  ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT,
  ROLEFIT_PROVIDER_IDS,
  ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH,
  ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH,
  ROLEFIT_WORKSPACE_PATH_MAX_LENGTH,
  RoleFitDesktopIpcChannel,
  isRoleFitApiProviderId,
  isRoleFitCliProviderId,
  isRoleFitConnectionServerState,
  isRoleFitProviderId,
  isRoleFitWorkspaceBackupFileName,
  normalizeRoleFitExtensionOrigin,
  type RoleFitApiProviderId,
  type RoleFitApplyLocalSitePortRequest,
  type RoleFitCliProviderId,
  type RoleFitCliTerminalSignInResult,
  type RoleFitDesktopRuntimeInfoRequest,
  type RoleFitDesktopRuntimeInfo,
  type RoleFitDesktopSiteSettings,
  type RoleFitDesktopSiteSettingsRequest,
  type RoleFitExtensionPairingSettings,
  type RoleFitExtensionPairingSettingsRequest,
  type RoleFitSaveExtensionOriginRequest,
  type RoleFitRemoveExtensionOriginRequest,
  type RoleFitOpenBrowserAppRequest,
  type RoleFitOpenCliSignInTerminalRequest,
  type RoleFitOpenProviderInstallGuideRequest,
  type RoleFitProviderConnection,
  type RoleFitProviderConnectionsRequest,
  type RoleFitProviderId,
  type RoleFitRemoveProviderRequest,
  type RoleFitSaveApiProviderRequest,
  type RoleFitSetCliProviderEnabledRequest,
  type RoleFitBackupWorkspaceToFileRequest,
  type RoleFitConnectionStatus,
  type RoleFitConnectionStatusRequest,
  type RoleFitOpenWorkspaceFolderRequest,
  type RoleFitRestoreWorkspaceFromFileRequest,
  type RoleFitWorkspaceBackupResult,
  type RoleFitWorkspaceOverview,
  type RoleFitWorkspaceOverviewRequest,
  type RoleFitWorkspaceRestoreResult
} from "./ipc-contract.cjs";
import { isTrustedCompanionUrl } from "./security.cjs";

export type CompanionRequestEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;

export type CompanionIpcOptions = {
  ipc: Pick<IpcMain, "handle" | "removeHandler">;
  companionUrl: string;
  getTrustedWebContentsId(): number | null;
  getRuntimeInfo(): RoleFitDesktopRuntimeInfo;
  getLocalSiteSettings(): RoleFitDesktopSiteSettings;
  applyLocalSitePort(port: number): Promise<RoleFitDesktopSiteSettings>;
  getExtensionPairingSettings(): Promise<RoleFitExtensionPairingSettings>;
  saveExtensionOrigin(origin: string): Promise<RoleFitExtensionPairingSettings>;
  removeExtensionOrigin(origin: string): Promise<RoleFitExtensionPairingSettings>;
  getProviderConnections(): Promise<readonly RoleFitProviderConnection[]>;
  saveApiProvider(
    provider: RoleFitApiProviderId,
    apiKey: string
  ): Promise<RoleFitProviderConnection>;
  removeProvider(provider: RoleFitProviderId): Promise<RoleFitProviderConnection>;
  setCliProviderEnabled(
    provider: RoleFitCliProviderId,
    enabled: boolean
  ): Promise<RoleFitProviderConnection>;
  openCliSignInTerminal(
    provider: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult>;
  openProviderInstallGuide(provider: RoleFitCliProviderId): Promise<void>;
  openBrowserApp(): Promise<void>;
  getWorkspaceOverview(): Promise<RoleFitWorkspaceOverview>;
  backupWorkspaceToFile(): Promise<RoleFitWorkspaceBackupResult>;
  restoreWorkspaceFromFile(): Promise<RoleFitWorkspaceRestoreResult>;
  openWorkspaceFolder(): Promise<void>;
  getConnectionStatus(): Promise<RoleFitConnectionStatus>;
};

const PROVIDER_METADATA = Object.freeze({
  "claude-cli": Object.freeze({ kind: "cli", setupFlow: "managed-login" }),
  "codex-cli": Object.freeze({ kind: "cli", setupFlow: "managed-login" }),
  "antigravity-cli": Object.freeze({ kind: "cli", setupFlow: "manual-login" }),
  openai: Object.freeze({ kind: "api", setupFlow: "api-key" }),
  anthropic: Object.freeze({ kind: "api", setupFlow: "api-key" })
} as const);

let companionHandlersInstalled = false;

export function isTrustedCompanionRequest(
  event: CompanionRequestEvent,
  companionUrl: string,
  trustedWebContentsId: number | null
): boolean {
  const frame = event.senderFrame;
  return trustedWebContentsId !== null &&
    event.sender.id === trustedWebContentsId &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isTrustedCompanionUrl(frame.url, companionUrl);
}

function requireTrustedRequest(
  event: IpcMainInvokeEvent,
  options: CompanionIpcOptions
): void {
  if (!isTrustedCompanionRequest(
    event,
    options.companionUrl,
    options.getTrustedWebContentsId()
  )) {
    throw new Error("Untrusted companion IPC sender.");
  }
}

function requireNoArguments(args: readonly unknown[], label: string): void {
  if (args.length !== 0) throw new Error(`${label} IPC does not accept arguments.`);
}

function requireApiKey(value: unknown): string {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey || Buffer.byteLength(apiKey, "utf8") > ROLEFIT_API_KEY_MAX_BYTES) {
    throw new Error("Invalid API credential.");
  }
  return apiKey;
}

function copyRuntimeInfo(info: RoleFitDesktopRuntimeInfo): RoleFitDesktopRuntimeInfo {
  return {
    apiVersion: info.apiVersion,
    runtime: info.runtime,
    platform: info.platform,
    appVersion: info.appVersion,
    electronVersion: info.electronVersion
  };
}

function requireLocalSitePort(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error("Local site port must be an integer from 1 through 65535.");
  }
  return value as number;
}

function requireExtensionOrigin(value: unknown): string {
  const origin = normalizeRoleFitExtensionOrigin(value);
  if (!origin) throw new Error("Invalid browser-extension origin.");
  return origin;
}

function copySiteSettings(settings: RoleFitDesktopSiteSettings): RoleFitDesktopSiteSettings {
  if (!settings || typeof settings !== "object" ||
      settings.schemaVersion !== ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION ||
      !Number.isInteger(settings.localSitePort) ||
      settings.localSitePort < 1 ||
      settings.localSitePort > 65_535 ||
      (settings.source !== "default" &&
        settings.source !== "saved" &&
        settings.source !== "environment") ||
      settings.locked !== (settings.source === "environment") ||
      (settings.warning !== null &&
        settings.warning !== "saved-settings-invalid" &&
        settings.warning !== "saved-settings-unreadable")) {
    throw new Error("Invalid local site settings.");
  }
  return {
    schemaVersion: ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
    localSitePort: settings.localSitePort,
    source: settings.source,
    locked: settings.locked,
    warning: settings.warning
  };
}

function copyExtensionPairingSettings(
  settings: RoleFitExtensionPairingSettings
): RoleFitExtensionPairingSettings {
  if (!settings || typeof settings !== "object" ||
      settings.schemaVersion !== ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION ||
      !Array.isArray(settings.origins) ||
      settings.origins.length > ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT ||
      !Array.isArray(settings.pendingOrigins) ||
      settings.pendingOrigins.length > ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT) {
    throw new Error("Invalid extension pairing settings.");
  }
  const origins = settings.origins.map(requireExtensionOrigin);
  if (new Set(origins).size !== origins.length) {
    throw new Error("Invalid extension pairing settings.");
  }
  const pendingOrigins = settings.pendingOrigins.map(requireExtensionOrigin);
  if (new Set(pendingOrigins).size !== pendingOrigins.length) {
    throw new Error("Invalid extension pairing settings.");
  }
  return {
    schemaVersion: ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
    origins,
    pendingOrigins
  };
}

function sanitizedSiteSettingsError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "ROLEFIT_DESKTOP_SETTINGS_LOCKED") {
    return new Error("ROLEFIT_DESKTOP_PORT controls this setting. Remove the override before changing it.");
  }
  if (code === "ROLEFIT_DESKTOP_PORT_UNAVAILABLE") {
    return new Error("That local site port is already in use. Choose another port.");
  }
  return new Error("The local site port could not be saved. Check app permissions and try again.");
}

function sanitizedExtensionPairingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("valid Chrome, Edge, or Firefox extension origin")) {
    return new Error("Enter the exact extension origin shown in the RoleFit browser popup.");
  }
  if (message.includes("up to")) {
    return new Error(`RoleFit supports up to ${ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT} paired browser extensions.`);
  }
  if (message.includes("standalone RoleFit server")) {
    return new Error("Stop the standalone RoleFit server, then reopen the companion before pairing the extension.");
  }
  if (message.includes("local site port 5181")) {
    return new Error("Browser extension pairing requires local site port 5181.");
  }
  if (message.includes("restart is already scheduled")) {
    return new Error("The companion is already restarting.");
  }
  return new Error("The browser extension pairing could not be saved. Check app permissions and try again.");
}

function isAuthState(value: unknown): value is RoleFitProviderConnection["authState"] {
  return value === "signed-in" ||
    value === "signed-out" ||
    value === "unknown" ||
    value === "not-applicable";
}

function copyProviderConnection(
  connection: RoleFitProviderConnection,
  expectedId?: RoleFitProviderId
): RoleFitProviderConnection {
  if (!connection || typeof connection !== "object" || !isRoleFitProviderId(connection.id)) {
    throw new Error("Invalid provider connection status.");
  }
  const metadata = PROVIDER_METADATA[connection.id];
  if ((expectedId !== undefined && connection.id !== expectedId) ||
      connection.kind !== metadata.kind ||
      connection.setupFlow !== metadata.setupFlow ||
      typeof connection.configured !== "boolean" ||
      typeof connection.ready !== "boolean" ||
      typeof connection.guidance !== "string" ||
      !isAuthState(connection.authState) ||
      (metadata.kind === "cli" && typeof connection.installed !== "boolean") ||
      (metadata.kind === "api" && connection.installed !== null) ||
      (metadata.kind === "api" && connection.authState !== "not-applicable")) {
    throw new Error("Invalid provider connection status.");
  }
  return {
    id: connection.id,
    kind: connection.kind,
    configured: connection.configured,
    ready: connection.ready,
    installed: connection.installed,
    authState: connection.authState,
    setupFlow: connection.setupFlow,
    guidance: connection.guidance.slice(0, ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH)
  };
}

function copyProviderConnections(
  connections: readonly RoleFitProviderConnection[]
): readonly RoleFitProviderConnection[] {
  if (!Array.isArray(connections) || connections.length !== ROLEFIT_PROVIDER_IDS.length) {
    throw new Error("Invalid provider connection list.");
  }
  const byId = new Map<RoleFitProviderId, RoleFitProviderConnection>();
  for (const connection of connections) {
    const copy = copyProviderConnection(connection);
    if (byId.has(copy.id)) throw new Error("Invalid provider connection list.");
    byId.set(copy.id, copy);
  }
  return ROLEFIT_PROVIDER_IDS.map((id) => {
    const connection = byId.get(id);
    if (!connection) throw new Error("Invalid provider connection list.");
    return connection;
  });
}

function copyTerminalSignInResult(
  result: RoleFitCliTerminalSignInResult
): RoleFitCliTerminalSignInResult {
  if (!result || typeof result !== "object" ||
      result.status !== "opened" ||
      typeof result.guidance !== "string") {
    throw new Error("Invalid CLI terminal sign-in result.");
  }
  return {
    status: "opened",
    guidance: result.guidance.slice(0, ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH)
  };
}

function requireWorkspacePathString(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || path.length > ROLEFIT_WORKSPACE_PATH_MAX_LENGTH) {
    throw new Error("Invalid workspace overview.");
  }
  return path;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function copyWorkspaceOverview(overview: RoleFitWorkspaceOverview): RoleFitWorkspaceOverview {
  if (!overview || typeof overview !== "object" ||
      typeof overview.serverReady !== "boolean" ||
      typeof overview.workspaceTransferReady !== "boolean" ||
      !isNullableCount(overview.activeBrowserTabs) ||
      typeof overview.hasBaseResume !== "boolean" ||
      !isNullableCount(overview.applicationCount)) {
    throw new Error("Invalid workspace overview.");
  }
  return {
    workspacePath: requireWorkspacePathString(overview.workspacePath),
    workspaceDisplayPath: requireWorkspacePathString(overview.workspaceDisplayPath),
    activeBrowserTabs: overview.activeBrowserTabs,
    serverReady: overview.serverReady,
    workspaceTransferReady: overview.workspaceTransferReady,
    hasBaseResume: overview.hasBaseResume,
    applicationCount: overview.applicationCount
  };
}

const CONNECTION_SITE_URL_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}$/;

function copyConnectionStatus(status: RoleFitConnectionStatus): RoleFitConnectionStatus {
  if (!status || typeof status !== "object" ||
      !Number.isInteger(status.port) ||
      status.port < 1 ||
      status.port > 65_535 ||
      typeof status.siteUrl !== "string" ||
      !CONNECTION_SITE_URL_RE.test(status.siteUrl) ||
      !isRoleFitConnectionServerState(status.serverState) ||
      !isNullableCount(status.activeBrowserTabs)) {
    throw new Error("Invalid connection status.");
  }
  return {
    port: status.port,
    siteUrl: status.siteUrl,
    serverState: status.serverState,
    activeBrowserTabs: status.activeBrowserTabs
  };
}

function requireWorkspaceMessage(value: unknown): string {
  const message = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!message) throw new Error("Invalid workspace operation message.");
  return message.slice(0, ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH);
}

function copyWorkspaceBackupResult(
  result: RoleFitWorkspaceBackupResult
): RoleFitWorkspaceBackupResult {
  if (!result || typeof result !== "object") {
    throw new Error("Invalid workspace backup result.");
  }
  if (result.status === "cancelled") return { status: "cancelled" };
  if (result.status === "error") {
    return { status: "error", message: requireWorkspaceMessage(result.message) };
  }
  if (result.status !== "saved" ||
      !isRoleFitWorkspaceBackupFileName(result.filePath) ||
      !Number.isSafeInteger(result.fileCount) ||
      result.fileCount < 0 ||
      typeof result.includesPreferences !== "boolean") {
    throw new Error("Invalid workspace backup result.");
  }
  return {
    status: "saved",
    filePath: result.filePath,
    fileCount: result.fileCount,
    includesPreferences: result.includesPreferences
  };
}

function copyWorkspaceRestoreResult(
  result: RoleFitWorkspaceRestoreResult
): RoleFitWorkspaceRestoreResult {
  if (!result || typeof result !== "object") {
    throw new Error("Invalid workspace restore result.");
  }
  if (result.status === "cancelled") return { status: "cancelled" };
  if (result.status === "error") {
    return { status: "error", message: requireWorkspaceMessage(result.message) };
  }
  if (result.status !== "restored" ||
      !Number.isSafeInteger(result.restoredFiles) ||
      result.restoredFiles < 0 ||
      typeof result.previousWorkspaceKept !== "boolean") {
    throw new Error("Invalid workspace restore result.");
  }
  return {
    status: "restored",
    restoredFiles: result.restoredFiles,
    previousWorkspaceKept: result.previousWorkspaceKept
  };
}

export function installCompanionIpc(options: CompanionIpcOptions): () => void {
  if (companionHandlersInstalled) {
    throw new Error("RoleFit companion IPC is already installed.");
  }

  const channels = [
    RoleFitDesktopIpcChannel.GetRuntimeInfo,
    RoleFitDesktopIpcChannel.GetLocalSiteSettings,
    RoleFitDesktopIpcChannel.ApplyLocalSitePort,
    RoleFitDesktopIpcChannel.GetExtensionPairingSettings,
    RoleFitDesktopIpcChannel.SaveExtensionOrigin,
    RoleFitDesktopIpcChannel.RemoveExtensionOrigin,
    RoleFitDesktopIpcChannel.GetProviderConnections,
    RoleFitDesktopIpcChannel.SaveApiProvider,
    RoleFitDesktopIpcChannel.RemoveProvider,
    RoleFitDesktopIpcChannel.SetCliProviderEnabled,
    RoleFitDesktopIpcChannel.OpenCliSignInTerminal,
    RoleFitDesktopIpcChannel.OpenProviderInstallGuide,
    RoleFitDesktopIpcChannel.OpenBrowserApp,
    RoleFitDesktopIpcChannel.GetWorkspaceOverview,
    RoleFitDesktopIpcChannel.BackupWorkspaceToFile,
    RoleFitDesktopIpcChannel.RestoreWorkspaceFromFile,
    RoleFitDesktopIpcChannel.OpenWorkspaceFolder,
    RoleFitDesktopIpcChannel.GetConnectionStatus
  ] as const;
  companionHandlersInstalled = true;
  try {
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetRuntimeInfo,
      (event: IpcMainInvokeEvent, ...args: RoleFitDesktopRuntimeInfoRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Runtime-info");
        return copyRuntimeInfo(options.getRuntimeInfo());
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetLocalSiteSettings,
      (event: IpcMainInvokeEvent, ...args: RoleFitDesktopSiteSettingsRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Local-site-settings");
        return copySiteSettings(options.getLocalSiteSettings());
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.ApplyLocalSitePort,
      async (event: IpcMainInvokeEvent, ...args: RoleFitApplyLocalSitePortRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1) {
          throw new Error("Apply-local-site-port IPC requires one port.");
        }
        const port = requireLocalSitePort(args[0]);
        try {
          return copySiteSettings(await options.applyLocalSitePort(port));
        } catch (error) {
          throw sanitizedSiteSettingsError(error);
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetExtensionPairingSettings,
      async (event: IpcMainInvokeEvent, ...args: RoleFitExtensionPairingSettingsRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Extension-pairing-settings");
        return copyExtensionPairingSettings(await options.getExtensionPairingSettings());
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.SaveExtensionOrigin,
      async (event: IpcMainInvokeEvent, ...args: RoleFitSaveExtensionOriginRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1) throw new Error("Save-extension-origin IPC requires one origin.");
        const origin = requireExtensionOrigin(args[0]);
        try {
          return copyExtensionPairingSettings(await options.saveExtensionOrigin(origin));
        } catch (error) {
          throw sanitizedExtensionPairingError(error);
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.RemoveExtensionOrigin,
      async (event: IpcMainInvokeEvent, ...args: RoleFitRemoveExtensionOriginRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1) throw new Error("Remove-extension-origin IPC requires one origin.");
        const origin = requireExtensionOrigin(args[0]);
        try {
          return copyExtensionPairingSettings(await options.removeExtensionOrigin(origin));
        } catch (error) {
          throw sanitizedExtensionPairingError(error);
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetProviderConnections,
      async (event: IpcMainInvokeEvent, ...args: RoleFitProviderConnectionsRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Provider connections");
        return copyProviderConnections(await options.getProviderConnections());
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.SaveApiProvider,
      async (event: IpcMainInvokeEvent, ...args: RoleFitSaveApiProviderRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 2 || !isRoleFitApiProviderId(args[0])) {
          throw new Error("Invalid API-provider save request.");
        }
        const apiKey = requireApiKey(args[1]);
        try {
          return copyProviderConnection(
            await options.saveApiProvider(args[0], apiKey),
            args[0]
          );
        } catch {
          throw new Error("Unable to save API provider.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.RemoveProvider,
      async (event: IpcMainInvokeEvent, ...args: RoleFitRemoveProviderRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1 || !isRoleFitProviderId(args[0])) {
          throw new Error("Invalid provider removal request.");
        }
        return copyProviderConnection(await options.removeProvider(args[0]), args[0]);
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.SetCliProviderEnabled,
      async (event: IpcMainInvokeEvent, ...args: RoleFitSetCliProviderEnabledRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 2 ||
            !isRoleFitCliProviderId(args[0]) ||
            typeof args[1] !== "boolean") {
          throw new Error("Invalid CLI-provider configuration request.");
        }
        return copyProviderConnection(
          await options.setCliProviderEnabled(args[0], args[1]),
          args[0]
        );
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.OpenCliSignInTerminal,
      async (event: IpcMainInvokeEvent, ...args: RoleFitOpenCliSignInTerminalRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1 || !isRoleFitCliProviderId(args[0])) {
          throw new Error("Invalid CLI provider id.");
        }
        try {
          return copyTerminalSignInResult(await options.openCliSignInTerminal(args[0]));
        } catch {
          throw new Error("Unable to open CLI sign-in in a terminal.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.OpenProviderInstallGuide,
      async (event: IpcMainInvokeEvent, ...args: RoleFitOpenProviderInstallGuideRequest) => {
        requireTrustedRequest(event, options);
        if (args.length !== 1 || !isRoleFitCliProviderId(args[0])) {
          throw new Error("Invalid CLI provider id.");
        }
        await options.openProviderInstallGuide(args[0]);
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.OpenBrowserApp,
      async (event: IpcMainInvokeEvent, ...args: RoleFitOpenBrowserAppRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Open-browser");
        await options.openBrowserApp();
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetWorkspaceOverview,
      async (event: IpcMainInvokeEvent, ...args: RoleFitWorkspaceOverviewRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Workspace-overview");
        try {
          return copyWorkspaceOverview(await options.getWorkspaceOverview());
        } catch {
          throw new Error("The workspace overview is unavailable.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.BackupWorkspaceToFile,
      async (event: IpcMainInvokeEvent, ...args: RoleFitBackupWorkspaceToFileRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Workspace-backup");
        try {
          return copyWorkspaceBackupResult(await options.backupWorkspaceToFile());
        } catch {
          throw new Error("The workspace backup did not complete. Try again.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.RestoreWorkspaceFromFile,
      async (event: IpcMainInvokeEvent, ...args: RoleFitRestoreWorkspaceFromFileRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Workspace-restore");
        try {
          return copyWorkspaceRestoreResult(await options.restoreWorkspaceFromFile());
        } catch {
          throw new Error("The workspace restore did not complete. Try again.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.OpenWorkspaceFolder,
      async (event: IpcMainInvokeEvent, ...args: RoleFitOpenWorkspaceFolderRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Open-workspace-folder");
        try {
          await options.openWorkspaceFolder();
        } catch {
          throw new Error("The workspace folder could not be opened.");
        }
      }
    );
    options.ipc.handle(
      RoleFitDesktopIpcChannel.GetConnectionStatus,
      async (event: IpcMainInvokeEvent, ...args: RoleFitConnectionStatusRequest) => {
        requireTrustedRequest(event, options);
        requireNoArguments(args, "Connection-status");
        try {
          return copyConnectionStatus(await options.getConnectionStatus());
        } catch {
          throw new Error("The connection status is unavailable.");
        }
      }
    );
  } catch (error) {
    for (const channel of channels) options.ipc.removeHandler(channel);
    companionHandlersInstalled = false;
    throw error;
  }

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const channel of channels) options.ipc.removeHandler(channel);
    companionHandlersInstalled = false;
  };
}
