# RoleFit Server Guide

Applies to `apps/role-fit-ai/server/` and `server.ts`. Read `server/ai/AGENTS.md`
for provider, prompt, sanitizer, and review work.

## Ownership

- `server.ts` is the executable web-host adapter. Keep it thin: resolve the
  current app/workspace paths, call `startRoleFitServer`, and own process-signal
  shutdown.
- `server/runtime.ts` owns reusable composition: explicit standalone-only
  environment loading,
  Vite/static serving, security guards, explicit route dispatch, and the
  start/close lifecycle used by the local web entry and isolated probes. It must
  not listen or create storage merely because it was imported. Reusability does
  not make the full server a desktop companion protocol.
- `http.ts` owns body/JSON/fetch utilities and request limits.
- `network.ts` owns SSRF-safe public-page fetching and redirect validation.
- `jobImport.ts` owns ATS/public job-text resolution.
- `workspace.ts` owns ignored base-resume storage and history.
- `applications/` owns tracker persistence and routes.
- `extension/` owns extension-origin routes and inbox handoff.
- The provider-connections boundary owns the validated in-memory companion
  snapshot, managed API-credential resolution, and the shape-only same-origin
  provider registry. Secrets never enter an HTTP response or persistent server
  storage.
- `ai/` owns all provider calls and AI response contracts.

## Rules

- Bind loopback by default; preserve Host/CSRF checks for `localhost`,
  `127.0.0.1`, and `[::1]`. Cross-origin extension analyze/import routes must
  match an exact, explicitly configured `EXTENSION_ALLOWED_ORIGINS` entry and
  reflect only that Origin. An extension scheme is not an identity; an
  unset/invalid allowlist rejects every analyze/import request. A syntactically
  valid extension origin may enqueue only a bounded, expiring pairing request;
  that route exposes no tracker/import data and requires explicit companion
  approval before the origin enters the allowlist. Never admit another installed
  extension, arbitrary web Origins, an absent/malformed Origin, or wildcard CORS.
- The ordinary `/api/*` Host/Origin guard is a browser CSRF/DNS-rebinding
  boundary, not authentication for native clients. Do not add broad web CORS,
  bearer handling, or public Electron-management routes to this runtime. The
  provider companion may start or compatibly reuse this server, but the browser
  still reaches it only through the existing same-origin application. A
  read-only `/api/providers` route may expose closed provider ids and
  configured/readiness/auth-state enums only; it is not a vault API.
- Accept managed provider credentials only through a versioned, bounded private
  parent/child message from the Electron process that created this server.
  Validate and atomically replace the complete snapshot, keep decrypted values
  in memory only, and clear them on replacement/shutdown. Never inject vault
  data into a reused listener or carry it through environment, argv, HTTP, or
  logs.
- The Electron utility entry must install an empty authoritative snapshot before
  listening and call the runtime with local `.env` loading disabled. A server
  launched independently may retain the documented `.env` fallback.
- Keep immutable application assets (`appRoot`) separate from mutable personal
  storage (`workspaceDir`). Hosts must pass both paths explicitly; server
  modules must not recover either path from a launcher's working directory.
- Keep `/api/health` content-free and stable enough for local compatibility
  probes. Its version/mode/workspace fingerprint is not secret; it must never be
  treated as browser pairing/authorization or as authority for privileged
  Electron IPC.
- Validate request boundaries, cap bodies, and return stable user-safe JSON.
- Keep file operations inside the configured RoleFit workspace. Defend against
  traversal, unsafe names, malformed JSON, and oversized data.
- Never log keys, prompts, raw resumes/jobs, provider bodies, or broad envs.
  Browser requests select a provider/model/effort but never carry a managed
  API key; `.env` keys remain an explicit standalone/headless fallback.
- Keep extension claim tokens as inbox-routing values only. They must never
  authorize companion IPC or CLI status/sign-in actions. Only bounded pending
  origin requests may surface in the companion; posting, tracker, claim-token,
  resume, and provider payloads must not cross that boundary.
- Do not import React-bearing editor modules from the Node server. Import only
  React-free engine/domain subpaths.
- Keep storage mutation serialized/atomic where concurrent tabs or routes can
  race. Application writes must reject duplicate ids, preserve the latest
  server copy of unmutated rows, and require each changed row's pre-edit
  `updatedAt`; return the current snapshot on a same-row `409` conflict rather
  than retrying or overwriting. Normalize legacy missing revisions
  deterministically so the first edit does not conflict with itself. Preserve
  recoverable history/trash behavior.
- Treat corrupt application JSON and malformed strict `.resume` content as
  visible fail-closed errors. Never erase, reseed, or guess over corrupt user
  data.
- Server changes require the server TypeScript gate and focused route/eval.
  Lifecycle/listener probes are explicit tests rather than auto-discovered
  offline evals because their loopback bind may require environment permission.
  Restart the running RoleFit process when server module loading would stay
  stale.
