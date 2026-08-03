import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Every file the browser loads, and the only definition of that set. The
 * packaged-bundle probe imports this list and the extension source contract
 * parses it, so a new shipped file cannot reach one consumer and miss another —
 * the drift that once materialized an extension whose popup could not load.
 */
export const EXTENSION_FILES = Object.freeze([
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "background.js",
  "bridge.js",
  "settings.js",
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
    "// First-install seed only; settings.js reads chrome.storage.local before using this value.",
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
 * Remove anything in the materialized directory that is not part of the current
 * allowlist. A copy-only refresh leaves files from an earlier file set behind,
 * and a browser loading that directory would keep serving them — a retired
 * module can outlive the release that dropped it.
 */
async function readDirectoryEntries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    // A directory that does not exist yet has nothing to prune. Anything else
    // (a permission failure, an unreadable volume) means retired files may still
    // be served, so it fails the refresh instead of passing quietly.
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

async function pruneRetiredFiles(
  extensionDirectory: string,
  keep: ReadonlySet<string>,
  relativeDirectory = ""
): Promise<void> {
  const entries = await readDirectoryEntries(join(extensionDirectory, relativeDirectory));
  for (const entry of entries) {
    // Allowlist keys are always "/"-joined, so they compare identically on Windows.
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await pruneRetiredFiles(extensionDirectory, keep, relativePath);
      const remaining = await readDirectoryEntries(join(extensionDirectory, relativePath));
      if (!remaining.length) await rm(join(extensionDirectory, relativePath), { recursive: true });
      continue;
    }
    if (!keep.has(relativePath)) {
      await rm(join(extensionDirectory, relativePath), { force: true });
    }
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
  await pruneRetiredFiles(extensionDirectory, new Set(EXTENSION_FILES));

  return extensionDirectory;
}
