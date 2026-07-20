import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const stageRoot = resolve(desktopRoot, "..", ".forge", "app");

function fail(message) {
  throw new Error(`RoleFit desktop packaging: ${message}`);
}

function parseTarget(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    const match = /^--(arch|platform)=(.+)$/.exec(argument);
    if (!match) fail(`unsupported argument ${argument}`);
    if (values.has(match[1])) fail(`duplicate --${match[1]} argument`);
    values.set(match[1], match[2]);
  }

  const platform = values.get("platform") ?? process.platform;
  const arch = values.get("arch") ?? process.arch;
  if (platform !== "darwin" && platform !== "win32") {
    fail("only native macOS and Windows targets are supported");
  }
  if (arch !== "arm64" && arch !== "x64") {
    fail("only arm64 and x64 targets are supported");
  }
  if (platform === "win32" && arch !== "x64") {
    fail("the Windows release target is x64");
  }
  if (platform !== process.platform || arch !== process.arch) {
    fail(
      `target ${platform}/${arch} must run on a matching native host; current host is ${process.platform}/${process.arch}`
    );
  }
  return { platform, arch };
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".", 1)[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22 || nodeMajor > 24) {
    fail(
      `Node ${process.versions.node} is outside the accepted Forge range. Use Node 24 LTS (verified; Node 22-24 is accepted).`
    );
  }

  const [command, ...argumentsList] = process.argv.slice(2);
  if (command !== "package" && command !== "make") {
    fail("the first argument must be package or make");
  }
  const target = parseTarget(argumentsList);
  const { api } = require("@electron-forge/core");
  const options = {
    dir: stageRoot,
    interactive: false,
    platform: target.platform,
    arch: target.arch
  };

  if (command === "package") await api.package(options);
  else await api.make({ ...options, skipPackage: false });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
