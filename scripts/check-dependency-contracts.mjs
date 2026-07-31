import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

// Hoisted installs let a file import a package no manifest declares, so the
// scan resolves every specifier against its nearest owning package.json rather
// than trusting that resolution happened to succeed at runtime.
const scannedRoots = ["scripts", "apps", "packages"];
const scannedExtensions = /\.(?:[cm]?js|[cm]?ts|tsx)$/;
const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "dist-landing",
  "build",
  "out",
  "coverage",
  "fonts",
  "workspace",
  ".git",
  ".vite",
]);
// Root owns the shared compiler/bundler toolchain, so workspace config files
// import these without redeclaring them.
const rootOwnedTooling = new Set(["typescript", "vite", "@vitejs/plugin-react"]);
// Source scanning is textual, so escaped import statements inside regex
// literals match too. Only report specifiers that are legal package names.
const packageNamePattern =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

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
const nativeCompilerPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
const nativeCompilerVersion = resolvedVersion(nativeCompilerPackage, ".");
check(
  nativeCompilerVersion === expectedCompilerVersion,
  `The current host must install ${nativeCompilerPackage} at TypeScript`
    + ` ${expectedCompilerVersion}; found ${nativeCompilerVersion ?? "(missing)"}.`,
);
if (process.env.EXPECTED_TYPESCRIPT_PLATFORM) {
  check(
    process.platform === process.env.EXPECTED_TYPESCRIPT_PLATFORM,
    `CI expected TypeScript platform ${process.env.EXPECTED_TYPESCRIPT_PLATFORM},`
      + ` but Node reports ${process.platform}.`,
  );
}
if (process.env.EXPECTED_TYPESCRIPT_ARCH) {
  check(
    process.arch === process.env.EXPECTED_TYPESCRIPT_ARCH,
    `CI expected TypeScript architecture ${process.env.EXPECTED_TYPESCRIPT_ARCH},`
      + ` but Node reports ${process.arch}.`,
  );
}
notices.push(
  `TypeScript native compiler ${nativeCompilerPackage}@${nativeCompilerVersion ?? "(missing)"}.`,
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

// react-pdf pins pdfjs-dist exactly; a drifting worker version fails at runtime
// in the PDF preview rather than at build time, so pin and cross-check it.
const reactPdfRequiredPdfjs = lockfileInstallations("react-pdf")
  .map(({ path }) => packageLock.packages[path]?.dependencies?.["pdfjs-dist"])
  .find(Boolean);
const roleFitPdfjs = resolvedVersion("pdfjs-dist", "apps/role-fit-ai");
check(
  Boolean(roleFitPackage.dependencies?.["pdfjs-dist"]),
  "RoleFit must declare pdfjs-dist directly; it resolves the PDF.js worker by subpath.",
);
check(
  roleFitPdfjs !== undefined && roleFitPdfjs === reactPdfRequiredPdfjs,
  `RoleFit pdfjs-dist ${roleFitPdfjs ?? "(missing)"} must match the version react-pdf`
    + ` requires (${reactPdfRequiredPdfjs ?? "(unknown)"}).`,
);
checkSingleMajor(lockfileInstallations("pdfjs-dist"), "pdfjs-dist");

check(
  Boolean(roleFitPackage.devDependencies?.["@electron/asar"]),
  "RoleFit must declare @electron/asar directly; the packaged smoke test imports it.",
);
checkSingleMajor(lockfileInstallations("@electron/asar"), "@electron/asar");

const undeclaredImports = findUndeclaredImports();
check(
  undeclaredImports.length === 0,
  `Source files import undeclared packages: ${formatList(undeclaredImports)}.`,
);

// Several packages (lucide-react, react, pdf-lib) are declared by more than one
// manifest and stay single-copy only because those specifiers agree. Drift
// silently bundles two copies rather than failing, so compare them directly.
const specifierDisagreements = findCrossManifestSpecifierDisagreements();
check(
  specifierDisagreements.length === 0,
  `Packages declared by several manifests must share one specifier:`
    + ` ${formatList(specifierDisagreements)}.`,
);

// The loopback server must not pull React in through the engine; only
// typeset/render/dom.tsx is an intentional React boundary.
const reactBearingServerImports = findReactBearingServerImports();
check(
  reactBearingServerImports.length === 0,
  `RoleFit server modules must import React-free engine subpaths:`
    + ` ${formatList(reactBearingServerImports)}.`,
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

function findUndeclaredImports() {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
  ]);
  const workspaceNames = new Set(
    workspaceManifests.map(({ manifest }) => manifest.name).filter(Boolean),
  );
  const ownerCache = new Map();
  const findings = new Set();

  for (const scannedRoot of scannedRoots) {
    for (const sourcePath of walkSourceFiles(join(repositoryRoot, scannedRoot))) {
      const source = readFileSync(sourcePath, "utf8");
      const specifiers = importedSpecifiers(source);
      if (specifiers.length === 0) continue;

      const owner = nearestOwner(dirname(sourcePath), ownerCache);
      for (const specifier of specifiers) {
        if (
          specifier.startsWith(".")
          || specifier.startsWith("/")
          || specifier.startsWith("#")
          || builtins.has(specifier)
        ) {
          continue;
        }
        const dependency = dependencyName(specifier);
        if (
          !packageNamePattern.test(dependency)
          || workspaceNames.has(dependency)
          || rootOwnedTooling.has(dependency)
          || dependency.startsWith("@types/")
          || ownerDeclares(owner, dependency)
        ) {
          continue;
        }
        findings.add(
          `${dependency} (${relative(repositoryRoot, sourcePath).replaceAll("\\", "/")}`
            + ` -> ${owner.path})`,
        );
      }
    }
  }

  return [...findings].sort();
}

function findCrossManifestSpecifierDisagreements() {
  const specifiers = new Map();
  const everyManifest = [{ path: "package.json", manifest: rootPackage }, ...workspaceManifests];
  for (const { path, manifest } of everyManifest) {
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        // "*" is the workspace-link specifier, not a version claim.
        if (specifier === "*") continue;
        if (!specifiers.has(name)) specifiers.set(name, new Map());
        specifiers.get(name).set(path, specifier);
      }
    }
  }

  const findings = [];
  for (const [name, byManifest] of specifiers) {
    if (new Set(byManifest.values()).size <= 1) continue;
    const detail = [...byManifest].map(([path, specifier]) => `${path}=${specifier}`).join(", ");
    findings.push(`${name} (${detail})`);
  }
  return findings.sort();
}

function findReactBearingServerImports() {
  const enginePrefix = "@typeset/engine/";
  const findings = new Set();
  const reactReach = new Map();

  for (const serverRoot of ["apps/role-fit-ai/server", "apps/role-fit-ai/server.ts"]) {
    for (const sourcePath of walkSourceFiles(join(repositoryRoot, serverRoot))) {
      const source = readFileSync(sourcePath, "utf8");
      for (const specifier of importedSpecifiers(source)) {
        if (!specifier.startsWith(enginePrefix)) continue;
        const target = engineSourcePath(specifier.slice(enginePrefix.length));
        if (!target || !reachesReact(target, reactReach, new Set())) continue;
        findings.add(
          `${relative(repositoryRoot, sourcePath).replaceAll("\\", "/")} -> ${specifier}`,
        );
      }
    }
  }
  return [...findings].sort();
}

function engineSourcePath(subpath) {
  // The engine exports map is `./fonts/* -> ./fonts/*` and `./* -> ./src/*`.
  if (subpath.startsWith("fonts/")) return undefined;
  return join(repositoryRoot, "packages/engine/src", subpath);
}

function reachesReact(sourcePath, cache, visiting) {
  const key = sourcePath;
  if (cache.has(key)) return cache.get(key);
  if (visiting.has(key)) return false;
  visiting.add(key);

  let source;
  try {
    source = readFileSync(key, "utf8");
  } catch {
    cache.set(key, false);
    return false;
  }

  let reaches = false;
  for (const specifier of importedSpecifiers(source)) {
    const dependency = dependencyName(specifier);
    if (dependency === "react" || dependency === "react-dom") {
      reaches = true;
      break;
    }
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveRelativeSource(dirname(key), specifier);
    if (resolved && reachesReact(resolved, cache, visiting)) {
      reaches = true;
      break;
    }
  }

  visiting.delete(key);
  cache.set(key, reaches);
  return reaches;
}

function resolveRelativeSource(fromDirectory, specifier) {
  const base = join(fromDirectory, specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next extension.
    }
  }
  return undefined;
}

function* walkSourceFiles(directory) {
  try {
    if (statSync(directory).isFile()) {
      if (scannedExtensions.test(directory)) yield directory;
      return;
    }
  } catch {
    return;
  }
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      yield* walkSourceFiles(entryPath);
    } else if (entry.isFile() && scannedExtensions.test(entry.name)) {
      yield entryPath;
    }
  }
}

function nearestOwner(startDirectory, cache) {
  if (cache.has(startDirectory)) return cache.get(startDirectory);
  let directory = startDirectory;
  while (true) {
    const candidate = join(directory, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      const owner = {
        path: relative(repositoryRoot, candidate).replaceAll("\\", "/") || "package.json",
        manifest,
      };
      cache.set(startDirectory, owner);
      return owner;
    } catch {
      const parent = dirname(directory);
      if (parent === directory || !directory.startsWith(repositoryRoot)) {
        const owner = { path: "package.json", manifest: rootPackage };
        cache.set(startDirectory, owner);
        return owner;
      }
      directory = parent;
    }
  }
}

function ownerDeclares(owner, packageName) {
  return [
    owner.manifest.dependencies,
    owner.manifest.devDependencies,
    owner.manifest.optionalDependencies,
    owner.manifest.peerDependencies,
  ].some((dependencies) => dependencies?.[packageName]);
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
