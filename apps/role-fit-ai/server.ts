import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRoleFitLocalEnv,
  startRoleFitServer,
  type RoleFitServerMode
} from "./server/runtime.ts";
import {
  applyProviderSnapshot,
  clearProviderSnapshot
} from "./server/provider-connections.ts";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  WorkspaceBackupError
} from "./server/workspaceBackup.ts";
import { countActiveTabs } from "./server/presence.ts";

type UtilityMessageEvent = Readonly<{ data: unknown }>;
type UtilityParentPort = Readonly<{
  on(event: "message", listener: (message: UtilityMessageEvent) => void): unknown;
  off(event: "message", listener: (message: UtilityMessageEvent) => void): unknown;
  postMessage(message: unknown): void;
}>;

const utilityParentPort = (process as NodeJS.Process & {
  parentPort?: UtilityParentPort | null;
}).parentPort ?? null;
const companionOwned = utilityParentPort !== null;
const sourceAppRoot = dirname(fileURLToPath(import.meta.url));
const configuredAppRoot = process.env.ROLEFIT_APP_ROOT;
if (configuredAppRoot && !isAbsolute(configuredAppRoot)) {
  throw new Error("ROLEFIT_APP_ROOT must be an absolute path.");
}
const appRoot = resolve(configuredAppRoot || sourceAppRoot);
if (companionOwned) {
  // Establish the authoritative companion boundary before the HTTP listener
  // can accept a request. Until Electron sends the first real snapshot, every
  // AI provider therefore fails closed instead of falling back to `.env`.
  applyProviderSnapshot({
    type: "rolefit-provider-snapshot",
    schemaVersion: 1,
    providers: [],
    credentials: {}
  });
} else {
  await loadRoleFitLocalEnv(appRoot);
}
const workspaceDir = process.env.ROLEFIT_WORKSPACE_DIR
  ? resolve(appRoot, process.env.ROLEFIT_WORKSPACE_DIR)
  : join(appRoot, "job-search-workspace");

function isWorkspaceRequest(value: unknown): value is Readonly<{
  type: "rolefit-workspace-request";
  schemaVersion: 1;
  requestId: string;
  operation: "backup" | "restore";
  body?: string;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return request.type === "rolefit-workspace-request" && request.schemaVersion === 1 &&
    typeof request.requestId === "string" && /^workspace-\d+-\d+$/.test(request.requestId) &&
    (request.operation === "backup" || request.operation === "restore") &&
    (request.body === undefined || typeof request.body === "string");
}

async function handleWorkspaceRequest(request: unknown): Promise<void> {
  if (!utilityParentPort || !isWorkspaceRequest(request)) return;
  try {
    const result = request.operation === "backup"
      ? await createWorkspaceBackup(workspaceDir).then((backup) => ({
          body: JSON.stringify(backup, null, 2),
          fileName: `RoleFit-Workspace-${backup.createdAt.slice(0, 10)}.rolefit-backup`
        }))
      : await restoreWorkspaceBackup(
          workspaceDir,
          JSON.parse(request.body ?? ""),
          new Date(),
          countActiveTabs
        );
    utilityParentPort.postMessage({
      type: "rolefit-workspace-response",
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result
    });
  } catch (error) {
    utilityParentPort.postMessage({
      type: "rolefit-workspace-response",
      schemaVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: error instanceof WorkspaceBackupError
        ? error.message
        : request.operation === "restore"
          ? "This is not a valid RoleFit workspace backup."
          : "The workspace could not be backed up safely."
    });
  }
}

const handleUtilityMessage = (message: UtilityMessageEvent): void => {
  if (isWorkspaceRequest(message.data)) {
    void handleWorkspaceRequest(message.data);
    return;
  }
  try {
    applyProviderSnapshot(message.data);
  } catch {
    // Never print a rejected message: it may contain a credential. The previous
    // validated snapshot remains active atomically.
    console.warn("[providers] Rejected an invalid companion snapshot.");
  }
};
utilityParentPort?.on("message", handleUtilityMessage);
const mode: RoleFitServerMode = process.env.NODE_ENV === "production"
  ? "production"
  : "development";
const host = (process.env.HOST || "127.0.0.1").trim().toLowerCase();
const port = Number(process.env.PORT ?? 5181);

const runtime = await startRoleFitServer({
  appRoot,
  workspaceDir,
  mode,
  host,
  port,
  // The standalone entry loaded `.env` before resolving its path/port/model
  // settings. The companion entry must never load it at all.
  loadLocalEnv: false
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.off("SIGINT", handleSignal);
  process.off("SIGTERM", handleSignal);
  utilityParentPort?.off("message", handleUtilityMessage);
  clearProviderSnapshot();
  try {
    await runtime.close();
  } catch {
    process.exitCode = 1;
  }
}

function handleSignal(): void {
  void shutdown();
}

process.once("SIGINT", handleSignal);
process.once("SIGTERM", handleSignal);
