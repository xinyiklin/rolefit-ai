import type { RoleFitExtensionSetupCopyTarget } from "./ipc-contract.cjs";

const EXTENSION_SETUP_BROWSER_ADDRESSES = Object.freeze({
  chrome: "chrome://extensions",
  edge: "edge://extensions",
  firefox: "about:debugging#/runtime/this-firefox"
} satisfies Record<Exclude<RoleFitExtensionSetupCopyTarget, "directory" | "port">, string>);

function validateActivePort(activePort: number): number {
  if (!Number.isInteger(activePort) || activePort < 1 || activePort > 65_535) {
    throw new Error("RoleFit extension setup port must be an integer from 1 through 65535.");
  }
  return activePort;
}

export function resolveRoleFitExtensionSetupCopyValue(
  target: RoleFitExtensionSetupCopyTarget,
  extensionDirectory: string,
  activePort: number
): string {
  if (target === "directory") return extensionDirectory;
  if (target === "port") return String(validateActivePort(activePort));
  return EXTENSION_SETUP_BROWSER_ADDRESSES[target];
}

export function copyRoleFitExtensionSetupValue(
  target: RoleFitExtensionSetupCopyTarget,
  extensionDirectory: string,
  activePort: number,
  writeText: (value: string) => void
): void {
  writeText(resolveRoleFitExtensionSetupCopyValue(target, extensionDirectory, activePort));
}
