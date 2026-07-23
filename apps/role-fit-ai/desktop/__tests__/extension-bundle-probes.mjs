import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ROLEFIT_EXTENSION_DIRECTORY_NAME,
  materializeRoleFitExtension
} from "../../dist-electron/desktop/extension-bundle.cjs";

const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-extension-bundle-"));
const sourceDirectory = join(tempRoot, "package-extension");
const userDataDirectory = join(tempRoot, "user-data");
const extensionFiles = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon.svg"
];

try {
  for (const file of extensionFiles) {
    const path = join(sourceDirectory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `bundled:${file}`, "utf8");
  }
  await writeFile(join(sourceDirectory, "README.md"), "not shipped", "utf8");

  const destination = await materializeRoleFitExtension({
    sourceDirectory,
    userDataDirectory
  });
  assert.equal(destination, join(userDataDirectory, ROLEFIT_EXTENSION_DIRECTORY_NAME));
  for (const file of extensionFiles) {
    assert.equal(await readFile(join(destination, file), "utf8"), `bundled:${file}`);
  }

  await assert.rejects(
    materializeRoleFitExtension({
      sourceDirectory: join(tempRoot, "missing-extension"),
      userDataDirectory
    }),
    /missing manifest\.json/
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("desktop browser-extension bundle probes: passed");
