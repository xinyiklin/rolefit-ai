import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { handlePolish } from "./server/ai/polish.ts";
import { handleDistill } from "./server/ai/distill.ts";
import { getDefaultModel, getDefaultProvider } from "./server/ai/providers.ts";
import { handleApplicationAnswers } from "./server/ai/applicationAnswers.ts";
import { handleCoverLetter } from "./server/ai/coverLetter.ts";
import { isApiPathname, sendJson } from "./server/http.ts";
import {
  ensureJobWorkspace,
  handleRestoreBaseResume,
  handleSelectBaseResume,
  handleWorkspace,
  handleWorkspaceBaseResume
} from "./server/workspace.ts";
import { handleImportJob } from "./server/jobImport.ts";
import {
  handleApplicationResumeFile,
  handleDeleteApplication,
  handleListApplications,
  handleSaveApplicationResume,
  handleSaveApplications
} from "./server/applications/routes.ts";
import {
  cleanExtensionClaimToken,
  handleExtensionInbox,
  handleExtensionRoutes
} from "./server/extension/routes.ts";

const root = process.cwd();
const isProduction = process.env.NODE_ENV === "production";
const engineFontsRoot = dirname(
  fileURLToPath(import.meta.resolve("@typeset/engine/fonts/LMRoman10-Regular.woff2"))
);

async function loadLocalEnv() {
  try {
    const env = await readFile(join(root, ".env"), "utf8");
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

await loadLocalEnv();
await ensureJobWorkspace();

const port = Number(process.env.PORT ?? 5181);
// Bind to loopback by default: this app has no auth and exposes URL-fetch and
// file-storage endpoints, so it must not be reachable from other devices on the
// network. Set HOST=0.0.0.0 to opt into LAN access.
const host = (process.env.HOST || "127.0.0.1").trim().toLowerCase();

function isLoopbackBindHost(value: string): boolean {
  if (["localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1"].includes(value)) return true;
  const match = value.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255));
}

function hostHeaderFor(value: string): string {
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

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Parse the request target against a fixed local base. The Host header is
  // untrusted and validated separately for API routes; using it as a URL base
  // lets a malformed Host throw before the guard can return a controlled 4xx.
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const distRoot = resolve(join(root, "dist"));
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
        ".css": "text/css",
        ".svg": "image/svg+xml"
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
    const index = await readFile(join(root, "dist", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(index);
  }
}

async function serveEngineFont(pathname: string, res: ServerResponse): Promise<void> {
  const match = pathname.match(/^\/fonts\/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:woff2|otf|ttf))$/);
  if (!match) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filePath = resolve(join(engineFontsRoot, match[1]));
  if (!filePath.startsWith(engineFontsRoot + sep)) {
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

const vite = isProduction
  ? null
  : await createViteServer({
      root,
      appType: "spa",
      optimizeDeps: {
        include: ["pdf-lib", "@pdf-lib/fontkit"]
      },
      server: {
        middlewareMode: true
      }
    });

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
    void serveEngineFont(pathname, res);
    return;
  }

  // The extension's analyze/import routes are handled BEFORE the localhost CSRF
  // guard: they are called cross-origin from a chrome-extension:// page (an
  // Origin the localhost allowlist would reject) and do their own
  // extension-scheme Origin validation + CORS inside. The inbox route is NOT
  // here — it is polled same-origin by the app itself, so it stays behind the
  // normal CSRF/Host guard below (and never advertises CORS).
  if (pathname === "/api/extension/analyze" || pathname === "/api/extension/import") {
    void handleExtensionRoutes(req, res, pathname);
    return;
  }

  // Same-origin/Host guard for the local API (any loopback bind): a website the
  // user visits must not be able to drive this server cross-origin (CSRF) or read the
  // resume via DNS-rebinding. A rebind/cross-site request carries a foreign Host or
  // Origin. Skipped only for a non-loopback HOST override (LAN access is already
  // an opt-in "no auth, reachable" mode). Static asset requests are unaffected.
  const loopbackBind = isLoopbackBindHost(host);
  if (isApiPathname(pathname) && loopbackBind) {
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    allowedHosts.add(hostHeaderFor(host));
    if (!allowedHosts.has(req.headers.host ?? "")) {
      sendJson(res, 403, { error: "Forbidden host." });
      return;
    }
    if (req.headers.origin) {
      let originHost = ""; // malformed Origin → never matches → blocked
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {
        /* keep sentinel */
      }
      if (!allowedHosts.has(originHost)) {
        sendJson(res, 403, { error: "Cross-origin request blocked." });
        return;
      }
    }
  }

  // Polled same-origin by the app's useExtensionInbox hook; CSRF/Host-guarded
  // above like every other /api/ route (so a foreign page can't drain it).
  if (pathname === "/api/extension/inbox") {
    const tabId = routeUrl.searchParams.get("tabId") || "";
    const claimToken = cleanExtensionClaimToken(routeUrl.searchParams.get("claimToken"));
    void handleExtensionInbox(req, res, tabId, claimToken);
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
    void handleWorkspace(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume") {
    void handleWorkspaceBaseResume(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume/select") {
    void handleSelectBaseResume(req, res);
    return;
  }

  if (pathname === "/api/workspace/base-resume/restore") {
    void handleRestoreBaseResume(req, res);
    return;
  }

  if (pathname === "/api/applications") {
    if (req.method === "GET") {
      void handleListApplications(req, res);
    } else if (req.method === "PUT" || req.method === "POST") {
      void handleSaveApplications(req, res);
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
    void handleDeleteApplication(req, res, id);
    return;
  }

  const resumeFileMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume\.pdf$/);
  if (resumeFileMatch) {
    const id = decodeRouteSegment(resumeFileMatch[1]);
    if (id === null) {
      sendJson(res, 400, { error: "Invalid application id." });
      return;
    }
    void handleApplicationResumeFile(req, res, id);
    return;
  }

  const resumeSaveMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume$/);
  if (resumeSaveMatch) {
    const id = decodeRouteSegment(resumeSaveMatch[1]);
    if (id === null) {
      sendJson(res, 400, { error: "Invalid application id." });
      return;
    }
    void handleSaveApplicationResume(req, res, id);
    return;
  }

  // Never let an unknown API URL reach Vite's SPA fallback (development) or
  // index.html (production). Clients should receive a stable JSON 404 instead
  // of a misleading 200 HTML response and a downstream JSON parse failure.
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

  void serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`RoleFit AI running at http://localhost:${port}/`);
  if (!isLoopbackBindHost(host)) {
    console.log(`⚠️  Bound to ${host} (HOST override): potentially reachable from your network. This app has no auth.`);
  }
  console.log(`Default AI provider: ${getDefaultProvider()}`);
  console.log(`Default AI model: ${getDefaultModel() || "(CLI default)"}`);
});
