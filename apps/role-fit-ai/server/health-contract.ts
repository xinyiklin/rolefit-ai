import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const ROLEFIT_HEALTH_API_VERSION = 1 as const;
export const ROLEFIT_DESKTOP_COMPATIBILITY_VERSION = 1 as const;

export type RoleFitHealthMode = "development" | "production";

export type RoleFitHealthPayload = {
  service: "role-fit-ai";
  status: "ok";
  apiVersion: typeof ROLEFIT_HEALTH_API_VERSION;
  desktopCompatibilityVersion: typeof ROLEFIT_DESKTOP_COMPATIBILITY_VERSION;
  mode: RoleFitHealthMode;
  workspaceFingerprint: string;
};

export type RoleFitHealthExpectation = Pick<
  RoleFitHealthPayload,
  "apiVersion" | "desktopCompatibilityVersion" | "mode" | "workspaceFingerprint"
>;

export function computeWorkspaceFingerprint(workspaceDir: string): string {
  return createHash("sha256")
    .update(`rolefit-workspace-v1\0${resolve(workspaceDir)}`)
    .digest("hex")
    .slice(0, 24);
}

export function createRoleFitHealthPayload(
  mode: RoleFitHealthMode,
  workspaceDir: string
): RoleFitHealthPayload {
  return {
    service: "role-fit-ai",
    status: "ok",
    apiVersion: ROLEFIT_HEALTH_API_VERSION,
    desktopCompatibilityVersion: ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
    mode,
    workspaceFingerprint: computeWorkspaceFingerprint(workspaceDir)
  };
}

export function isCompatibleRoleFitHealth(
  value: unknown,
  expected: RoleFitHealthExpectation
): value is RoleFitHealthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.service === "role-fit-ai" &&
    data.status === "ok" &&
    data.apiVersion === expected.apiVersion &&
    data.desktopCompatibilityVersion === expected.desktopCompatibilityVersion &&
    data.mode === expected.mode &&
    data.workspaceFingerprint === expected.workspaceFingerprint;
}
