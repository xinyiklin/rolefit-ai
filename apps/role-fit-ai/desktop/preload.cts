import type {
  RoleFitApiProviderId,
  RoleFitCliProviderId,
  RoleFitConnectionStatus,
  RoleFitCliTerminalSignInResult,
  RoleFitDesktopApi,
  RoleFitDesktopRuntimeInfo,
  RoleFitDesktopSiteSettings,
  RoleFitExtensionPairingSettings,
  RoleFitProviderConnection,
  RoleFitProviderId,
  RoleFitWorkspaceBackupResult,
  RoleFitWorkspaceOverview,
  RoleFitWorkspaceRestoreResult
} from "./ipc-contract.cjs";
import {
  RoleFitDesktopBridge,
  RoleFitDesktopIpcChannel
} from "./ipc-contract.cjs";
import { contextBridge, ipcRenderer } from "electron";

const desktopApi: RoleFitDesktopApi = Object.freeze({
  getRuntimeInfo: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetRuntimeInfo
    ) as Promise<RoleFitDesktopRuntimeInfo>,
  getLocalSiteSettings: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetLocalSiteSettings
    ) as Promise<RoleFitDesktopSiteSettings>,
  applyLocalSitePort: (port: number) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.ApplyLocalSitePort,
      port
    ) as Promise<RoleFitDesktopSiteSettings>,
  getExtensionPairingSettings: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetExtensionPairingSettings
    ) as Promise<RoleFitExtensionPairingSettings>,
  saveExtensionOrigin: (origin: string) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.SaveExtensionOrigin,
      origin
    ) as Promise<RoleFitExtensionPairingSettings>,
  removeExtensionOrigin: (origin: string) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.RemoveExtensionOrigin,
      origin
    ) as Promise<RoleFitExtensionPairingSettings>,
  getProviderConnections: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetProviderConnections
    ) as Promise<readonly RoleFitProviderConnection[]>,
  saveApiProvider: (provider: RoleFitApiProviderId, apiKey: string) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.SaveApiProvider,
      provider,
      apiKey
    ) as Promise<RoleFitProviderConnection>,
  removeProvider: (provider: RoleFitProviderId) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.RemoveProvider,
      provider
    ) as Promise<RoleFitProviderConnection>,
  setCliProviderEnabled: (provider: RoleFitCliProviderId, enabled: boolean) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.SetCliProviderEnabled,
      provider,
      enabled
    ) as Promise<RoleFitProviderConnection>,
  openCliSignInTerminal: (provider: RoleFitCliProviderId) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.OpenCliSignInTerminal,
      provider
    ) as Promise<RoleFitCliTerminalSignInResult>,
  openProviderInstallGuide: (provider: RoleFitCliProviderId) =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.OpenProviderInstallGuide,
      provider
    ) as Promise<void>,
  openExtensionDirectory: () =>
    ipcRenderer.invoke(RoleFitDesktopIpcChannel.OpenExtensionDirectory) as Promise<void>,
  openBrowserApp: () =>
    ipcRenderer.invoke(RoleFitDesktopIpcChannel.OpenBrowserApp) as Promise<void>,
  getWorkspaceOverview: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetWorkspaceOverview
    ) as Promise<RoleFitWorkspaceOverview>,
  backupWorkspaceToFile: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.BackupWorkspaceToFile
    ) as Promise<RoleFitWorkspaceBackupResult>,
  restoreWorkspaceFromFile: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.RestoreWorkspaceFromFile
    ) as Promise<RoleFitWorkspaceRestoreResult>,
  openWorkspaceFolder: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.OpenWorkspaceFolder
    ) as Promise<void>,
  getConnectionStatus: () =>
    ipcRenderer.invoke(
      RoleFitDesktopIpcChannel.GetConnectionStatus
    ) as Promise<RoleFitConnectionStatus>
});

contextBridge.exposeInMainWorld(RoleFitDesktopBridge.GlobalKey, desktopApi);
