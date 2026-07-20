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

type UtilityMessageEvent = Readonly<{ data: unknown }>;
type UtilityParentPort = Readonly<{
  on(event: "message", listener: (message: UtilityMessageEvent) => void): unknown;
  off(event: "message", listener: (message: UtilityMessageEvent) => void): unknown;
}>;

const utilityParentPort = (process as NodeJS.Process & {
  parentPort?: UtilityParentPort | null;
}).parentPort ?? null;
const companionOwned = utilityParentPort !== null;
const handleUtilityMessage = (message: UtilityMessageEvent): void => {
  try {
    applyProviderSnapshot(message.data);
  } catch {
    // Never print a rejected message: it may contain a credential. The previous
    // validated snapshot remains active atomically.
    console.warn("[providers] Rejected an invalid companion snapshot.");
  }
};
utilityParentPort?.on("message", handleUtilityMessage);

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
