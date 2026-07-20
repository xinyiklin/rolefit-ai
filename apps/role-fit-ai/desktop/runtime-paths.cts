import { isAbsolute, join, resolve } from "node:path";

export type DesktopRuntimePathOptions = Readonly<{
  packaged: boolean;
  sourceAppRoot: string;
  packagedAppRoot: string;
  userDataDirectory: string;
  workspaceOverride?: string;
}>;

export type DesktopRuntimePaths = Readonly<{
  appRoot: string;
  serverEntry: string;
  serverCwd: string;
  workspaceDir: string;
}>;

function requireAbsolutePath(label: string, value: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}

export function resolveDesktopRuntimePaths(
  options: DesktopRuntimePathOptions
): DesktopRuntimePaths {
  const sourceAppRoot = requireAbsolutePath("RoleFit source root", options.sourceAppRoot);
  const packagedAppRoot = requireAbsolutePath("RoleFit packaged root", options.packagedAppRoot);
  const userDataDirectory = requireAbsolutePath(
    "RoleFit user-data directory",
    options.userDataDirectory
  );
  const appRoot = options.packaged ? packagedAppRoot : sourceAppRoot;
  const workspaceDir = options.workspaceOverride
    ? requireAbsolutePath("ROLEFIT_WORKSPACE_DIR", options.workspaceOverride)
    : options.packaged
      ? join(userDataDirectory, "workspace")
      : join(appRoot, "job-search-workspace");

  return Object.freeze({
    appRoot,
    serverEntry: options.packaged
      ? join(appRoot, "dist-electron", "server", "server.mjs")
      : join(appRoot, "server.ts"),
    // ASAR resources are read-only and cannot be a child-process working
    // directory. Packaged children use userData while still reading static
    // application assets from appRoot.
    serverCwd: options.packaged ? userDataDirectory : appRoot,
    workspaceDir
  });
}
