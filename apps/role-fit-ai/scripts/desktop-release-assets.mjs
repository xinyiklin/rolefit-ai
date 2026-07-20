import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRolefitReleaseVersion } from "./desktop-release-contract.mjs";

const PRODUCT_ASSET_PREFIX = "RoleFit-AI";

function fail(message) {
  throw new Error(`RoleFit release assets: ${message}`);
}

export function expectedTargetAssets(version, platform, arch) {
  assertRolefitReleaseVersion(version);

  if (platform === "macos" && (arch === "arm64" || arch === "x64")) {
    const stem = `${PRODUCT_ASSET_PREFIX}-${version}-macos-${arch}`;
    return [`${stem}.dmg`, `${stem}.zip`];
  }
  if (platform === "windows" && arch === "x64") {
    return [`${PRODUCT_ASSET_PREFIX}-${version}-windows-x64.exe`];
  }

  fail(`unsupported release target ${platform}/${arch}`);
}

export function expectedReleaseAssets(version) {
  return [
    ...expectedTargetAssets(version, "macos", "arm64"),
    ...expectedTargetAssets(version, "macos", "x64"),
    ...expectedTargetAssets(version, "windows", "x64"),
  ];
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic links are not release assets: ${path}`);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, path)));
      continue;
    }
    if (!entry.isFile()) fail(`unsupported filesystem entry in release assets: ${path}`);
    files.push(path);
  }

  return files;
}

export async function verifyReleaseAssets(root, expectedNames) {
  const absoluteRoot = resolve(root);
  const rootInfo = await lstat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) fail(`asset root is not a directory: ${absoluteRoot}`);

  const expected = new Set(expectedNames);
  if (expected.size !== expectedNames.length) fail("expected asset contract contains duplicate names");

  const paths = await walkFiles(absoluteRoot);
  const byName = new Map();

  for (const path of paths) {
    const name = basename(path);
    if (byName.has(name)) {
      fail(`duplicate asset name ${name} at ${byName.get(name)} and ${path}`);
    }
    if (!expected.has(name)) fail(`unexpected asset ${name}`);

    const info = await stat(path);
    if (info.size <= 0) fail(`asset is empty: ${name}`);
    byName.set(name, path);
  }

  const missing = expectedNames.filter((name) => !byName.has(name));
  if (missing.length > 0) fail(`missing assets: ${missing.join(", ")}`);
  if (byName.size !== expected.size) fail("asset count does not match the release contract");

  return expectedNames.map((name) => ({ name, path: byName.get(name) }));
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function writeReleaseChecksums(assets, outputPath) {
  const names = new Set();
  const lines = [];

  for (const asset of assets) {
    if (names.has(asset.name)) fail(`cannot checksum duplicate asset name ${asset.name}`);
    names.add(asset.name);
    lines.push(`${await sha256(asset.path)}  ${asset.name}`);
  }

  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
  return absoluteOutput;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`unexpected argument ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    if (key in values) fail(`duplicate argument --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const allowed = new Set(["version", "platform", "arch", "root"]);
  const unexpected = Object.keys(args).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) fail(`unknown arguments: ${unexpected.join(", ")}`);
  if (!args.version || !args.platform || !args.arch || !args.root) {
    fail("--version, --platform, --arch, and --root are required");
  }

  const expected = expectedTargetAssets(args.version, args.platform, args.arch);
  await verifyReleaseAssets(args.root, expected);
  console.log(`Verified ${expected.length} ${args.platform}/${args.arch} release asset(s).`);
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
