import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const EXTENSION_FILES = Object.freeze([
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon.svg"
] as const);

export const ROLEFIT_EXTENSION_DIRECTORY_NAME = "browser-extension";

export type ExtensionBundleOptions = Readonly<{
  sourceDirectory: string;
  userDataDirectory: string;
}>;

function requireContainedDirectory(parentDirectory: string, childDirectory: string): void {
  const parent = resolve(parentDirectory);
  const child = resolve(childDirectory);
  const pathFromParent = relative(parent, child);
  if (!pathFromParent || pathFromParent === ".." || pathFromParent.startsWith(`..${sep}`)) {
    throw new Error("RoleFit extension directory must stay within the app data directory.");
  }
}

/**
 * Browser extension loaders need ordinary files, so package the fixed static
 * extension in the app and materialize it beneath Electron userData. The
 * renderer never receives this path or controls the copied file set.
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

  return extensionDirectory;
}
