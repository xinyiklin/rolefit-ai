import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ROLEFIT_EXTENSION_DIRECTORY_NAME,
  createRoleFitExtensionRuntimeConfig,
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
  "runtime-config.js",
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
    userDataDirectory,
    localSitePort: 5_183
  });
  assert.equal(destination, join(userDataDirectory, ROLEFIT_EXTENSION_DIRECTORY_NAME));
  for (const file of extensionFiles.filter((file) => file !== "runtime-config.js")) {
    assert.equal(await readFile(join(destination, file), "utf8"), `bundled:${file}`);
  }
  assert.equal(
    await readFile(join(destination, "runtime-config.js"), "utf8"),
    createRoleFitExtensionRuntimeConfig(5_183)
  );
  assert.match(
    await readFile(join(destination, "runtime-config.js"), "utf8"),
    /localSitePort: 5183/
  );

  await assert.rejects(
    materializeRoleFitExtension({
      sourceDirectory: join(tempRoot, "missing-extension"),
      userDataDirectory,
      localSitePort: 5_181
    }),
    /missing manifest\.json/
  );
  for (const invalidPort of [0, 65_536, 5_181.5, Number.NaN]) {
    assert.throws(
      () => createRoleFitExtensionRuntimeConfig(invalidPort),
      /integer from 1 through 65535/
    );
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("desktop browser-extension bundle probes: passed");
