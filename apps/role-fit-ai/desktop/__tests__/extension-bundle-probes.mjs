import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EXTENSION_FILES,
  ROLEFIT_EXTENSION_DIRECTORY_NAME,
  createRoleFitExtensionRuntimeConfig,
  materializeRoleFitExtension
} from "../../dist-electron/desktop/extension-bundle.cjs";

const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-extension-bundle-"));
const sourceDirectory = join(tempRoot, "package-extension");
const userDataDirectory = join(tempRoot, "user-data");
// The shipped set comes from the module under test, so this probe cannot drift
// from what actually gets materialized.
const extensionFiles = [...EXTENSION_FILES];
assert.ok(extensionFiles.includes("manifest.json"), "the shipped set must include the manifest");
assert.ok(extensionFiles.includes("runtime-config.js"), "the shipped set must include the port seed");

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
  assert.match(
    await readFile(join(destination, "runtime-config.js"), "utf8"),
    /First-install seed only; settings\.js reads chrome\.storage\.local/
  );

  // A file from an earlier allowlist must not survive a refresh: the browser
  // loads this directory, so a retired module would keep being served.
  await writeFile(join(destination, "runtime-resolver.js"), "retired", "utf8");
  await mkdir(join(destination, "legacy"), { recursive: true });
  await writeFile(join(destination, "legacy", "old.js"), "retired", "utf8");
  await materializeRoleFitExtension({
    sourceDirectory,
    userDataDirectory,
    localSitePort: 5_183
  });
  await assert.rejects(readFile(join(destination, "runtime-resolver.js"), "utf8"), /ENOENT/);
  await assert.rejects(readFile(join(destination, "legacy", "old.js"), "utf8"), /ENOENT/);
  for (const file of extensionFiles) {
    assert.ok(await readFile(join(destination, file), "utf8"), `${file} survives the prune`);
  }

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
