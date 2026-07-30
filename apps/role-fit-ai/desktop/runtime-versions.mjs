export const ROLEFIT_DESKTOP_RUNTIME_CONTRACT = Object.freeze({
  electronVersion: "43.2.0",
  electronMajor: 43,
  electronMinor: 2,
  embeddedNodeVersion: "24.18.0",
  embeddedNodeMajor: 24,
  embeddedNodeMinor: 18,
  esbuildTarget: "node24.18",
  forgeHostNodeMajor: 24,
});

function majorMinor(version, label) {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$/.exec(version);
  if (!match) {
    throw new Error(`RoleFit desktop runtime: ${label} version ${version || "(missing)"} is invalid.`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function assertElectronPackageVersion(version) {
  if (version !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronVersion) {
    throw new Error(
      `RoleFit desktop runtime: Electron ${version || "(missing)"} does not match`
        + ` ${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronVersion}.`,
    );
  }
}

export function assertForgeHostNodeVersion(version) {
  const { major } = majorMinor(version, "Forge host Node");
  if (major !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.forgeHostNodeMajor) {
    throw new Error(
      `RoleFit desktop runtime: Forge host Node ${version} is unsupported;`
        + ` use Node ${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.forgeHostNodeMajor}.`,
    );
  }
}

export function assertElectronRuntimeVersions(versions) {
  const electron = majorMinor(versions.electron ?? "", "Electron");
  const node = majorMinor(versions.node ?? "", "embedded Node");
  if (
    electron.major !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronMajor
    || electron.minor !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronMinor
  ) {
    throw new Error(
      `RoleFit desktop runtime: Electron ${versions.electron} does not match expected`
        + ` ${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronMajor}.${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronMinor}.x.`,
    );
  }
  if (
    node.major !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.embeddedNodeMajor
    || node.minor !== ROLEFIT_DESKTOP_RUNTIME_CONTRACT.embeddedNodeMinor
  ) {
    throw new Error(
      `RoleFit desktop runtime: embedded Node ${versions.node} does not match expected`
        + ` ${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.embeddedNodeMajor}.`
        + `${ROLEFIT_DESKTOP_RUNTIME_CONTRACT.embeddedNodeMinor}.x.`,
    );
  }
}
