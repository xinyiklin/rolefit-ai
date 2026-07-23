import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const stageRoot = join(appRoot, ".forge", "app");

async function filesUnder(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(directory, path).split(sep).join("/"));
      else throw new Error(`Unexpected staged package entry: ${path}`);
    }
  }
  await visit(directory);
  return files.sort();
}

const files = await filesUnder(stageRoot);
assert(files.includes("package.json"));
assert(files.includes("LICENSE"));
assert(files.includes("dist/index.html"));
assert(files.some((file) => /^dist\/assets\/.*\.js$/.test(file)));
assert(files.includes("dist/fonts/LMRoman10-Regular.woff2"));
assert(files.includes("dist-electron/desktop/main.cjs"));
assert(files.includes("dist-electron/desktop/preload.cjs"));
assert(files.includes("dist-electron/desktop/companion.html"));
assert(files.includes("dist-electron/server/server.mjs"));
assert(files.includes("server/starter.resume"));
assert(files.includes("extension/manifest.json"));
assert(files.includes("extension/popup.html"));
assert(files.includes("extension/popup.css"));
assert(files.includes("extension/popup.js"));
assert(files.includes("extension/icons/icon.svg"));

const allowedRoots = new Set([
  "LICENSE",
  "assets",
  "dist",
  "dist-electron",
  "extension",
  "forge.config.cjs",
  "package.json",
  "server"
]);
for (const file of files) {
  assert(allowedRoots.has(file.split("/", 1)[0]), `unexpected staged root: ${file}`);
  assert(!/(^|\/)\.env(?:\.|$)/.test(file), `secret file staged: ${file}`);
  assert(!/(^|\/)(?:job-search-workspace|provider-vault|workspace)(?:\/|$)/.test(file), `local data staged: ${file}`);
  assert(!/(^|\/)__tests__(?:\/|$)/.test(file), `test staged: ${file}`);
  assert(!/\.map$/i.test(file), `source map staged: ${file}`);
  if (file.endsWith(".resume")) {
    assert.equal(file, "server/starter.resume", `personal resume staged: ${file}`);
  }
}

const manifest = JSON.parse(await readFile(join(stageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "rolefit-local-companion");
assert.equal(manifest.productName, "RoleFit AI");
assert.equal(manifest.main, "dist-electron/desktop/main.cjs");
assert.equal(manifest.license, "MIT");
assert.equal(manifest.config.forge, "./forge.config.cjs");
assert.deepEqual(manifest.dependencies, undefined);
assert.deepEqual(Object.keys(manifest.devDependencies), ["electron"]);

const bundleMeta = JSON.parse(
  await readFile(join(appRoot, ".forge", "bundle-metafile.json"), "utf8")
);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
]);
for (const [bundleName, metafile] of Object.entries(bundleMeta)) {
  const externalImports = Object.values(metafile.outputs)
    .flatMap((output) => output.imports ?? [])
    .filter((entry) => entry.external)
    .map((entry) => entry.path);
  for (const imported of externalImports) {
    assert(
      imported === "electron" || builtins.has(imported),
      `${bundleName} retains unsupported runtime dependency: ${imported}`
    );
  }
}

for (const file of [
  "dist-electron/desktop/main.cjs",
  "dist-electron/desktop/preload.cjs",
  "dist-electron/server/server.mjs"
]) {
  const path = join(stageRoot, file);
  assert((await stat(path)).size > 1_000, `${file} is unexpectedly empty`);
  assert.doesNotMatch(await readFile(path, "utf8"), /sourceMappingURL=/);
}

console.log(`desktop package layout probes: passed (${files.length} staged files)`);
