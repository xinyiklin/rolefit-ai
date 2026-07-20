import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { handlePolish } from "./ai/polish.ts";
import { handleDistill } from "./ai/distill.ts";
import { getDefaultModel, getDefaultProvider } from "./ai/providers.ts";
import { handleApplicationAnswers } from "./ai/applicationAnswers.ts";
import { handleCoverLetter } from "./ai/coverLetter.ts";
import { isApiPathname, sendJson } from "./http.ts";
import {
  ensureJobWorkspace,
  handleRestoreBaseResume,
  handleSelectBaseResume,
  handleWorkspace,
  handleWorkspaceBaseResume,
  type WorkspaceLocations
} from "./workspace.ts";
import { handleImportJob } from "./jobImport.ts";
import {
  handleApplicationResumeFile,
  handleDeleteApplication,
  handleListApplications,
  handleSaveApplicationResume,
  handleSaveApplications
} from "./applications/routes.ts";
import {
  cleanExtensionClaimToken,
  handleExtensionPairingRequests,
  handleExtensionInbox,
  handleExtensionRoutes
} from "./extension/routes.ts";
import { createRoleFitHealthPayload } from "./health-contract.ts";
import { handleProviderConnections } from "./provider-connections.ts";

export type RoleFitServerMode = "development" | "production";

export type RoleFitServerLogger = Pick<Console, "info" | "warn">;

export type RoleFitServerOptions = {
  appRoot: string;
  workspaceDir: string;
  mode: RoleFitServerMode;
  host: string;
  port: number;
  logger?: RoleFitServerLogger | null;
  /**
   * Standalone/headless entry points load the app-local `.env` by default.
   * Electron's owned utility process must pass `false`: its provider snapshot
   * is authoritative and managed credentials may cross only the private
   * parent/child channel.
   */
  loadLocalEnv?: boolean;
};

export type RoleFitServerHandle = {
  origin: string;
  host: string;
  port: number;
  mode: RoleFitServerMode;
  close(): Promise<void>;
};

export async function loadRoleFitLocalEnv(appRoot: string): Promise<void> {
  try {
    const env = await readFile(join(appRoot, ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Local .env is optional.
  }
}

function isLoopbackBindHost(value: string): boolean {
  if (["localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1"].includes(value)) return true;
  const match = value.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255));
}

function hostHeaderFor(value: string, port: number): string {
  const bare = value.replace(/^\[|\]$/g, "");
  return bare.includes(":") ? `[${bare}]:${port}` : `${bare}:${port}`;
}

function decodeRouteSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, appRoot: string): Promise<void> {
  // Parse the request target against a fixed local base. The Host header is
  // untrusted and validated separately for API routes; using it as a URL base
  // lets a malformed Host throw before the guard can return a controlled 4xx.
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const distRoot = resolve(join(appRoot, "dist"));
  const filePath = resolve(join(distRoot, pathname));

  // Require the dist root PLUS a trailing separator so a sibling like
  // <root>/dist-leak/x can't satisfy a bare startsWith prefix. (URL
  // normalization already collapses `..`, so this is defense in depth.)
  if (filePath !== distRoot && !filePath.startsWith(distRoot + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type =
      ({
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".woff2": "font/woff2",
        ".otf": "font/otf",
        ".ttf": "font/ttf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg"
      } as Record<string, string>)[extname(filePath)] ?? "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    // Unmatched /api/* paths fall through to static serving in production;
    // serving index.html as 200 would turn a mistyped or removed route into
    // an opaque JSON parse error client-side instead of a visible 404.
    if (isApiPathname(pathname)) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    const index = await readFile(join(appRoot, "dist", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(index);
  }
}

async function serveEngineFont(
  pathname: string,
  res: ServerResponse,
  appRoot: string
): Promise<void> {
  const match = pathname.match(/^\/fonts\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:woff2|otf|ttf))$/);
  if (!match) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const fontsRoot = resolve(join(appRoot, "public", "fonts"));
  const filePath = resolve(join(fontsRoot, match[1]));
  if (!filePath.startsWith(fontsRoot + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type = filePath.endsWith(".woff2")
      ? "font/woff2"
      : filePath.endsWith(".otf")
      ? "font/otf"
      : "font/ttf";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function validatePort(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error("RoleFit server port must be an integer from 0 through 65535.");
  }
  return value;
}

function originHost(value: string): string {
  const bare = value.replace(/^\[|\]$/g, "");
  if (bare === "0.0.0.0") return "127.0.0.1";
  if (bare === "::" || bare === "0:0:0:0:0:0:0:0") return "[::1]";
  return bare.includes(":") ? `[${bare}]` : bare;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolveListening, rejectListening) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectListening(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListening(new Error("RoleFit server did not expose a TCP listening address."));
        return;
      }
      resolveListening(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

export async function startRoleFitServer(options: RoleFitServerOptions): Promise<RoleFitServerHandle> {
  const appRoot = resolve(options.appRoot);
  const workspaceDir = resolve(options.workspaceDir);
  const mode = options.mode;
  const isProduction = mode === "production";
  const host = options.host.trim().toLowerCase();
  const configuredPort = validatePort(options.port);
  const logger = options.logger === undefined ? console : options.logger;
  const workspaceLocations: WorkspaceLocations = { appRoot, workspaceDir };

  if (!host) throw new Error("RoleFit server host cannot be empty.");

  if (options.loadLocalEnv !== false) await loadRoleFitLocalEnv(appRoot);
  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel();
  await ensureJobWorkspace(workspaceDir);

  // Keep Vite out of the packaged production runtime. It is a development
  // dependency loaded only for the standalone source server.
  const vite = isProduction
    ? null
    : await import("vite").then(({ createServer: createViteServer }) => createViteServer({
        root: appRoot,
        appType: "spa",
        optimizeDeps: {
          include: ["pdf-lib", "@pdf-lib/fontkit"]
        },
        server: {
          middlewareMode: true
        }
      }));

  let listeningPort = configuredPort;
  const server = createServer((req, res) => {
    let routeUrl: URL;
    try {
      routeUrl = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Malformed request URL." });
      return;
    }
    const pathname = routeUrl.pathname;

    // In development, serve the engine-owned font assets directly. Vite's SPA
    // fallback would otherwise answer a missing generated public/font file with
    // index.html and fontkit would report the opaque "Unknown font format".
    if (!isProduction && pathname.startsWith("/fonts/")) {
      void serveEngineFont(pathname, res, appRoot);
      return;
    }

    // The extension's analyze/import routes are handled BEFORE the localhost
    // CSRF guard and enforce their own extension-origin contract.
    if (pathname === "/api/extension/analyze" ||
        pathname === "/api/extension/import" ||
        pathname === "/api/extension/pairing-request") {
      void handleExtensionRoutes(req, res, pathname, workspaceDir);
      return;
    }

    // Same-origin/Host guard for the local API (any loopback bind). Use the
    // resolved listening port so an isolated port:0 runtime stays protected.
    const loopbackBind = isLoopbackBindHost(host);
    if (isApiPathname(pathname) && loopbackBind) {
      const allowedHosts = new Set([
        `localhost:${listeningPort}`,
        `127.0.0.1:${listeningPort}`,
        `[::1]:${listeningPort}`
      ]);
      allowedHosts.add(hostHeaderFor(host, listeningPort));
      if (!allowedHosts.has(req.headers.host ?? "")) {
        sendJson(res, 403, { error: "Forbidden host." });
        return;
      }
      if (req.headers.origin) {
        let originHost = "";
        try {
          originHost = new URL(req.headers.origin).host;
        } catch {
          // Keep the non-matching sentinel for a malformed Origin.
        }
        if (!allowedHosts.has(originHost)) {
          sendJson(res, 403, { error: "Cross-origin request blocked." });
          return;
        }
      }
    }

    if (pathname === "/api/health") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Use GET." });
        return;
      }
      sendJson(res, 200, createRoleFitHealthPayload(mode, workspaceDir));
      return;
    }

    if (pathname === "/api/providers") {
      handleProviderConnections(req, res);
      return;
    }

    // Polled same-origin by the app; unlike analyze/import, inbox stays behind
    // the Host/Origin guard and never advertises extension CORS.
    if (pathname === "/api/extension/inbox") {
      const tabId = routeUrl.searchParams.get("tabId") || "";
      const claimToken = cleanExtensionClaimToken(routeUrl.searchParams.get("claimToken"));
      void handleExtensionInbox(req, res, tabId, claimToken);
      return;
    }

    if (pathname === "/api/extension/pairing-requests") {
      handleExtensionPairingRequests(req, res);
      return;
    }

    if (pathname === "/api/polish") {
      void handlePolish(req, res);
      return;
    }

    if (pathname === "/api/distill") {
      void handleDistill(req, res);
      return;
    }

    if (pathname === "/api/application-answers") {
      void handleApplicationAnswers(req, res);
      return;
    }

    if (pathname === "/api/cover-letter") {
      void handleCoverLetter(req, res);
      return;
    }

    if (pathname === "/api/import-job") {
      void handleImportJob(req, res);
      return;
    }

    if (pathname === "/api/workspace") {
      void handleWorkspace(req, res, workspaceLocations);
      return;
    }

    if (pathname === "/api/workspace/base-resume") {
      void handleWorkspaceBaseResume(req, res, workspaceLocations);
      return;
    }

    if (pathname === "/api/workspace/base-resume/select") {
      void handleSelectBaseResume(req, res, workspaceLocations);
      return;
    }

    if (pathname === "/api/workspace/base-resume/restore") {
      void handleRestoreBaseResume(req, res, workspaceLocations);
      return;
    }

    if (pathname === "/api/applications") {
      if (req.method === "GET") {
        void handleListApplications(req, res, workspaceDir);
      } else if (req.method === "PUT" || req.method === "POST") {
        void handleSaveApplications(req, res, workspaceDir);
      } else {
        sendJson(res, 405, { error: "Use GET or PUT." });
      }
      return;
    }

    const appIdMatch = pathname.match(/^\/api\/applications\/([^/]+)$/);
    if (appIdMatch) {
      const id = decodeRouteSegment(appIdMatch[1]);
      if (id === null) {
        sendJson(res, 400, { error: "Invalid application id." });
        return;
      }
      void handleDeleteApplication(req, res, id, workspaceDir);
      return;
    }

    const resumeFileMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume\.pdf$/);
    if (resumeFileMatch) {
      const id = decodeRouteSegment(resumeFileMatch[1]);
      if (id === null) {
        sendJson(res, 400, { error: "Invalid application id." });
        return;
      }
      void handleApplicationResumeFile(req, res, id, workspaceDir);
      return;
    }

    const resumeSaveMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume$/);
    if (resumeSaveMatch) {
      const id = decodeRouteSegment(resumeSaveMatch[1]);
      if (id === null) {
        sendJson(res, 400, { error: "Invalid application id." });
        return;
      }
      void handleSaveApplicationResume(req, res, id, workspaceDir);
      return;
    }

    // Never let an unknown API URL reach a SPA fallback.
    if (isApiPathname(pathname)) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        res.writeHead(404);
        res.end("Not found");
      });
      return;
    }

    void serveStatic(req, res, appRoot);
  });

  try {
    listeningPort = await listen(server, configuredPort, host);
  } catch (error) {
    await vite?.close();
    throw error;
  }

  const origin = `http://${originHost(host)}:${listeningPort}`;
  try {
    logger?.info(`RoleFit AI running at ${origin}/`);
    if (!isLoopbackBindHost(host)) {
      logger?.warn(`Bound to ${host} (HOST override): potentially reachable from the network. This app has no auth.`);
    }
    logger?.info(`Default AI provider: ${defaultProvider}`);
    logger?.info(`Default AI model: ${defaultModel || "(CLI default)"}`);
  } catch (error) {
    await Promise.all([closeHttpServer(server), vite?.close()]);
    throw error;
  }

  let closePromise: Promise<void> | null = null;
  return {
    origin,
    host,
    port: listeningPort,
    mode,
    close() {
      closePromise ??= Promise.all([closeHttpServer(server), vite?.close()]).then(() => undefined);
      return closePromise;
    }
  };
}
