import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const EXTENSION_FILES = Object.freeze([
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "runtime-config.js",
  "icons/icon.svg"
] as const);

export const ROLEFIT_EXTENSION_DIRECTORY_NAME = "browser-extension";

export type ExtensionBundleOptions = Readonly<{
  sourceDirectory: string;
  userDataDirectory: string;
  localSitePort: number;
}>;

export function createRoleFitExtensionRuntimeConfig(localSitePort: number): string {
  if (!Number.isInteger(localSitePort) || localSitePort < 1 || localSitePort > 65_535) {
    throw new Error("RoleFit extension port must be an integer from 1 through 65535.");
  }
  return [
    "globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = Object.freeze({",
    "  schemaVersion: 1,",
    `  localSitePort: ${localSitePort}`,
    "});",
    ""
  ].join("\n");
}

function requireContainedDirectory(parentDirectory: string, childDirectory: string): void {
  const parent = resolve(parentDirectory);
  const child = resolve(childDirectory);
  const pathFromParent = relative(parent, child);
  if (!pathFromParent || pathFromParent === ".." || pathFromParent.startsWith(`..${sep}`)) {
    throw new Error("RoleFit extension directory must stay within the app data directory.");
  }
}

/**
 * Browser extension loaders need ordinary files, so materialize the fixed
 * allowlist beneath Electron userData and replace only its runtime port config.
 * The renderer never receives this path or controls the copied file set.
 */
export async function materializeRoleFitExtension(
  options: ExtensionBundleOptions
): Promise<string> {
  const sourceDirectory = resolve(options.sourceDirectory);
  const extensionDirectory = join(resolve(options.userDataDirectory), ROLEFIT_EXTENSION_DIRECTORY_NAME);
  requireContainedDirectory(options.userDataDirectory, extensionDirectory);

  for (const file of EXTENSION_FILES) {
    const sourcePath = join(sourceDirectory, file);
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`RoleFit packaged extension is missing ${file}.`);
    }
    const destinationPath = join(extensionDirectory, file);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
  await writeFile(
    join(extensionDirectory, "runtime-config.js"),
    createRoleFitExtensionRuntimeConfig(options.localSitePort),
    "utf8"
  );

  return extensionDirectory;
}
