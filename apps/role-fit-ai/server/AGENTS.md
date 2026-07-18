# RoleFit Server Guide

Applies to `apps/role-fit-ai/server/` and `server.ts`. Read `server/ai/AGENTS.md`
for provider, prompt, sanitizer, and review work.

## Ownership

- `server.ts` owns composition: environment loading, Vite/static serving,
  security guards, and explicit route dispatch. Keep route implementation in
  focused modules.
- `http.ts` owns body/JSON/fetch utilities and request limits.
- `network.ts` owns SSRF-safe public-page fetching and redirect validation.
- `jobImport.ts` owns ATS/public job-text resolution.
- `workspace.ts` owns ignored base-resume storage and history.
- `applications/` owns tracker persistence and routes.
- `extension/` owns extension-origin routes and inbox handoff.
- `ai/` owns all provider calls and AI response contracts.

## Rules

- Bind loopback by default; preserve Host/CSRF checks for `localhost`,
  `127.0.0.1`, and `[::1]`. Extension routes accept and reflect any
  well-formed supported extension-scheme Origin by default; operators may pin
  exact origins with `EXTENSION_ALLOWED_ORIGINS`. Never admit arbitrary web
  Origins, an absent/malformed Origin, or wildcard CORS.
- Validate request boundaries, cap bodies, and return stable user-safe JSON.
- Keep file operations inside the configured RoleFit workspace. Defend against
  traversal, unsafe names, malformed JSON, and oversized data.
- Never log keys, prompts, raw resumes/jobs, provider bodies, or broad envs.
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
- Server changes require the server TypeScript gate and focused route/eval;
  restart the running RoleFit process when server module loading would stay stale.
