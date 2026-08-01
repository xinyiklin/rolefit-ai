# RoleFit AI Repository Development And Verification

Run commands from the repository root. Use a named root command or an explicit
workspace; there is no generic root `dev`, `build`, or `preview` script.

## Requirements

- Node.js 24.18 or newer in the Node 24 line. `.node-version` pins 24.18.0,
  matching CI and Electron's embedded runtime; direct `.ts` launchers use its
  built-in type stripping.
- npm 11.16.0, declared by the root `packageManager` field, with the root
  lockfile. The root `devEngines` block fails the runtime and package-manager
  check before `install`, `ci`, or `run` proceeds, so a mismatched toolchain
  stops earlier than the dependency gate. `npm run deps:check` validates both
  runtime versions and the installed dependency contracts, including a
  recursive scan that resolves every import in `scripts/`, `apps/*`, and
  `packages/*` against its nearest owning `package.json`. A hoisted install can
  otherwise satisfy an import no manifest declares. The root `allowScripts`
  list pins the six reviewed build/native-package lifecycle scripts, and
  `.npmrc` rejects any newly introduced install script until it is reviewed.
- Dependency CI also runs `npm run deps:tree` and
  `npm run deps:audit:production`. `npm ci` proves the manifests and lockfile
  agree; it does not prove the resolved tree is internally valid or free of
  production advisories. The development tree carries known no-fix Electron
  Forge packaging advisories, so only the production audit gates.
- TypeScript 7.0.2 is the root-owned workspace compiler. Its platform package
  supplies the native `tsc` executable, so dependency CI must execute it on
  every supported runner rather than treating one host's lockfile entries as
  cross-platform proof. Electron Forge's nested TypeScript 5 compiler is
  private implementation detail and is not a workspace compiler.
- Python 3 only for engine font-generation/check scripts. Install their pinned
  dependencies from `packages/engine/scripts/requirements-fonts.txt` in an
  isolated environment; CI creates `.font-tools` and places it on `PATH`.

## Common commands

```bash
npm install

npm run dev:typeset       # http://localhost:5186, HMR 24686
npm run dev:rolefit       # http://localhost:5181
npm run dev:rolefit:desktop  # supported companion flow
npm run dev:rolefit:landing  # isolated public product/download page
npm run build:typeset
npm run build:rolefit
npm run build:rolefit:landing  # dist-landing only
npm run build:rolefit:desktop  # companion TypeScript emit
npm run build:rolefit:desktop:package  # minimal staged package runtime
npm run package:rolefit:desktop        # unpacked native application
npm run make:rolefit:desktop           # native installer/archive artifacts

npm run check             # every workspace check
npm test                  # every workspace test/eval script
npm run deps:check        # runtime, dependency contracts, undeclared imports
npm run deps:tree         # full resolved-tree validity
npm run deps:audit:production  # production advisories (gates CI)
npm run types:check       # root probe plus every workspace/server/desktop config
npm run test:editor:browser  # headless Chrome editor/lifecycle contracts
```

For a clean machine, prepare the deterministic font tools before running the
engine or root check:

```bash
python3 -m venv .font-tools
.font-tools/bin/pip install --requirement packages/engine/scripts/requirements-fonts.txt
FONT_CERT_FILE="$("$PWD/.font-tools/bin/python" -m certifi)"
SSL_CERT_FILE="$FONT_CERT_FILE" PATH="$PWD/.font-tools/bin:$PATH" \
  npm run check --workspace packages/engine
```

On Windows the virtualenv puts its interpreter in `.font-tools\Scripts\` rather
than `.font-tools/bin/`, and Python ships no `python3` executable:

```bash
python -m venv .font-tools
.font-tools\Scripts\pip install --requirement packages/engine/scripts/requirements-fonts.txt
npm run check --workspace packages/engine
```

No `PATH` export is needed on either platform: `fonts:check` runs through
`packages/engine/scripts/run-python.mjs`, which prefers this virtualenv over any
ambient interpreter so the generators always see the pinned fontTools and brotli
versions they assert. The root `.gitattributes` checks every text file out as LF,
which the generators require — they compare committed assets byte for byte, so a
CRLF working tree reports correct assets as stale.

Focused workspace commands:

```bash
npm run check --workspace packages/engine
npm run check --workspace packages/editor
npm run check --workspace apps/typeset
npm run check --workspace apps/role-fit-ai

npm run eval:resume-file --workspace packages/engine
npm run eval:cover-letter-file --workspace packages/engine
npm run eval:pdf-font-parity --workspace packages/engine
npm run fonts:check --workspace packages/engine
npm run eval:layout --workspace packages/engine
npm run eval:editor --workspace packages/editor
npm run test:document-workflows --workspace apps/role-fit-ai
npm run test:server-lifecycle --workspace apps/role-fit-ai
npm run test:desktop:vault --workspace apps/role-fit-ai
npm run test:desktop:security --workspace apps/role-fit-ai
npm run test:desktop:contracts --workspace apps/role-fit-ai
npm run test:desktop:cli --workspace apps/role-fit-ai
npm run test:desktop:settings --workspace apps/role-fit-ai
npm run test:desktop:ipc --workspace apps/role-fit-ai
npm run test:rolefit:desktop  # explicit companion process smoke
npm run test:desktop:package-layout --workspace apps/role-fit-ai
npm run test:rolefit:desktop:packaged
npm run test:rolefit:release

# Live-provider evals: drive a real AI provider; manual-only, never part of
# `check`/`test`, run only when explicitly authorized.
npm run eval:live:fabrication --workspace apps/role-fit-ai
npm run eval:live:tailor --workspace apps/role-fit-ai -- <jd-file> [runs] [resume-file]
```

Typeset preview is `npm run preview --workspace apps/typeset`. RoleFit preview
is `npm run preview --workspace apps/role-fit-ai` and starts its production-mode
local server. `npm run preview:desktop --workspace apps/role-fit-ai` is the
source-run companion integration target; it is not a second product UI or a
signed-distribution check.

## Verification matrix

| Scope | Focused checks | Broader gate |
| --- | --- | --- |
| Engine domain / `.resume` | engine typecheck, `eval:resume-file` | engine check + affected app checks |
| Engine `.cover` / cover layout | engine typecheck, `eval:cover-letter-file` | engine check + RoleFit build + rendered editor/PDF |
| Engine layout / font / PDF | `eval:layout`, `eval:pdf-font-parity`, `fonts:check` | engine check + both app builds + rendered output |
| Shared editor | editor typecheck, `eval:editor` | editor check + both app builds + `test:editor:browser` |
| Typeset shell | Typeset build/check | browser/file/PDF QA proportional to change |
| RoleFit UI | RoleFit build and focused offline eval | RoleFit check; browser QA under its scoped policy |
| RoleFit public landing | landing build boundary + release-catalog probe | desktop/390px browser QA, current unavailable state, mocked complete release, and request inspection |
| RoleFit server / AI | server TypeScript gate, `test:document-workflows`, and affected probe; explicit lifecycle test for listener changes | RoleFit check; route smoke where relevant |
| RoleFit provider manager | desktop emit + vault/file-renderer/IPC/CLI/settings/provider-registry/process probes | explicit companion GUI smoke, ordinary-browser regression, then root check/test for lockfile changes |
| RoleFit native package | staged-layout probe + matching-native packaged smoke | native make/signature checks, installed Squirrel smoke on Windows, and offline release-contract tests; signed publication only in protected CI |
| Documentation only | path/link/command validation, scoped diff check | no runtime build unless docs expose a discovered code mismatch |

Package changes are not complete after one consumer builds. Verify every host
whose public package contract changed.

### Which workflow owns which check

`Document workflow CI` (`document-workflows.yml`) is the correctness gate and
the sole per-push owner of the package suites: it runs the dependency
contracts, the six-platform TypeScript matrix, the engine codec/layout/PDF/font
suite, the shared editor, both app checks, RoleFit server transactions, and the
Chromium editor contracts.

The two deploy workflows build and ship only their own app. They deliberately
do **not** re-run the package suites: those run on the same triggers in
Document workflow CI, and each duplicate run repeated the engine's upstream
font downloads — an independent chance to fail on a socket timeout. An app
build still compiles both shared packages from source, so type and integration
breakage still fails the deploy. Treat `Document workflow CI` as the gate that
must stay green on `main`; a deploy workflow passing alone does not prove the
package suites passed.

Only `generate_font_assets.py` reaches the network. Every job that runs it
caches `/tmp/typeset-fonts`, keyed on the scripts that name the pinned upstream
commits, so a warm runner performs no downloads at all.

Both deploy workflows exclude `**/*.md` and `packages/*/scripts/**` from their
triggers: those paths cannot change a built bundle, and redeploying for them
costs a Pages publish or a container swap. Path exclusions mean a workflow can
be skipped entirely, so never mark a deploy `verify` job a required status
check — a PR that skips it would never report and would block forever.

## TypeScript compiler contract

The browser-facing root, engine, editor, RoleFit, and Typeset configs keep
bundler resolution and their existing browser targets. RoleFit's server config
is the Node-native syntax gate: ESNext/NodeNext, relative-import rewriting,
erasable syntax, verbatim modules, and no emit. The desktop config separately
emits CommonJS companion code. Run the root probe and all six child configs
when compiler settings or versions change.

Node 24 executes the source-owned `.ts` eval paths through native type
stripping. Runtime probes must not import TypeScript's JavaScript compiler API
just to load TSX; use the owning build/runtime boundary instead.

Document CI runs the TypeScript 7 compiler and every explicit config on Linux
x64/ARM64, macOS ARM64/x64, and Windows x64. Each matrix entry asserts its
actual Node platform and architecture and verifies the matching
`@typescript/typescript-*` native package before typechecking.

## Dependency and image maintenance

`.github/dependabot.yml` checks npm, SHA-pinned GitHub Actions, the Typeset
Docker bases, and the exact Python font-tool requirements. Related packages are
grouped by their verification contract. There is no dependency auto-merge
workflow: Vite, TypeScript, Electron, PDF/font, Python, and generated-asset
changes remain manual review decisions.

All third-party Actions use immutable commit SHAs with readable release
comments so Dependabot can advance both together. The Typeset Dockerfile pins
Node 24.18.0 and unprivileged Nginx by multi-architecture digest. Its PR
workflow builds that exact image and requires an HTTP response from the
unprivileged static server before deployment can proceed.

## Ports

- Typeset: `5186`, strict; HMR socket `24686`.
- RoleFit AI standalone development: `5181`, loopback by default; reserved
  range `5181-5183`; `PORT` is the explicit standalone override.
- The companion defaults to `5181` and can save a validated integer local-site
  port from `1` through `65535` under Electron `userData`. `Apply & restart`
  checks loopback availability and relaunches through clean server shutdown;
  `ROLEFIT_DESKTOP_PORT` is a locked per-launch override.
- Source extension development defaults to `5181`. The companion materializes
  its packaged extension only after resolving the active server and writes that
  numeric localhost port into the extension runtime config. After a
  port-changing restart, reload the unpacked extension once in the browser.
  Changing ports also creates separate origin-scoped `localStorage`; it does
  not migrate browser drafts/preferences. The active workspace and provider
  data remain in place; packaged runs keep them beneath operating-system
  `userData`.

A bound standalone canonical port normally means the correct app is already
running. Inspect and reuse it rather than silently selecting another port. The
companion's settings UI rejects an occupied replacement port instead of
terminating an unrelated process.

## Generated files

- `apps/*/public/fonts/` is generated by each app's `sync-fonts` script and is
  gitignored. The source of truth is `packages/engine/fonts/`.
- `packages/engine/src/typeset/metrics.gen.ts` is committed generated output;
  never hand-edit it.
- `npm run fonts:check --workspace packages/engine` reproduces and compares both
  WOFF2/metrics outputs and the PDF-embeddable TrueType siblings.
- App `dist/` directories and `node_modules/` are generated and untracked.
- `apps/role-fit-ai/dist-landing/` is the generated isolated public-site
  artifact. Pages uploads it instead of the companion-packaged `dist/` app.
- `apps/role-fit-ai/dist-electron/` is generated CommonJS companion output and
  is untracked.
- `apps/role-fit-ai/.forge/` is generated and ignored. It contains the minimal
  staged app (`app/`), unpacked/native maker output (`out/`), normalized local
  artifacts/checksums (`release/`), and CI-downloaded release inputs when
  applicable. None is a source-of-truth or personal-data location.

## RoleFit companion packaging and release

Forge commands use Node 24 and a matching native host. Supported targets are
macOS arm64/x64 and Windows x64; cross-compilation and Linux packages fail
closed. Examples:

```bash
# Apple silicon macOS
npm run package:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run test:rolefit:desktop:packaged -- --arch=arm64 --platform=darwin
npm run make:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=arm64 --platform=darwin

# Windows x64 (run on Windows)
npm run make:rolefit:desktop -- --arch=x64 --platform=win32
npm run test:rolefit:desktop:packaged -- --arch=x64 --platform=win32
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=x64 --platform=win32 --checksums=false
npm run test:desktop:windows-installer --workspace apps/role-fit-ai -- --installer=.forge/release/RoleFit-AI-0.6.0-windows-x64.exe
```

Local package/make output is not publicly trusted (macOS is ad-hoc signed only)
and must not be presented as a stable release. The `rolefit-vX.Y.Z` workflow
publishes only when the tag matches the RoleFit package version, points to a
`main` ancestor, and remains on the initially validated commit through
publish-time remote rechecks. Repository settings must protect `rolefit-v*`
tags from unauthorized creation, update, and deletion.

When signing identities are unavailable, the separate
`rolefit-preview-vX.Y.Z-beta.N` workflow may publish those native artifacts as
an explicitly unsigned GitHub prerelease. Its base version must match the
package version; it receives no signing secrets, verifies the macOS ad-hoc
integrity signature, confirms the Windows installer is unsigned, repeats the
packaged and installed lifecycle gates, and atomically publishes the complete
artifact set plus checksums. Protect `rolefit-preview-v*` tags and restrict its
write-capable `rolefit-preview-release` environment to that tag family.

Release signing targets three GitHub environments that maintainers must
restrict to the `rolefit-v*` tag policy before releasing:

- `rolefit-macos-signing`: `MAC_CERTIFICATE_BASE64`,
  `MAC_CERTIFICATE_PASSWORD`, `MAC_CSC_IDENTITY`, `APPLE_API_KEY_BASE64`,
  `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`;
- `rolefit-windows-signing`: `WINDOWS_CERTIFICATE_BASE64` and
  `WINDOWS_CERTIFICATE_PASSWORD`;
- `rolefit-release`: tag-restricted authorization boundary for the only
  `contents: write` job. Add required reviewers separately when the repository
  has an eligible reviewer who is not the release initiator.

Unsigned previews use only `rolefit-preview-release` for final publication;
the native build jobs intentionally have no GitHub environment and cannot read
the signing environments or their secrets.

The Windows pair is a compatibility path for an already-valid exportable PFX,
not a request to fabricate placeholders or export a hardware-protected key.
For a newly provisioned public-trust identity, adapt the workflow and Forge
signing hook to an approved managed service (the recommended path is Microsoft
Artifact Signing with GitHub OIDC) before creating a release tag.

Missing signing material, a signature/notarization failure, an unpacked or
installed-package smoke failure, an incomplete artifact set, or a moved tag
prevents publication. The Windows release gate installs the signed Squirrel
setup on a clean runner, exercises the installed executable through the same
packaged smoke, and uninstalls it before any artifact can reach publication.
The isolated product/download page and canonical GitHub Release lookup are
implemented. R2, custom protocol/site pairing, auto-update, tray/startup,
SQLite, RoleFit accounts, and synchronization remain deferred.

## Documentation checks

For docs and agent-guide work:

1. Verify every referenced local path exists or is explicitly described as a
   generated/private path.
2. Verify commands against the owning `package.json`.
3. Search for deleted modules, old repository-root assumptions, and obsolete
   runtime claims.
4. Keep product behavior in `PRODUCT.md`, visual behavior in `DESIGN.md`,
   implementation rules in the nearest `AGENTS.md`, and architecture in root
   docs.
5. Run `git diff --check` on the touched documentation paths.
