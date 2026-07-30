import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [
  resolve(repoRoot, "package.json"),
  ...["apps", "packages"].flatMap((group) =>
    readdirSync(resolve(repoRoot, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(repoRoot, group, entry.name, "package.json"))
      .filter(existsSync)
  )
];

const localScriptPath =
  /(?:^|[\s;&|])(?:"([^"]+\.(?:[cm]?js|ts|py))"|'([^']+\.(?:[cm]?js|ts|py))'|([^\s;&|]+\.(?:[cm]?js|ts|py)))(?=$|[\s;&|])/g;
const failures = [];

for (const manifestPath of manifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    for (const match of String(command).matchAll(localScriptPath)) {
      const candidate = match[1] ?? match[2] ?? match[3];
      if (
        !candidate ||
        candidate.startsWith("-") ||
        candidate.includes("*") ||
        candidate.includes("?")
      ) {
        continue;
      }
      const resolved = resolve(dirname(manifestPath), candidate);
      if (!existsSync(resolved)) {
        failures.push(
          `${manifestPath.slice(repoRoot.length + 1)}#${scriptName}: ${candidate}`
        );
      }
    }
  }
}

if (failures.length) {
  console.error("Package scripts reference missing local files:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Package script paths: PASS (${manifests.length} manifests checked)`);
}
