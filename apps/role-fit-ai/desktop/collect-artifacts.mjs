import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(desktopRoot, "..");
const makeRoot = join(appRoot, ".forge", "out", "make");
const releaseRoot = join(appRoot, ".forge", "release");

function fail(message) {
  throw new Error(`RoleFit artifact collection: ${message}`);
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    const match = /^--(arch|platform|checksums)=(.+)$/.exec(argument);
    if (!match) fail(`unsupported argument ${argument}`);
    if (values.has(match[1])) fail(`duplicate --${match[1]} argument`);
    values.set(match[1], match[2]);
  }
  const platform = values.get("platform");
  const arch = values.get("arch");
  if ((platform !== "darwin" && platform !== "win32") ||
      (arch !== "arm64" && arch !== "x64") ||
      (platform === "win32" && arch !== "x64")) {
    fail(`unsupported target ${platform ?? "missing"}/${arch ?? "missing"}`);
  }
  const checksumsValue = values.get("checksums") ?? "true";
  if (checksumsValue !== "true" && checksumsValue !== "false") {
    fail("--checksums must be true or false");
  }
  return { platform, arch, checksums: checksumsValue === "true" };
}

async function requireRegularFile(path) {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
    fail(`expected a non-empty regular file at ${path}`);
  }
  return path;
}

async function findOnlyFile(directory, predicate, label) {
  const directoryInfo = await stat(directory).catch(() => null);
  if (!directoryInfo?.isDirectory()) fail(`maker output directory is missing: ${directory}`);
  const matches = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) fail(`symbolic link found in maker output: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && predicate(path)) matches.push(path);
    }
  }
  await visit(directory);
  if (matches.length !== 1) {
    fail(`expected exactly one ${label}; found ${matches.length}`);
  }
  return requireRegularFile(matches[0]);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { platform, arch, checksums } = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  const version = packageJson.version;
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    fail("package version must be canonical X.Y.Z");
  }

  const artifacts = [];
  if (platform === "darwin") {
    const dmg = await requireRegularFile(
      join(makeRoot, `RoleFit Local Companion-${version}-${arch}.dmg`)
    );
    const zip = await requireRegularFile(
      join(
        makeRoot,
        "zip",
        "darwin",
        arch,
        `RoleFit Local Companion-darwin-${arch}-${version}.zip`
      )
    );
    artifacts.push(
      [dmg, `RoleFit-Local-Companion-${version}-macos-${arch}.dmg`],
      [zip, `RoleFit-Local-Companion-${version}-macos-${arch}.zip`]
    );
  } else {
    const squirrelRoot = join(makeRoot, "squirrel.windows", arch);
    const setup = await findOnlyFile(
      squirrelRoot,
      (path) => basename(path) === "RoleFit-Local-Companion-Setup.exe",
      "Squirrel setup executable"
    );
    artifacts.push([
      setup,
      `RoleFit-Local-Companion-${version}-windows-${arch}.exe`
    ]);
  }

  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });
  for (const [source, name] of artifacts) {
    await cp(source, join(releaseRoot, name), { errorOnExist: true, force: false });
  }
  if (checksums) {
    const lines = [];
    for (const [, name] of artifacts) {
      lines.push(`${await sha256(join(releaseRoot, name))}  ${name}`);
    }
    await writeFile(join(releaseRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
  }
  console.log(
    `Collected ${artifacts.length} ${platform}/${arch} release artifact(s)${checksums ? " with SHA-256 checksums" : ""} in ${releaseRoot}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
