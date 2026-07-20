import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(appRoot, "dist-landing");

function fail(message) {
  throw new Error(`RoleFit public landing build: ${message}`);
}

const indexHtml = await readFile(join(outputRoot, "index.html"), "utf8").catch(() => null);
if (!indexHtml) fail("dist-landing/index.html is missing");
if (!indexHtml.includes("data-rolefit-public-landing")) {
  fail("the public landing marker is missing");
}
if (
  !indexHtml.includes("Your workspace stays on this machine.") ||
  !indexHtml.includes("goes directly to the provider")
) {
  fail("the public landing must disclose both local workspace storage and direct provider input");
}
if (indexHtml.includes("Everything stays on your machine")) {
  fail("the public landing contains an overbroad local-only privacy claim");
}
if (indexHtml.includes("/src/main.tsx") || indexHtml.includes("fonts.googleapis.com")) {
  fail("the built page contains a source entry or external font dependency");
}

const manifest = JSON.parse(
  await readFile(join(outputRoot, ".vite", "manifest.json"), "utf8"),
);
const entries = Object.values(manifest).filter((entry) => entry?.isEntry === true);
if (entries.length !== 1 || entries[0].src !== "index.html") {
  fail("the build must contain exactly one landing/index.html entry");
}

const entryPath = join(outputRoot, entries[0].file);
const entryInfo = await stat(entryPath).catch(() => null);
if (!entryInfo?.isFile() || entryInfo.size <= 0) fail("the landing JavaScript entry is missing");
const javascriptFiles = (await readdir(join(outputRoot, "assets"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => join(outputRoot, "assets", entry.name));
if (javascriptFiles.length !== 1) {
  fail(`the landing must emit exactly one JavaScript chunk; found ${javascriptFiles.length}`);
}

const textAssets = [
  { path: join(outputRoot, "index.html"), source: indexHtml },
  ...await Promise.all(javascriptFiles.map(async (path) => ({
    path,
    source: await readFile(path, "utf8"),
  }))),
];

for (const asset of textAssets) {
  for (const [label, pattern] of [
    ["numeric-loopback origin", /https?:\/\/(?:localhost|127\.0\.0\.1)/],
    ["RoleFit product API path", /["'`]\/api\//],
    ["Drafting Desk storage marker", /rolefit:documentTitle/],
  ]) {
    if (pattern.test(asset.source)) {
      fail(`the public bundle contains a forbidden ${label} in ${asset.path}`);
    }
  }
}

console.log("RoleFit public landing build boundary: passed");
