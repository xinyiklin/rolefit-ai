# RoleFit Provider Companion Guide

Applies to `apps/role-fit-ai/desktop/` and `tsconfig.desktop.json`.

## Ownership

- The ordinary browser is the only RoleFit product surface. `desktop/` owns a
  compact Electron companion for keeping the local server available, managing
  exactly three subscription CLIs plus the OpenAI and Claude API providers, and
  opening RoleFit in the default browser. It does not own resume editing,
  application navigation, tracker/workspace persistence, or the shared React
  renderer.
- `main.cts` owns companion lifecycle, single-instance behavior, server
  composition, the compact local window, system-browser launch, and clean
  shutdown of processes it created. Its `BrowserWindow` loads only the static
  companion page, never the RoleFit app.
- `server-process.cts` starts or compatibly reuses the existing loopback RoleFit
  server. It never implements product APIs and never terminates a listener it
  did not create.
- `companion.html` owns the local-file CSP; `security.cts` owns permissions,
  navigation, external-window, and webview policy.
- `ipc-contract.cts` owns the fixed serializable companion methods;
  `ipc.cts` validates the exact companion main frame and `file:` URL and tears
  handlers down; `preload.cts` exposes only the frozen named API.
- The provider vault owns async `safeStorage` encryption and one atomic,
  versioned document beneath Electron `userData`. Encrypted API ciphertext and
  the distinct non-secret enabled-provider field share that document; saved
  keys are write-only from the renderer, with no read, reveal, export, HTTP,
  argv, or environment path.
- Desktop settings own a separate atomic, versioned, non-secret document under
  Electron `userData`. It contains the local site port plus the bounded exact
  origins the user approved for browser-extension access. Port changes validate
  availability; port and pairing changes restart through the normal Electron
  quit lifecycle. `ROLEFIT_DESKTOP_PORT` is an explicit locked per-launch
  override; settings never contain secrets or workspace paths.
- `runtime-paths.cts` owns the source-versus-package application, server, and
  writable-workspace resolution. `build-package.mjs` owns the minimal staged
  runtime; `forge.config.cjs` owns ASAR, native makers, signing/notarization,
  fuses, identity, and immutable package layout. Generated staging and outputs
  stay under ignored `.forge/`.
- Provider connection composition owns the complete five-provider state and
  sends bounded, versioned credential snapshots only to a server process the
  companion owns. A reused standalone listener never receives vault data and
  provider save/remove/enable mutations must fail until the user stops that
  listener and reopens RoleFit through the companion.
- Main keeps the owned server's shape-only provider snapshot current while the
  companion window is hidden or closed. Snapshot refreshes and mutations are
  serialized so an older probe cannot overwrite a newer vault change; renderer
  polling must not be the sole owner of browser-visible readiness.
- CLI provider adapters own fixed installation/status/sign-in commands, the
  fixed external-terminal fallback, a sanitized child environment, bounded
  process output/lifetime, and shape-only status parsing. The local server
  still owns AI execution; Electron must not fork prompts, model options,
  sanitizers, cancellation rules, or provider response handling.

## Rules

- Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webSecurity: true`, and `webviewTag: false`. Deny every renderer permission;
  the compact companion needs no clipboard, filesystem, device, notification,
  camera, microphone, or geolocation access.
- Keep the RoleFit server bind numeric-loopback-only. Port `5181` is the saved
  default; the companion may use a validated user-selected port or a locked
  `ROLEFIT_DESKTOP_PORT` override. Reuse an existing listener only after its versioned
  mode/workspace health contract matches, and never grant reused HTTP content
  privileged Electron IPC.
- An owned utility server starts with an empty authoritative companion snapshot
  before listening, skips app-local `.env` loading, and inherits no managed API
  credentials. Standalone/headless `.env` behavior belongs only to a server
  launched outside Electron.
- Open the active `http://localhost:<port>` origin in the system browser. Do not
  load that origin in the companion window or add hosted-page CORS/pairing.
  A port change creates a different origin and therefore separate browser
  `localStorage`; it does not migrate browser state. The extension remains
  fixed to `5181`, so a custom port is direct-browser-only. Deny every renderer
  `window.open`; only typed IPC may reach main-owned external targets: the
  selected browser origin and the exact official CLI installation URLs.
- Validate every IPC call against the exact companion `webContents`, main frame,
  and local `file:` URL. Expose fixed methods only; never expose `ipcRenderer`,
  generic channel names, generic send/invoke/listener methods, or renderer-
  supplied executable/argv values.
- Keep provider status shape-only: configured/ready plus bounded auth state,
  never API keys, executable paths, versions, account identifiers, raw auth
  output, broad environment data, workspace fingerprints, or provider tokens.
- Keep background provider refresh bounded, main-owned, and cleanly stopped on
  shutdown. Reuse the visible companion's typed-IPC polling instead of doubling
  CLI probes, and never refresh or inject provider state into a reused
  standalone server.
- Keep CLI status distinctions truthful: installed/signed-in/signed-out/unknown.
  Antigravity 1.1.x has no non-interactive auth-status command: when it is
  installed and explicitly configured, it may be request-eligible as
  ready-to-verify while `authState` remains `unknown`. Never infer or label it
  signed in from installation alone; the first actual provider request verifies
  the session and owns any authentication recovery error. CLI credentials stay
  in provider-owned stores; RoleFit must not ask for usernames, passwords, MFA,
  authorization codes, or recovery tokens.
- Persist API keys only when the operating-system encryption backend is secure.
  Fail closed on unavailable encryption or Linux `basic_text`; never silently
  downgrade to plaintext.
- Expose no generic command, shell, filesystem, workspace, tracker, environment,
  raw stdout/stderr, or raw IPC capability. Accept only known provider IDs and
  fixed main-owned save/remove/status/sign-in/install-guidance actions. Official
  installation URLs are allowlisted and main-owned; never accept an external
  URL from the renderer, run package managers or elevated commands, or accept
  renderer-supplied shell text.
- Keep external-terminal sign-in equally closed: the renderer supplies only a
  known CLI provider id, Electron main maps it to one fixed command/argv pair,
  and platform launchers receive no renderer-authored executable, command,
  arguments, shell text, working directory, or environment values.
- Keep saved secrets out of every IPC return. API-key save accepts only a
  closed API-provider id and one bounded non-empty value, then returns
  shape-only state.
- Keep CLI process output shape-only: never return
  executable paths, account identifiers, raw auth output, broad environment
  data, workspace fingerprints, or provider tokens.
- Bound status/sign-in startup, runtime, and output; discard process output after
  parsing; keep sign-in single-flight per provider; redact failures; and
  terminate only owned children. Strip native API/token/service-account
  credentials plus Electron/Node injection variables from every CLI child
  environment while retaining only required executable/config discovery state.
  Live sign-in tests are explicit and opt-in.
- Keep browser and extension behavior separate from companion IPC. Extension
  claim tokens remain browser inbox-routing values. A valid unapproved
  extension origin may enqueue only a bounded short-lived access request; the
  exact origin becomes active only after explicit approval in the trusted
  companion. Never imply that the saved companion port rewrites extension
  configuration or import routes.
- Treat companion process tests as explicit integration tests. They use isolated
  ports/state and fake CLI binaries and prove exact-sender rejection, bounded
  status/sign-in behavior, and clean shutdown with no orphan listener or child.
- Keep package resources read-only and all mutable workspace, vault, and
  settings data under operating-system `userData`. Never package `.env`, a
  personal workspace/vault, tests, source maps, unrelated workspace apps, or a
  `.resume` other than the bundled starter.
- Run Forge through `run-forge.mjs` on Node 24 (the wrapper accepts Node 22-24;
  Node 24 is verified) and a matching native host. Supported public targets are
  macOS arm64/x64 DMG + ZIP and Windows x64 Squirrel; cross-compilation and
  Linux packages are rejected.
- Treat the Windows installer as executable product output, not only a signed
  container. On a clean native Windows runner, silently install the normalized
  Squirrel setup, run the common packaged smoke against the absolute installed
  executable, then uninstall through the installed `Update.exe` in `finally`
  and verify the package root is gone.
- Public release builds must fail closed without platform signing material.
  macOS and Windows signing jobs target
  `rolefit-macos-signing`/`rolefit-windows-signing`; only `rolefit-release` may
  publish after all native artifacts pass. Maintainers must configure all three
  environments as protected before releasing.
  Protect `rolefit-v*` tags and keep the remote-tag commit recheck immediately
  before publication.
- The isolated hosted product/download page is implemented in D4 and may read
  only public GitHub Release metadata. R2 mirroring, custom protocols, site
  pairing, auto-update, tray/startup behavior, SQLite, RoleFit authentication,
  and synchronization remain outside D0-D4. CLI-owned provider sign-in is not
  a RoleFit account system.

## Verification

Run from the repository root:

```bash
npm run build:rolefit:desktop
npm run test:desktop:vault --workspace apps/role-fit-ai
npm run test:desktop:security --workspace apps/role-fit-ai
npm run test:desktop:contracts --workspace apps/role-fit-ai
npm run test:desktop:cli --workspace apps/role-fit-ai
npm run test:desktop:settings --workspace apps/role-fit-ai
npm run test:desktop:ipc --workspace apps/role-fit-ai
npm run test:rolefit:desktop
npm run build:rolefit:desktop:package
npm run test:desktop:package-layout --workspace apps/role-fit-ai
npm run package:rolefit:desktop
npm run test:rolefit:desktop:packaged
npm run make:rolefit:desktop
npm run test:desktop:windows-installer --workspace apps/role-fit-ai -- --installer=apps/role-fit-ai/.forge/release/RoleFit-Local-Companion-0.1.0-windows-x64.exe
npm run test:rolefit:release
```

The Electron process smoke is not part of RoleFit's auto-discovered offline
evals. It must exercise the browser/companion boundary; loading the RoleFit React
app in a `BrowserWindow` is not an acceptable substitute. The smoke must render
the compact local companion and prove that `Open RoleFit` uses the system
browser. Package/make/smoke must run on the matching native target; do not claim
Windows runtime verification from a macOS-only run or vice versa.
