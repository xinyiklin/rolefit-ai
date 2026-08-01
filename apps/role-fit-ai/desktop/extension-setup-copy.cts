import type { RoleFitExtensionSetupCopyTarget } from "./ipc-contract.cjs";

const EXTENSION_SETUP_BROWSER_ADDRESSES = Object.freeze({
  chrome: "chrome://extensions",
  edge: "edge://extensions",
  firefox: "about:debugging#/runtime/this-firefox"
} satisfies Record<Exclude<RoleFitExtensionSetupCopyTarget, "directory">, string>);

export function resolveRoleFitExtensionSetupCopyValue(
  target: RoleFitExtensionSetupCopyTarget,
  extensionDirectory: string
): string {
  return target === "directory"
    ? extensionDirectory
    : EXTENSION_SETUP_BROWSER_ADDRESSES[target];
}

export function copyRoleFitExtensionSetupValue(
  target: RoleFitExtensionSetupCopyTarget,
  extensionDirectory: string,
  writeText: (value: string) => void
): void {
  writeText(resolveRoleFitExtensionSetupCopyValue(target, extensionDirectory));
}
