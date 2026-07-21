# RoleFit AI Local Provider Companion Architecture Plan

Status: Phases P0-P4 and P5/D0-D4 implemented locally; P5/D5 deferred
Date: 2026-07-19
Scope owner: `apps/role-fit-ai/`

This plan supersedes both the earlier full-app Electron host and the interim
three-provider companion. RoleFit remains a browser-primary local application.
Electron is a compact local provider manager: it starts the trusted loopback
service, stores supported API credentials locally, connects supported
subscription CLIs, links to official install/sign-in docs and offers an
external-terminal sign-in, and opens RoleFit in the default browser.

There is still no RoleFit account, application login, database, cloud sync, or
second Drafting Desk.

## Product outcome

RoleFit has one product surface and one local setup surface:

- the Drafting Desk in a normal browser at the companion-selected loopback
  port (`http://localhost:5181` by default);
- the existing browser extension, which imports jobs into fresh browser tabs;
- a compact Electron companion that manages exactly five supported providers.

The supported provider catalog is:

| Provider | Kind | Companion setup |
| --- | --- | --- |
| Claude Code | CLI | detect `claude`, link to official install/sign-in docs and offer an external-terminal sign-in |
| Codex | CLI | detect `codex`, link to official install/sign-in docs and offer an external-terminal sign-in |
| Antigravity | CLI | detect `agy`, hand off to its interactive provider-owned terminal flow |
| OpenAI | API | accept and securely persist one local API key |
| Claude | API | accept and securely persist one local API key |

The companion lists the complete supported catalog for setup. The browser AI
menu lists only providers the user has explicitly added. A configured provider
whose credential or CLI session is temporarily unavailable remains visible but
disabled with a reconnect action; a never-added provider is absent. If none are
configured and ready, AI actions stop with an actionable “Add a provider in
RoleFit Companion” state rather than silently selecting a default or a paid
provider.

Distill, Tailor, and Review retain independent provider/model/effort choices in
browser preferences. One stored API credential is shared by the local server
for all stages using that provider; keys are not duplicated per stage.

## Interpretation of “browser app”

This architecture applies to the same-origin local browser application served
by the RoleFit loopback server. The separate hosted product/download page is
not a remote client of a desktop process and does not bundle the Drafting Desk.

A hosted HTTPS page talking to loopback would require explicit pairing,
short-lived authorization, exact-origin CORS, Private Network Access/browser
compatibility work, and a new data-ownership decision. Broad CORS, a public
companion endpoint, and hosted-page pairing remain forbidden.

## Runtime architecture

```text
normal browser                              Electron companion
┌────────────────────────┐                 ┌────────────────────────┐
│ RoleFit Drafting Desk  │                 │ Local provider desk    │
│ localhost:<site port>  │                 │ file:// companion UI   │
└───────────┬────────────┘                 └───────────┬────────────┘
            │ same-origin HTTP                         │ fixed typed IPC
            │ provider ids only                        │ no secrets returned
            v                                          v
┌────────────────────────┐    private parent/child   Electron main
│ loopback RoleFit server│<──────────────────────────│ provider vault
│ AI execution + registry│    credential snapshot   │ CLI connection mgr
└───────────┬────────────┘                           └────────────────
            │
      provider API/CLI
```

Electron main owns:

- single-instance application lifecycle and the local provider window;
- starting or compatibly inspecting the loopback RoleFit server;
- the encrypted API credential vault and non-secret enabled-provider registry;
- fixed CLI installation/status probes, official install/sign-in doc links, and
  a fixed external-terminal sign-in;
- sending a bounded in-memory provider snapshot to a server process it owns;
- opening RoleFit and official installation guidance in the system browser;
- the read-only packaged runtime and native macOS/Windows distribution seams.

The local server remains the only AI executor. Resume/job payloads do not cross
Electron renderer IPC. The browser sends provider/model/effort selections but
never a stored API key. The server resolves credentials from its in-memory
companion snapshot immediately before native API dispatch.

## Local site port contract

The companion defaults the local site to port `5181`. Its compact setup page
also exposes one non-secret `Local site port` setting. Applying a new integer
from `1` through `65535` first checks numeric loopback availability, saves a
versioned document at
`app.getPath("userData")/desktop-settings/settings.json`, and relaunches the
companion through the normal quit path so the owned server shuts down cleanly.
Malformed or unreadable saved settings fail back to `5181` with a bounded
warning rather than selecting a random port.

`ROLEFIT_DESKTOP_PORT` is a per-launch operator/test override. When present it
wins over the saved value and locks the renderer setting; it is not persisted.
Standalone development continues to use `PORT`, while the companion-owned
runtime uses only its desktop setting/override.

A port is part of a browser origin. Changing it creates a different
`localStorage` origin, so browser-only drafts and stage preferences from the old
port do not automatically appear at the new one. Changing the port never moves
the current workspace or provider vault; packaged runs keep both beneath their
operating-system `userData` locations. The current browser extension's API
target remains fixed at `http://localhost:5181`; a custom companion port
therefore supports direct browser use only. Extension import on custom ports
requires a separate extension setting and trust/validation design and is not
implied by this setting.

## Provider state contract

One provider has two independent state dimensions:

- `configured`: the user explicitly added it to RoleFit;
- `ready`: RoleFit can currently use it.

API providers are configured when an encrypted key exists and ready when the
companion-owned server has the decrypted in-memory credential. CLI providers
are configured when the user explicitly adds them. A CLI with a supported
non-interactive status contract is ready when its executable and usable session
are confirmed. An expired or missing CLI remains configured but not ready so
the browser can show a reconnect state without erasing stage preferences.

Antigravity 1.1.x has no non-interactive auth-status command. After the user
explicitly adds an installed `agy`, RoleFit marks it request-eligible as ready
to verify while retaining `authState: "unknown"`; `ready` in this one manual
case means RoleFit may attempt a user-requested call, not that authentication
was detected. It must never be labeled signed in from installation alone. The
first actual Antigravity provider request verifies the provider-owned session
and returns actionable sign-in guidance if authentication fails.

For an owned server, Electron main periodically republishes this shape-only
snapshot while the companion renderer is hidden or closed. The browser must not
depend on the setup window remaining open for fresh CLI readiness. Refreshes are
serialized with vault mutations so a slower older probe cannot overwrite newer
configured state. When the setup window is visible, its existing typed-IPC poll
drives the same synchronization instead of duplicating CLI probes.

Removing a CLI removes it only from RoleFit; it does not log out or delete the
provider’s global credentials. Removing an API provider deletes RoleFit’s
encrypted credential blob and its configured metadata.

## Local API credential vault

API keys are sensitive local secrets. They must not be stored in browser
`localStorage`, workspace JSON, plaintext `.env` created by the app, renderer
memory beyond the submission event, HTTP requests, logs, or provider-status
payloads.

Electron main uses the asynchronous `safeStorage` API:

1. Validate a closed API-provider id and a bounded non-empty key.
2. Encrypt the key after `app.whenReady()`.
3. Atomically persist only encrypted bytes beneath `app.getPath("userData")`.
4. Persist enabled provider ids as a separate non-secret field in the versioned
   vault document; credential values remain ciphertext-only.
5. Decrypt only to refresh the owned server’s in-memory credential snapshot.
6. Re-encrypt when the platform backend reports key rotation.
7. Zero or release transient buffers/references as soon as practical.

Persistent storage is allowed only when a secure OS backend is available.
Linux `basic_text` or unavailable encryption must fail closed with a
session-only/unavailable explanation; RoleFit never silently downgrades to
plaintext storage.

The renderer can save, remove, and inspect shape-only state, but it can never
read a stored key back. There is no “show saved key” feature.

## Owned-server credential bridge

The Electron-owned RoleFit server runs as a utility child. Electron main sends
one versioned, bounded structured-clone message through the private
parent/child channel:

```text
{
  type: "rolefit-provider-snapshot",
  schemaVersion: 1,
  providers: [{ id, kind, configured, ready, authState, guidance }],
  credentials: { openai?: string, anthropic?: string }
}
```

The server validates the entire message, replaces its in-memory snapshot
atomically, and never exposes the credential map. Updates occur after vault or
CLI state changes. Before the HTTP listener starts, the Electron utility entry
installs an empty authoritative snapshot, skips app-local `.env` loading, and
inherits no managed API credential. Shutdown clears the snapshot.

A compatible server started independently with `npm run dev:rolefit` cannot be
trusted with Electron vault data because it has no private parent channel.
The honest behavior is:

- companion-owned server: full managed provider registry and vault;
- standalone/reused server: `companionManaged: false`; explicitly configured
  `.env` credentials may remain valid for headless/development requests, but
  Electron-stored providers are unavailable;
- the companion instructs the user to stop the standalone server and reopen
  RoleFit through the companion before changing managed providers; save,
  remove, and enable actions fail while that reused listener remains active.

No secret is injected through argv, process environment, URL, or a public
loopback management route.

## Browser provider endpoint

The local server exposes one same-origin, read-only route:

```json
{
  "schemaVersion": 1,
  "companionManaged": true,
  "providers": [
    {
      "id": "openai",
      "kind": "api",
      "configured": true,
      "ready": true,
      "authState": "not-applicable",
      "guidance": "OpenAI API access is stored securely on this device."
    }
  ]
}
```

The route returns only closed provider ids, kind, configured/readiness, a
small auth-state enum, and bounded user-safe recovery guidance. It never
returns keys, account identifiers, executable paths, versions, raw CLI output,
errors, operation ids, or workspace details.

The browser keeps the complete five-provider catalog for validation, labels,
models, and server contracts, then filters display options by the endpoint.
Persisted stage selections are reconciled without a paid-provider fallback:

- configured but not ready: keep selection, disable its AI action, show
  reconnect guidance;
- removed: require an explicit replacement or select the sole ready provider
  only when that choice is unambiguous and free of paid-provider surprise;
- no configured provider: keep the editor/tracker usable and disable AI.

The browser’s API-key fields and `apiKey`/`auditApiKey` request plumbing are
removed for managed use. `.env` remains a documented developer/headless
fallback, not an app-created credential store.

## CLI install and login UX

> **Superseded (managed in-app sign-in removed):** RoleFit no longer spawns a
> managed login child. CLI rows now link to official install/sign-in docs
> (**Sign-in guide**) and offer an external-terminal sign-in (**Terminal ↗**).
> The single-flight/time-bounded/cancellable spawned-login details below are
> retained only as historical context; the external-terminal sign-in and the
> official install/sign-in-guide links remain valid.

The companion may provide a RoleFit connection screen. It must not provide a
username/password form or handle provider passwords, MFA, SSO, authorization
codes, refresh tokens, or CLI credential files.

| Provider | Normal companion action | Fallback |
| --- | --- | --- |
| Claude Code | fixed `claude auth login --claudeai` | open a real terminal when callback-code interaction is required |
| Codex | fixed `codex login` | structured/version-gated provider flow or real terminal/device flow |
| Antigravity | open a real terminal with fixed `agy` | constrained PTY only in a separately reviewed phase |

Hidden `stdio: "ignore"` is insufficient when a provider needs a URL, device
code, callback code, or diagnostic. The first robust implementation keeps the
normal browser-opening flow and adds a user-initiated external-terminal
fallback; it does not build a fake login form.

Missing executables are detected with fixed bounded version probes. The
companion shows `Not installed`, a user-initiated link to official installation
instructions, and `Check again`. It does not silently execute npm, Homebrew,
WinGet, curl-piped installers, elevated commands, or renderer-supplied shell
text. A guided installer would be a separate destructive/system-mutation phase.

An ordinary web page cannot reliably distinguish “companion closed” from “not
installed.” RoleFit does not need that distinction: the public site presents
the companion as required, offers explicit platform downloads, and never probes
localhost. A future one-click native handoff would still require a separately
designed and signed custom protocol/pairing contract; it is not part of D4.

## Security contract

- Companion renderer: local static file, strict CSP, sandbox, context
  isolation, no Node integration, no webviews, and every permission denied.
- Exact `file:` main-frame and exact `webContents` validation for every IPC
  request.
- Fixed methods and closed ids only; no generic IPC, shell, filesystem,
  environment, command, argv, or listener APIs.
- API-key save accepts one bounded string and returns shape-only success; no
  read/export/reveal method exists.
- CLI commands and official URLs are main-owned allowlists. Renderer input
  never becomes a command or URL; every renderer `window.open` request is
  denied. Typed IPC can open only the selected local RoleFit origin or an
  official guide selected from a closed provider id.
- Provider status is bounded and shape-only. Raw CLI/API output is discarded.
- *(Historical: the managed in-app sign-in was removed.)* The retained
  external-terminal sign-in and bounded status probes terminate only owned
  children; the earlier managed login was single-flight, time-bounded, and
  cancellable.
- The public loopback server never receives an Electron management bearer or
  vault mutation route. Browser and extension tokens never authorize IPC.
- Numeric-loopback bind, Host/Origin/CSRF guards, and extension CORS remain
  unchanged.
- Automated tests use fake keys, fake CLI processes, fake encryption, and
  isolated user-data/workspace paths. Live login and paid AI calls are opt-in.

## Local data ownership

| Data | Owner | Persistence |
| --- | --- | --- |
| Resume, tracker, application artifacts | RoleFit server | ignored local workspace |
| Recovery resume/job drafts, sessions, stage settings, and user context/preferences | browser | origin-scoped browser storage, no API keys |
| API credential | Electron main | `safeStorage` encrypted bytes under `userData` |
| Configured provider ids | Electron main | versioned non-secret registry under `userData` |
| Local site port | Electron main | versioned non-secret settings under `userData` |
| Decrypted API credential | owned local server | memory only, private parent channel |
| CLI credential/session | provider CLI | provider-owned local credential store |
| CLI status-probe progress | Electron main | memory only |

No SQLite, RoleFit authentication, cloud synchronization, provider account
creation, or hosted credential service is introduced.

## Browser extension behavior

The extension remains a client only of `http://localhost:5181` extension
routes. An import opens a fresh browser RoleFit tab with its claim token. It
does not discover, install, configure, or authenticate providers and never
receives provider credentials. Selecting a different companion site port does
not rewrite the installed extension configuration or its route target; extension
imports remain a default-port-only workflow in this phase.

## Source ownership

```text
apps/role-fit-ai/
  desktop/
    provider-vault.cts              encrypted keys + enabled ids
    cli-providers.cts               fixed CLI probes/sign-in
    ipc-contract.cts                fixed serializable companion API
    ipc.cts / preload.cts           exact trusted bridge
    desktop-settings.cts            versioned non-secret site-port setting
    runtime-paths.cts               source/package app, server, and workspace paths
    forge.config.cjs                native package/signing/fuse contract
    main.cts                        lifecycle + five-provider state composition + owned-server snapshot sync
    companion.*                     local setup UI
  server/
    provider-connections.ts         validated in-memory snapshot + public route
    runtime.ts                      same-origin route composition
  src/
    hooks/useAvailableProviders.ts  fetch/reconcile lifecycle
    config/aiOptions.ts             complete supported catalog/models
    sections/ProviderSection.tsx    filtered provider/model UI, no key field
```

Do not add desktop behavior to `@typeset/engine` or `@typeset/editor`. Avoid a
fifth provider catalog: derive companion/server validation from one explicit
shared app-owned contract where module/runtime boundaries permit it, or lock
the closed ids byte-for-byte with contract tests.

## Implementation phases

### Phase P0 — Contract correction

1. Save this plan before runtime changes.
2. Update product, architecture, privacy, testing, and scoped agent guidance.
3. Define provider ids, configured/readiness semantics, vault ownership, and
   standalone/reused-server behavior.

Acceptance: no active document still claims API keys are browser-only or that
the companion manages only CLIs.

### Phase P1 — Provider vault and typed IPC

1. Add fakeable async encryption/file adapters and atomic versioned storage.
2. Add fixed list/save/remove/enable provider methods.
3. Keep saved keys write-only from the renderer.
4. Extend static companion UI for both API and CLI providers.

Acceptance: offline vault/IPC tests prove round trips, malformed rejection,
deletion, insecure-backend refusal, exact-sender checks, and no key exposure.

### Phase P2 — Owned-server provider bridge

1. Add validated private parent/child snapshot messages.
2. Add server in-memory credential resolution and shape-only `/api/providers`.
3. Refuse vault injection into reused standalone listeners.
4. Clear secrets on replacement/shutdown.

Acceptance: owned/reused process tests prove keys never enter HTTP, env, argv,
logs, or public status responses.

### Phase P3 — Browser configured-provider menu

1. Add a focused availability hook with one same-origin fetch lifecycle.
2. Filter provider selectors without duplicating model metadata.
3. Remove browser API-key fields/request plumbing for managed providers.
4. Reconcile removed/unready selections without a silent provider fallback.
5. Add no-provider and companion-unavailable states while preserving non-AI
   browser workflows.

Acceptance: browser QA proves only configured providers appear, keys are absent
from DOM/storage/requests, AI is disabled truthfully with none, and editor,
tracker, extension inbox, and multi-tab behavior remain browser-owned.

### Phase P4 — Provider-owned login and install recovery

> **Superseded (managed in-app sign-in removed):** RoleFit no longer spawns a
> managed login child. CLI rows now link to official install/sign-in docs
> (**Sign-in guide**) and offer an external-terminal sign-in (**Terminal ↗**).
> The browser-opening/spawned-login steps below are retained only as historical
> context; the install-recovery links and the external-terminal sign-in remain
> valid.

1. Add official installation links for missing CLIs and `Check again`.
2. Keep Claude/Codex fixed browser-opening login flows.
3. Add explicit terminal fallback where interactive input is required.
4. Keep Antigravity auth state unknown, make installed/configured Antigravity
   request-eligible as ready-to-verify, and let the first actual provider
   request verify or report authentication failure.

Acceptance: no custom password form, auto-installer, renderer shell input, or
false signed-in claim; request eligibility is not presented as detected auth.

### Phase P5 — Distribution (D0-D4 implemented; D5 deferred)

The authorized distribution work is specified in
[the distribution and cloud plan](distribution-cloud-plan.md). D0-D4 are
implemented locally: the packaged runtime has a read-only application/writable
`userData` split; Electron Forge produces native macOS arm64/x64 and Windows x64
targets; package contents, fuses, runtime paths, and process shutdown have
focused probes; and the tag-triggered GitHub workflow provides fail-closed
signing/notarization, artifact verification, and atomic publication seams.

This does not claim that a public signed release has run. Maintainers must
configure protected signing environments and secrets, protect `rolefit-v*`
tags, and intentionally create a matching version tag before the workflow can
publish. The isolated product/download page is complete, while R2 mirroring and
native site handoff, `rolefit://`, auto-update, tray/menu-bar residency, and
startup-at-login (D5) remain deferred. The companion includes bounded packaged GUI PATH discovery
for supported CLIs; arbitrary production shell discovery remains forbidden.

## Verification matrix

Run from the repository root:

```bash
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
npm run test:server-lifecycle --workspace apps/role-fit-ai
npm run build:rolefit
npm run build:rolefit:desktop
npm run test:desktop:vault --workspace apps/role-fit-ai
npm run test:desktop:security --workspace apps/role-fit-ai
npm run test:desktop:contracts --workspace apps/role-fit-ai
npm run test:desktop:cli --workspace apps/role-fit-ai
npm run test:desktop:settings --workspace apps/role-fit-ai
npm run test:desktop:ipc --workspace apps/role-fit-ai
npm run test:rolefit:desktop
npm run build:rolefit:desktop:package
npm run package:rolefit:desktop
npm run test:rolefit:desktop:packaged
npm run make:rolefit:desktop
npm run test:rolefit:release
npm run check --workspace apps/role-fit-ai
npm run check
npm test
git diff --check
```

Manual verification:

1. Start with isolated workspace/user-data and an owned server.
2. Add fake/synthetic OpenAI and Claude API keys; confirm only configured state
   returns and no key appears in DOM, IPC results, HTTP, logs, or browser storage.
3. Add/remove each CLI using fake status processes; verify installed,
   signed-out, configured, ready, and reconnect states.
4. Confirm browser menus show only configured providers across all three stages.
5. Confirm no provider disables AI but leaves editing/tracker/export usable.
6. Confirm reused-server mode refuses managed vault injection.
7. Confirm extension imports still claim fresh browser tabs and await initial
   provider discovery instead of recording `loading` as a failed Distill.
8. Close the setup window, change a fake CLI auth result, and confirm the owned
   server snapshot refreshes without renderer IPC.
9. Confirm shutdown leaves no owned server or owned child process and clears
   snapshots.

Live API-key validation, provider login, and AI generation require explicit
authorization and synthetic/approved content because they may open account
flows, consume quota, or transmit data.

## Current implementation scope

The current provider-manager implementation completes Phases P0-P4 and the
authorized P5/D0-D4 distribution slice. It must not begin D5 or add:

- SQLite or another database;
- a RoleFit account/login system;
- cloud synchronization or hosted credential storage;
- broad CORS or hosted-page pairing;
- browser-extension native messaging;
- silent CLI installation or package-manager mutation;
- R2 mirroring or alternate binary origins;
- auto-update, custom protocol, startup-at-login, or tray/menu-bar residency.

## Definition of done

RoleFit remains browser-primary; Electron manages only local provider setup and
server lifecycle; API keys are encrypted locally and never exposed to the
browser; the browser lists only explicitly configured providers; CLI login and
installation stay provider-owned and truthful; the server remains the only AI
executor; the selected loopback port stays non-secret and explicit; native
artifacts keep application resources read-only and user data writable; and
focused vault, settings, IPC, server, browser, Electron, package, and repository
checks are green with skipped live-provider/signing work reported precisely.
