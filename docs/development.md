# RoleFit AI Repository Development And Verification

Run commands from the repository root. Use a named root command or an explicit
workspace; there is no generic root `dev`, `build`, or `preview` script.

## Requirements

- Node.js 22.18 minimum so the repository's direct `.ts` launchers run without
  an experimental flag; Node 24 matches CI/Docker and is the recommended
  runtime for Electron Forge packaging. The packaging wrapper accepts only the
  Node 22-24 range; Node 24 is the verified packaging runtime.
- npm with the root lockfile.
- Python 3 only for engine font-generation/check scripts.

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
```

Focused workspace commands:

```bash
npm run check --workspace packages/engine
npm run check --workspace packages/editor
npm run check --workspace apps/typeset
npm run check --workspace apps/role-fit-ai

npm run eval:resume-file --workspace packages/engine
npm run eval:pdf-font-parity --workspace packages/engine
npm run fonts:check --workspace packages/engine
npm run eval:editor --workspace packages/editor
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
| Engine layout / font / PDF | `eval:pdf-font-parity`, font check when relevant | engine check + both app builds + rendered output |
| Shared editor | editor typecheck, `eval:editor` | editor check + both app builds + browser QA when material |
| Typeset shell | Typeset build/check | browser/file/PDF QA proportional to change |
| RoleFit UI | RoleFit build and focused offline eval | RoleFit check; browser QA under its scoped policy |
| RoleFit public landing | landing build boundary + release-catalog probe | desktop/390px browser QA, current unavailable state, mocked complete release, and request inspection |
| RoleFit server / AI | server TypeScript gate and affected probe; explicit lifecycle test for listener changes | RoleFit check; route smoke where relevant |
| RoleFit provider manager | desktop emit + vault/file-renderer/IPC/CLI/settings/provider-registry/process probes | explicit companion GUI smoke, ordinary-browser regression, then root check/test for lockfile changes |
| RoleFit native package | staged-layout probe + matching-native packaged smoke | native make/signature checks, installed Squirrel smoke on Windows, and offline release-contract tests; signed publication only in protected CI |
| Documentation only | path/link/command validation, scoped diff check | no runtime build unless docs expose a discovered code mismatch |

Package changes are not complete after one consumer builds. Verify every host
whose public package contract changed.

## Ports

- Typeset: `5186`, strict; HMR socket `24686`.
- RoleFit AI standalone development: `5181`, loopback by default; reserved
  range `5181-5183`; `PORT` is the explicit standalone override.
- The companion defaults to `5181` and can save a validated integer local-site
  port from `1` through `65535` under Electron `userData`. `Apply & restart`
  checks loopback availability and relaunches through clean server shutdown;
  `ROLEFIT_DESKTOP_PORT` is a locked per-launch override.
- Port `5181` remains the browser-extension route-target contract. The
  extension does not follow a custom companion port, so custom ports support
  direct browser use only. Changing ports also changes the browser origin and
  creates separate origin-scoped `localStorage`; it does not migrate browser
  drafts/preferences. The active workspace and provider data remain in place;
  packaged runs keep them beneath operating-system `userData`.

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
  WOFF2/metrics outputs and the PDF-embeddable OTF/TTF siblings.
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
npm run test:desktop:windows-installer --workspace apps/role-fit-ai -- --installer=apps/role-fit-ai/.forge/release/RoleFit-Local-Companion-0.1.0-windows-x64.exe
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
