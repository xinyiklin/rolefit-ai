import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageLock = readJson("package-lock.json");
const rootPackage = readJson("package.json");
const roleFitPackage = readJson("apps/role-fit-ai/package.json");
const errors = [];
const notices = [];

const canonicalTooling = [
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "typescript",
  "vite",
];
const forgePackages = [
  "@electron-forge/core",
  "@electron-forge/maker-dmg",
  "@electron-forge/maker-squirrel",
  "@electron-forge/maker-zip",
];
const expectedInstallScriptPolicy = {
  "electron@43.2.0": true,
  "electron-winstaller@5.4.4": true,
  "esbuild@0.28.1": true,
  "fs-xattr@0.3.1": true,
  "fsevents@2.3.3": true,
  "macos-alias@0.2.12": true,
};
const workspaceManifests = discoverWorkspaceManifests();

const nodeVersion = process.versions.node;
const npmVersion = detectNpmVersion();
const expectedNpmVersion = rootPackage.packageManager?.match(/^npm@(.+)$/)?.[1];

console.log(`Dependency contract runtime: Node ${nodeVersion}, npm ${npmVersion}`);

const [nodeMajor, nodeMinor] = versionParts(nodeVersion);
check(
  nodeMajor === 24 && nodeMinor >= 18,
  `Node ${nodeVersion} is unsupported; use Node >=24.18 <25 (.node-version pins 24.18.0).`,
);
check(
  rootPackage.engines?.node === ">=24.18 <25",
  'The root Node engine must remain ">=24.18 <25".',
);
check(
  expectedNpmVersion === "11.16.0",
  'The root packageManager must remain pinned to "npm@11.16.0".',
);
check(
  npmVersion === expectedNpmVersion,
  `npm ${npmVersion} does not match the pinned npm ${expectedNpmVersion ?? "(missing)"}.`,
);
check(
  JSON.stringify(rootPackage.allowScripts) === JSON.stringify(expectedInstallScriptPolicy),
  "The root allowScripts policy must contain only the reviewed, version-pinned lifecycle scripts.",
);

for (const dependency of canonicalTooling) {
  check(
    rootPackage.devDependencies?.[dependency],
    `Root devDependencies must explicitly own ${dependency}.`,
  );

  const workspaceOwners = workspaceManifests
    .filter(({ manifest }) => declaredDependency(manifest, dependency))
    .map(({ path }) => path);
  check(
    workspaceOwners.length === 0,
    `${dependency} has unexpected workspace owners: ${formatList(workspaceOwners)}.`
      + " Expected root ownership only.",
  );
}

const viteInstallations = lockfileInstallations("vite");
const pluginInstallations = lockfileInstallations("@vitejs/plugin-react");
checkSingleMajor(viteInstallations, "vite");
checkSingleMajor(pluginInstallations, "@vitejs/plugin-react");

const reactVersions = uniqueVersions(lockfileInstallations("react"));
const reactDomVersions = uniqueVersions(lockfileInstallations("react-dom"));
check(
  reactVersions.length === 1,
  `React must resolve once; found ${formatList(reactVersions)}.`,
);
check(
  reactDomVersions.length === 1,
  `React DOM must resolve once; found ${formatList(reactDomVersions)}.`,
);
check(
  reactVersions.length === 1
    && reactDomVersions.length === 1
    && reactVersions[0] === reactDomVersions[0],
  `React and React DOM must match exactly; found React ${formatList(reactVersions)}`
    + ` and React DOM ${formatList(reactDomVersions)}.`,
);
for (const workspacePath of ["apps/role-fit-ai", "apps/typeset"]) {
  check(
    resolvedVersion("react", workspacePath) === resolvedVersion("react-dom", workspacePath),
    `${workspacePath} resolves different React and React DOM versions.`,
  );
}

const typescriptInstallations = lockfileInstallations("typescript");
const projectCompilers = typescriptInstallations.filter(({ path }) => (
  path === "node_modules/typescript"
));
const expectedCompilerVersion = rootPackage.devDependencies?.typescript;
check(
  projectCompilers.length === 1
    && projectCompilers[0].version === expectedCompilerVersion,
  `The project compiler must resolve once at TypeScript ${expectedCompilerVersion}; found`
    + ` ${formatInstallations(projectCompilers)}.`,
);
const unexpectedCompilers = typescriptInstallations.filter(({ path }) => (
  path !== "node_modules/typescript"
  && path !== "node_modules/@electron-forge/template-webpack-typescript/node_modules/typescript"
));
check(
  unexpectedCompilers.length === 0,
  `Unexpected TypeScript compiler installations: ${formatInstallations(unexpectedCompilers)}.`,
);
const forgeTemplateCompiler = typescriptInstallations.find(({ path }) => (
  path === "node_modules/@electron-forge/template-webpack-typescript/node_modules/typescript"
));
if (forgeTemplateCompiler) {
  notices.push(
    `Electron Forge retains its internal TypeScript ${forgeTemplateCompiler.version};`
      + " it is not a workspace compiler.",
  );
}
check(
  resolvedVersion("typescript", ".") === expectedCompilerVersion,
  `The executable project compiler does not match TypeScript ${expectedCompilerVersion}.`,
);

const forgeVersions = forgePackages.map((packageName) => ({
  packageName,
  specifier: roleFitPackage.devDependencies?.[packageName],
  installed: resolvedVersion(packageName, "apps/role-fit-ai"),
}));
const forgeSpecifiers = [...new Set(forgeVersions.map(({ specifier }) => specifier))];
const resolvedForgeVersions = [...new Set(forgeVersions.map(({ installed }) => installed))];
check(
  forgeSpecifiers.length === 1 && !forgeSpecifiers.includes(undefined),
  `Electron Forge declarations must match exactly: ${formatForgeVersions(forgeVersions, "specifier")}.`,
);
check(
  resolvedForgeVersions.length === 1 && !resolvedForgeVersions.includes(undefined),
  `Electron Forge installations must match exactly: ${formatForgeVersions(forgeVersions, "installed")}.`,
);

const nodeTypesSpecifier = rootPackage.devDependencies?.["@types/node"];
const nodeTypesVersion = resolvedVersion("@types/node", "apps/role-fit-ai");
check(
  specifierMajor(nodeTypesSpecifier) === 24,
  `The root must declare Node 24 types; found ${nodeTypesSpecifier ?? "(missing)"}.`,
);
check(
  versionParts(nodeTypesVersion)[0] === 24,
  `RoleFit must resolve Node 24 types; found ${nodeTypesVersion ?? "(missing)"}.`,
);

const undeclaredRootImports = findUndeclaredRootScriptImports();
check(
  undeclaredRootImports.length === 0,
  `Root scripts import undeclared packages: ${formatList(undeclaredRootImports)}.`,
);

for (const notice of notices) {
  console.log(`NOTICE: ${notice}`);
}

if (errors.length > 0) {
  console.error("\nDependency contract violations:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Dependency contracts passed.");
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

function detectNpmVersion() {
  const userAgentVersion = process.env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/)?.[1];
  if (userAgentVersion) return userAgentVersion;

  return execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--version"],
    { encoding: "utf8" },
  ).trim();
}

function discoverWorkspaceManifests() {
  const manifests = [];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(repositoryRoot, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = `${parent}/${entry.name}/package.json`;
      manifests.push({ path, manifest: readJson(path) });
    }
  }
  return manifests.sort((left, right) => left.path.localeCompare(right.path));
}

function declaredDependency(manifest, packageName) {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ].some((dependencies) => dependencies?.[packageName]);
}

function lockfileInstallations(packageName) {
  const suffix = `node_modules/${packageName}`;
  return Object.entries(packageLock.packages)
    .filter(([path, metadata]) => (
      (path === suffix || path.endsWith(`/${suffix}`))
      && typeof metadata.version === "string"
    ))
    .map(([path, metadata]) => ({ path, version: metadata.version }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function checkSingleMajor(installations, packageName) {
  const majors = [...new Set(installations.map(({ version }) => versionParts(version)[0]))]
    .sort((left, right) => left - right);
  check(
    majors.length === 1,
    `${packageName} must not install multiple majors; found ${formatInstallations(installations)}.`,
  );
}

function resolvedVersion(packageName, workspacePath) {
  try {
    const packageRequire = createRequire(join(repositoryRoot, workspacePath, "package.json"));
    const packageJsonPath = packageRequire.resolve(`${packageName}/package.json`);
    return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  } catch {
    return undefined;
  }
}

function findUndeclaredRootScriptImports() {
  const declared = new Set([
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...Object.keys(rootPackage.devDependencies ?? {}),
    ...workspaceManifests.map(({ manifest }) => manifest.name).filter(Boolean),
  ]);
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
  ]);
  const imports = new Set();
  const scriptsRoot = join(repositoryRoot, "scripts");

  for (const entry of readdirSync(scriptsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:c|m)?js$/.test(entry.name)) continue;
    const sourcePath = join(scriptsRoot, entry.name);
    const source = readFileSync(sourcePath, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      if (
        specifier.startsWith(".")
        || specifier.startsWith("/")
        || specifier.startsWith("#")
        || builtins.has(specifier)
      ) {
        continue;
      }
      const dependency = dependencyName(specifier);
      if (!declared.has(dependency)) {
        imports.add(`${dependency} (${relative(repositoryRoot, sourcePath)})`);
      }
    }
  }

  return [...imports].sort();
}

function importedSpecifiers(source) {
  const matches = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      matches.push(match[1]);
    }
  }
  return matches;
}

function dependencyName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function uniqueVersions(installations) {
  return [...new Set(installations.map(({ version }) => version))].sort();
}

function versionParts(version) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [Number.NaN, Number.NaN, Number.NaN];
}

function specifierMajor(specifier) {
  const match = String(specifier ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function formatInstallations(installations) {
  return installations.length > 0
    ? installations.map(({ path, version }) => `${version} at ${path}`).join(", ")
    : "(none)";
}

function formatForgeVersions(versions, field) {
  return versions
    .map(({ packageName, [field]: version }) => `${packageName}=${version ?? "(missing)"}`)
    .join(", ");
}

function check(condition, message) {
  if (!condition) errors.push(message);
}
