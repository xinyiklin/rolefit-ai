import type { BrowserWindow, Session } from "electron";

function parseUrl(value: string): URL | null {
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isTrustedCompanionUrl(candidate: string, companionUrl: string): boolean {
  const url = parseUrl(candidate);
  const expected = parseUrl(companionUrl);
  return Boolean(
    url &&
      expected &&
      url.protocol === "file:" &&
      expected.protocol === "file:" &&
      url.href === expected.href
  );
}

export function isAllowedRendererPermission(_permission: string): boolean {
  return false;
}

export function installSessionSecurity(session: Session): () => void {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(() => false);

  return () => {
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
    session.setDevicePermissionHandler(null);
  };
}

export function hardenWindow(
  window: BrowserWindow,
  companionUrl: string
): void {
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => {
    if (!isTrustedCompanionUrl(event.url, companionUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  // External navigation is never renderer-directed. The only legitimate
  // launches are fixed main-owned targets reached through typed IPC: the
  // canonical local RoleFit origin and the three official CLI install guides.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
