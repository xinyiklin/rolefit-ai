const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

const PRODUCT_NAME = "RoleFit AI";
const WINDOWS_IDENTITY = "RoleFitLocalCompanion";
const releaseBuild = process.env.ROLEFIT_RELEASE_BUILD === "1";
const assets = path.join(__dirname, "assets");
const fuses = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // loadFile requires the ordinary Electron file-scheme privileges. The exact
  // local URL, CSP, navigation denial, and IPC sender validation remain fixed.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  [FuseV1Options.WasmTrapHandlers]: true
};

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Signed RoleFit release requires ${name}.`);
  return value;
}

let macSigning;
let macNotarize;
let windowsSigning;
if (releaseBuild && process.platform === "darwin") {
  macSigning = {
    identity: requiredEnvironment("MAC_CSC_IDENTITY"),
    hardenedRuntime: true,
    entitlements: path.join(assets, "entitlements.mac.plist"),
    entitlementsInherit: path.join(assets, "entitlements.mac.inherit.plist")
  };
  macNotarize = {
    appleApiKey: requiredEnvironment("APPLE_API_KEY_PATH"),
    appleApiKeyId: requiredEnvironment("APPLE_API_KEY_ID"),
    appleApiIssuer: requiredEnvironment("APPLE_API_ISSUER")
  };
}
if (releaseBuild && process.platform === "win32") {
  windowsSigning = {
    certificateFile: requiredEnvironment("WIN_CSC_FILE"),
    certificatePassword: requiredEnvironment("WIN_CSC_KEY_PASSWORD"),
    description: PRODUCT_NAME
  };
}
if (releaseBuild && process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error("Signed RoleFit releases must be built on native macOS or Windows runners.");
}

module.exports = {
  outDir: "../out",
  packagerConfig: {
    asar: true,
    prune: false,
    overwrite: true,
    appBundleId: "ai.rolefit.companion",
    appCategoryType: "public.app-category.productivity",
    executableName: WINDOWS_IDENTITY,
    icon: path.join(assets, process.platform === "win32" ? "icon.ico" : "icon.icns"),
    osxSign: macSigning,
    osxNotarize: macNotarize,
    windowsSign: windowsSigning,
    usageDescription: {
      AppleEvents: "RoleFit can open a fixed provider sign-in command in Terminal when you request it."
    },
    win32metadata: {
      CompanyName: "RoleFit AI",
      FileDescription: PRODUCT_NAME,
      InternalName: WINDOWS_IDENTITY,
      OriginalFilename: `${WINDOWS_IDENTITY}.exe`,
      ProductName: PRODUCT_NAME
    },
    ignore: [
      /^\/assets(?:\/|$)/,
      /^\/forge\.config\.cjs$/
    ]
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, resourcesPath, _electronVersion, platform, arch) => {
      const executable = ["darwin", "mas"].includes(platform)
        ? path.join(path.resolve(resourcesPath, "..", ".."), "MacOS", "Electron")
        : path.join(
            path.resolve(resourcesPath, "..", ".."),
            platform === "win32" ? "electron.exe" : "electron"
          );
      await flipFuses(executable, {
        resetAdHocDarwinSignature:
          !macSigning && ["darwin", "mas"].includes(platform) && arch === "arm64",
        ...fuses
      });
    },
    postPackage: async (_forgeConfig, packageResult) => {
      if (releaseBuild || packageResult.platform !== "darwin") return;
      for (const outputPath of packageResult.outputPaths) {
        const appPath = path.join(outputPath, `${PRODUCT_NAME}.app`);
        const outcome = spawnSync(
          "/usr/bin/codesign",
          ["--force", "--deep", "--sign", "-", appPath],
          { stdio: "inherit", timeout: 120_000 }
        );
        if (outcome.error || outcome.status !== 0) {
          throw outcome.error ?? new Error("Could not apply the local ad-hoc macOS signature.");
        }
      }
    }
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        icon: path.join(assets, "icon.icns"),
        ...(releaseBuild && process.platform === "darwin"
          ? {
              "code-sign": {
                "signing-identity": requiredEnvironment("MAC_CSC_IDENTITY")
              }
            }
          : {})
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {}
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: WINDOWS_IDENTITY,
        authors: "RoleFit AI",
        description: "Local provider companion for RoleFit AI.",
        exe: `${WINDOWS_IDENTITY}.exe`,
        setupExe: "RoleFit-AI-Setup.exe",
        setupIcon: path.join(assets, "icon.ico"),
        noDelta: true,
        noMsi: true,
        windowsSign: windowsSigning
      }
    }
  ]
};
