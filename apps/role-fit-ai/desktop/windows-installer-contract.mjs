import { win32 } from "node:path";

export const WINDOWS_SQUIRREL_PACKAGE_ID = "RoleFitLocalCompanion";
export const WINDOWS_EXECUTABLE_NAME = "RoleFitLocalCompanion.exe";

const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(`RoleFit Windows installer contract: ${message}`);
}

export function resolveWindowsSquirrelPaths(localAppData, version) {
  if (typeof localAppData !== "string" ||
      !win32.isAbsolute(localAppData) ||
      localAppData.includes("\0")) {
    fail("LOCALAPPDATA must be an absolute Windows path");
  }
  if (!RELEASE_VERSION_PATTERN.test(version ?? "")) {
    fail("package version must be canonical X.Y.Z");
  }

  const installRoot = win32.join(localAppData, WINDOWS_SQUIRREL_PACKAGE_ID);
  const versionDirectory = win32.join(installRoot, `app-${version}`);
  return Object.freeze({
    installRoot,
    versionDirectory,
    executable: win32.join(versionDirectory, WINDOWS_EXECUTABLE_NAME),
    updater: win32.join(installRoot, "Update.exe"),
    tombstone: win32.join(installRoot, ".dead")
  });
}
