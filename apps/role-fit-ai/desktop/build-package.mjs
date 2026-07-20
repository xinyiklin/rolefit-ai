import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(desktopRoot, "..");
const workspaceRoot = resolve(appRoot, "..", "..");
const forgeRoot = join(appRoot, ".forge");
const stageRoot = join(forgeRoot, "app");
const compiledDesktopRoot = join(appRoot, "dist-electron", "desktop");

if (stageRoot !== join(appRoot, ".forge", "app")) {
  throw new Error("Refusing to prepare an unresolved Forge staging directory.");
}

const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("RoleFit package version must be SemVer before desktop packaging.");
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(join(stageRoot, "dist-electron", "desktop"), { recursive: true });
await mkdir(join(stageRoot, "dist-electron", "server"), { recursive: true });
await mkdir(join(stageRoot, "server"), { recursive: true });

await Promise.all([
  cp(join(appRoot, "dist"), join(stageRoot, "dist"), { recursive: true }),
  cp(join(desktopRoot, "assets"), join(stageRoot, "assets"), { recursive: true }),
  cp(join(desktopRoot, "forge.config.cjs"), join(stageRoot, "forge.config.cjs")),
  cp(join(workspaceRoot, "LICENSE"), join(stageRoot, "LICENSE")),
  cp(join(appRoot, "server", "starter.resume"), join(stageRoot, "server", "starter.resume")),
  ...["companion.html", "companion.css", "companion-renderer.js"].map((asset) =>
    cp(join(compiledDesktopRoot, asset), join(stageRoot, "dist-electron", "desktop", asset))
  )
]);

const mainResult = await build({
  entryPoints: [join(compiledDesktopRoot, "main.cjs")],
  outfile: join(stageRoot, "dist-electron", "desktop", "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24.18",
  external: ["electron"],
  legalComments: "none",
  sourcemap: false,
  metafile: true
});

const preloadResult = await build({
  entryPoints: [join(compiledDesktopRoot, "preload.cjs")],
  outfile: join(stageRoot, "dist-electron", "desktop", "preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24.18",
  external: ["electron"],
  legalComments: "none",
  sourcemap: false,
  metafile: true
});

const serverResult = await build({
  entryPoints: [join(appRoot, "server.ts")],
  outfile: join(stageRoot, "dist-electron", "server", "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24.18",
  // cross-spawn is CommonJS and requires Node built-ins at runtime. The server
  // stays ESM for top-level await, so provide a scoped Node require instead of
  // leaving esbuild's dynamic-require shim unable to load child_process.
  banner: {
    js: 'import { createRequire as __rolefitCreateRequire } from "node:module"; const require = __rolefitCreateRequire(import.meta.url);'
  },
  alias: {
    vite: join(desktopRoot, "package-vite-stub.mjs")
  },
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  legalComments: "none",
  sourcemap: false,
  metafile: true
});

const stagedManifest = {
  name: "rolefit-local-companion",
  productName: "RoleFit Local Companion",
  version: packageJson.version,
  private: true,
  description: "Local provider companion for RoleFit AI.",
  author: "RoleFit AI",
  license: "MIT",
  main: "dist-electron/desktop/main.cjs",
  config: {
    forge: "./forge.config.cjs"
  },
  devDependencies: {
    electron: packageJson.devDependencies.electron
  }
};
await writeFile(
  join(stageRoot, "package.json"),
  `${JSON.stringify(stagedManifest, null, 2)}\n`,
  "utf8"
);
await writeFile(
  join(forgeRoot, "bundle-metafile.json"),
  `${JSON.stringify({ main: mainResult.metafile, preload: preloadResult.metafile, server: serverResult.metafile }, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared allowlisted Forge app at ${stageRoot}.`);
