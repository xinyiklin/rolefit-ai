# RoleFit AI Repository Architecture

## System shape

This RoleFit AI repository uses npm workspaces because its shared Typeset
engine and editor are still evolving together and are consumed by RoleFit and
the standalone Typeset app. The packages remain private source packages; the
repository lockfile and TypeScript base are the integration boundary.

```text
packages/engine
  resume domain + file contract + deterministic layout + renderers
          |
          v
packages/editor
  React document state + editing adapter + reusable editor chrome
          |
          +--------------------+
          v                    v
apps/typeset             apps/role-fit-ai
static product shell     public product/download entry
                         + localhost browser product + local server
                                            ^            ^
                              same-origin HTTP       lifecycle
                                            |            |
                                   browser renderer  Electron companion
```

Dependencies point downward only. Packages never import app code, and apps
never import each other.

## Ownership table

| Concern | Owner | Notes |
| --- | --- | --- |
| `ResumeData`, constructors, inline marks, links | `packages/engine/src/lib/` | Canonical domain; no app copies. |
| `.resume` validation and serialization | `packages/engine/src/lib/resumeFile.ts` | Strict `typeset-resume`, schema v1. |
| Document style and typography values | `packages/engine/src/lib/` | Persisted print state; view-only state excluded from files. |
| Font assets and generated metrics | `packages/engine/fonts/`, `packages/engine/scripts/` | Consumers mirror fonts and pass their deployment-aware asset base to PDF loading. |
| Measurement, line breaking, pagination | `packages/engine/src/typeset/` | One deterministic path for every renderer. |
| DOM/print and PDF backends | `packages/engine/src/typeset/render/`, `pdf/` | Backend painting differs; layout truth does not. |
| Document history/style hooks | `packages/editor/src/hooks/` | Shared state, no host lifecycle or storage assumptions. |
| Direct editing and selection/caret mapping | `packages/editor/src/sections/editor/` | DOM adapter over structured data. |
| Toolbar, popovers, shared editor controls | `packages/editor/src/components/` | Host-configurable, no product-specific workflow. |
| Standalone file lifecycle and autosave | `apps/typeset/` | Browser-only Typeset behavior. |
| AI workflow, job intake, tracker, workspace | `apps/role-fit-ai/` | RoleFit-only product behavior. |
| RoleFit section-scope/review overlay | `apps/role-fit-ai/src/sections/editor/` | Injected through shared editor seams; never fork the editor. |
| Public product/download page | `apps/role-fit-ai/landing/` | Separate static entry graph; public GitHub release metadata only, with no loopback calls or app renderer. |
| Electron provider setup, lifecycle, and security | `apps/role-fit-ai/desktop/` | Required distributed-product launcher and compact local manager for three supported CLIs and two supported API providers; it never hosts the RoleFit product renderer or enters shared packages. |

## Shared versus host-specific UI

Share a component when the interaction contract, accessibility behavior, and
state shape are truly common. Cross-app examples are the formatting toolbar,
popover shell, font-family picker, and direct editor. RoleFit's workflow
progress component is reusable within that app, but remains host-owned because
its stage/retry/stop semantics are product-specific.

Keep composition in the app when it carries product language, navigation,
storage, provider orchestration, tracker state, or app-specific responsive
rules. Typeset owns file identity and browser autosave; RoleFit owns Sessions,
Job, AI, Polish, Apply, review navigation, and its local workspace.

A shared component should:

- accept values and callbacks rather than reaching into host storage;
- expose deliberate slots or narrow props, not unrelated mode flags;
- remain accessible and keyboard-complete in every host;
- use package-owned base styles and documented host seams;
- avoid product-specific copy unless the copy is supplied by the host.

Do not move code into a package only to reduce an app file's line count. First
prove a stable responsibility or a second consumer. Conversely, do not fork a
shared control to make a small host adjustment; add the smallest truthful seam
and verify both apps.

## State and side-effect boundaries

- Engine modules are deterministic. The DOM renderer is the explicit React
  exception; Node consumers must import React-free engine subpaths.
- Editor hooks own document/history/style state. They do not own app file
  lifecycle, provider settings, tracker storage, or network requests.
- App hooks own cohesive product workflows and side effects. App shells compose
  hooks and derive presentation state; they should not become new domain engines.
- RoleFit server routes delegate to focused modules for AI, job import,
  workspace, applications, and extension behavior. `server/runtime.ts` owns
  reusable composition and lifecycle; host entry points supply explicit
  immutable app and mutable workspace paths. `server.ts` remains the thin web
  executable, not a catch-all service.
- RoleFit's React renderer remains browser-owned. The Electron process is the
  required distributed-product launcher and a compact five-provider manager,
  not another application host: it starts
  or reuses the same loopback server, loads only a local static companion page,
  manages the three supported subscription CLIs and the OpenAI/Claude API
  providers, and opens the Drafting Desk in the system browser. API keys are
  encrypted with Electron `safeStorage` beneath its local `userData` and are
  never returned to the renderer, browser storage, or HTTP. The server remains
  the only AI executor; a companion-owned server receives credentials only in
  memory through its private parent/child channel, and resume/job payloads never
  cross Electron IPC.
- Packaged RoleFit code and static assets remain read-only beneath the
  application bundle. Mutable workspace files, encrypted provider state, and
  the non-secret local-port setting live beneath Electron `userData`; packaging
  must never write into ASAR or depend on monorepo paths.
- The companion's saved port changes only the direct browser origin. Browser
  storage does not migrate between ports, and the browser extension remains on
  canonical port `5181` until a separate multi-port extension trust decision.
- The browser's same-origin provider registry is shape-only. Its selectors show
  only providers the user explicitly added; configured-but-unready providers
  remain visible with reconnect guidance, and no configured provider disables
  AI without disabling editor, tracker, or export workflows. Provider setup and
  secret mutation remain Electron-owned.
- The localhost browser continues to use relative same-origin `/api/*` calls. A
  Host/Origin check and `/api/health` compatibility response are not
  authentication for a hosted page. The public product/download page is a
  separate Vite entry that may call only the public GitHub Releases API; never
  bundle the Drafting Desk there, turn it into a local-companion client, or make
  the full local application API cross-origin.
- Portable file validation happens before hydration. Unknown data is never cast
  directly to application types.

## Styling boundaries

- `packages/editor/src/styles/` owns the editor/tooling base contract shared by
  both apps.
- Each app owns its surrounding shell and host-specific overrides. App CSS must
  not duplicate shared editor layout or measurement behavior.
- The resume page is engine output, not an app-specific visual approximation.
- Package CSS import order is part of the public integration contract; document
  and verify intentional overrides.

## Fonts and generated assets

The engine owns font binaries, licenses, and metrics. Each app runs a
`sync-fonts` predev/prebuild script that mirrors engine fonts into its generated,
gitignored `public/fonts/`. Never hand-edit a mirrored app copy. Change the
engine source/generator, regenerate, then run font parity and both consumer
builds. PDF consumers must pass their Vite/deployment base explicitly when
loading the mirrored sfnt files; the engine must not assume domain-root
`/fonts/` hosting.

## Change impact matrix

| Change | Minimum affected consumers |
| --- | --- |
| Engine domain or `.resume` contract | Engine check + both apps' file integrations. |
| Layout, fonts, measurement, PDF | Engine parity + both app builds; render editor/PDF when visual output changes. |
| Shared editor hook or component | Editor check + Typeset and RoleFit builds; browser-check affected hosts. |
| Typeset shell only | Typeset app check. |
| RoleFit client/server only | RoleFit app check and affected route/eval. |
| RoleFit provider manager | vault/IPC/security/CLI-adapter/provider-registry probes + ordinary-browser regression; explicit GUI/process smoke when lifecycle changes. |
| Root tooling or lockfile | Every workspace affected by the tool/dependency change. |

## Architecture anti-patterns

- app-to-app imports;
- package imports from an app;
- parallel resume models, style contracts, option lists, or mark grammars;
- renderer-specific measurement/layout fixes;
- shared components with provider/tracker/file-lifecycle knowledge;
- broad barrel exports that hide dependency direction;
- state mirrored between hooks and components without a single owner;
- treating loopback, CORS, Origin, or a health payload as hosted-page authorization;
- exposing the full RoleFit server API, provider secrets, or personal workspace through the Electron provider manager;
- persisting API keys in browser storage or sending managed keys through HTTP;
- silent compatibility layers for unshipped file formats;
- accepting weaker validation for convenience or reuse.
