# RoleFit Distribution and Cloud Architecture Plan

Status: implementation phases D0-D4 complete locally; D5 deferred
Date: 2026-07-19
Scope owner: `apps/role-fit-ai/`

This plan authorizes the distribution portion of the provider-companion Phase
P5 without changing RoleFit's local-first product boundary. The cloud is a
release and download surface, not a RoleFit application backend.

RoleFit continues to run as:

- a normal browser application served from the selected loopback port
  (`http://localhost:5181` by default);
- a small Electron companion that owns provider setup and the loopback server;
- an ignored local workspace for resumes, jobs, tracker state, and artifacts;
- provider-owned CLI sessions or operating-system-encrypted API credentials.

There is no RoleFit account, hosted AI proxy, remote workspace, database,
credential service, synchronization service, or telemetry service in this
phase.

## Outcome

The supported distribution path is:

```text
source tag: rolefit-vX.Y.Z
             |
             v
GitHub Actions validation and native packaging
             |
             +-- signed and notarized macOS artifacts
             +-- signed Windows installer artifacts
             |
             v
GitHub Release (versioned installer source of truth)
             |
             +-- hosted RoleFit product/download page
             +-- optional R2 mirror in a later phase
```

Until project-owned signing identities are available, a second tag family,
`rolefit-preview-vX.Y.Z-beta.N`, may produce an explicitly unsigned GitHub
prerelease. It uses separate jobs and authorization, receives no signing
secrets, and never satisfies or weakens the stable `rolefit-v*` contract.

GitHub Pages is a static product/download surface built from an entry graph
separate from the Drafting Desk. It never connects directly to the companion,
receives local data, or becomes an alternate runtime for the loopback browser
app. It resolves only public release metadata and retains a safe Releases-page
fallback until a complete release exists. GitHub Releases is the initial binary origin
because it provides tag association, release notes, binary assets, and rollback
by retaining earlier versions.

Cloudflare R2 is an optional later mirror for stable branded download URLs or
higher-volume delivery. It must mirror checksummed release assets and must not
become an application API or a source of mutable, unversioned installers.

## Trust and data boundaries

| Boundary | Allowed | Forbidden |
| --- | --- | --- |
| GitHub Actions | source, lockfile, build output, signing material scoped to the job | resumes, job content, provider credentials, local workspace data |
| GitHub Releases | signed installers; explicitly labeled unsigned prerelease installers; archives, checksums, release notes | app data, API keys, CLI sessions, unsigned assets presented as stable or platform-trusted releases |
| GitHub Pages | static product explanation and canonical release links | Drafting Desk bundle, loopback calls/pairing, install detection, broad CORS, managed credentials, hosted AI execution |
| Packaged companion | encrypted provider vault, local server lifecycle, provider status | RoleFit account state, cloud sync, browser content over privileged IPC |
| Local server | local workspace and user-selected provider requests | public bind, cloud credential storage, release-management authority |

Release credentials are CI-only secrets. They never enter the application
bundle, renderer, loopback server, `.env`, repository, logs, or downloadable
checksums.

## Packaged runtime layout

Development currently runs TypeScript directly from the source workspace. A
packaged application cannot rely on a writable source tree or monorepo
symlinks, so distribution has an explicit split:

```text
read-only application resources
  dist/                         built browser application and fonts
  dist-electron/desktop/        Electron main, preload, and companion assets
  dist-electron/server/         bundled production-only server entry
  server/starter.resume         bundled empty-state starter document

writable operating-system userData
  provider-vault/providers.json safeStorage ciphertext plus configured ids
  desktop-settings/settings.json versioned non-secret local site port
  workspace/                    resume, job, tracker, and generated artifacts
```

The packaged server entry is a production bundle. It must not load Vite,
depend on Node's TypeScript stripping, import monorepo source through workspace
symlinks, or write beneath the application bundle. Development and standalone
commands retain their current source-based behavior.

Electron main resolves:

- development app root: the RoleFit source directory;
- packaged app root: `app.getAppPath()` (read-only resources);
- development server entry: `server.ts`;
- packaged server entry: the built production server bundle;
- development default workspace: `job-search-workspace/`;
- packaged default workspace: `app.getPath("userData")/workspace/`.

An absolute `ROLEFIT_WORKSPACE_DIR` remains an explicit test/development
override. A relative packaged override is not accepted because it could make
the location depend on launch working directory.

The existing server ownership, health fingerprint, provider-vault, private
parent/child credential snapshot, numeric-loopback bind, and exact IPC sender
contracts remain unchanged.

## Local site port and browser-origin boundary

The companion defaults to `5181` and lets the user save one integer port from
`1` through `65535`. `Apply & restart` checks numeric-loopback availability,
atomically saves the non-secret setting beneath Electron `userData`, and
relaunches through normal owned-server cleanup. `ROLEFIT_DESKTOP_PORT` is a
locked per-launch override and is never written to the settings document.

Changing the port changes the browser origin. Browser `localStorage` from the
old port is not migrated or merged with the new origin; personal workspace and
provider data remain under the same operating-system `userData` directory. The
current browser extension API target remains fixed at
`http://localhost:5181`, so a custom port is supported for direct browser use,
not extension import. Multi-port extension support requires a separate setting
and trust/validation decision.

## Artifact matrix

| Platform | Architecture | Public artifact | Purpose |
| --- | --- | --- | --- |
| macOS | arm64 | signed/notarized DMG and ZIP | Apple silicon install plus future update-feed compatibility |
| macOS | x64 | signed/notarized DMG and ZIP | Intel install plus future update-feed compatibility |
| Windows | x64 | signed Squirrel installer package | per-user install/uninstall and future update-feed compatibility |

Linux packaging is deferred until its credential-encryption UX, desktop CLI
PATH discovery, package format, and signing/repository expectations are tested
on a real target distribution. The source browser/server workflow remains
available to Linux developers.

Installer assets use deterministic names containing product version, platform,
and architecture. Every release also contains SHA-256 checksums generated from
the exact uploaded files. A release workflow must reject duplicate artifact
names rather than overwrite one architecture with another.

## Version and release contract

- `apps/role-fit-ai/package.json` is the RoleFit version source of truth.
- Release tags use `rolefit-vX.Y.Z` so they cannot collide with Typeset or
  workspace-wide tags.
- Unsigned preview tags use `rolefit-preview-vX.Y.Z-beta.N`. Their base version
  must exactly match the package version, `N` is a positive integer, and the
  GitHub Release must remain marked as a prerelease.
- The workflow fails before packaging unless the tag suffix exactly matches
  the package version.
- Repository rules must protect `refs/tags/rolefit-v*` so only authorized
  release maintainers can create them and no actor can update or delete an
  existing release tag.
- Prerelease status alone is not a reason to reuse a package version. Any
  behavior or compatibility change after a published preview or stable release
  requires a version bump.
- A tag is immutable. Corrections use a new patch version, never replacement
  binaries under an existing tag.
- GitHub Release assets are the canonical rollback set. Removing an older
  release requires an explicit security or legal reason.

## Signing and notarization

Stable public release jobs fail closed if platform signing material is
incomplete. Local `package`/`make` commands may create non-publicly-trusted
artifacts for verification (macOS receives only an ad-hoc local signature).
Those artifacts may enter only the dedicated unsigned-preview workflow, which
must identify them as unsigned in the tag, GitHub prerelease state, release
title and notes, landing status, and platform format labels.

macOS CI requires:

- a Developer ID Application certificate and password;
- an ephemeral keychain created for the job and deleted at job end;
- Apple notarization credentials scoped to the app/team;
- hardened runtime and notarization before artifact upload.

Windows CI requires a publicly trusted code-signing identity backed by a
hardware token, HSM, or managed signing service. The checked-in
`WINDOWS_CERTIFICATE_BASE64`/password path is a compatibility seam only for a
maintainer who already possesses a valid exportable PFX; it is not the default
procurement path for a new certificate. The first public Windows release must
not be tagged until either that exact prerequisite is satisfied or the Forge
signing hook is adapted to a reviewed managed signer. Microsoft Artifact
Signing with GitHub OIDC is the preferred managed path, but provisioning its
paid Azure account, identity validation, certificate profile, and federated
identity remains an explicit maintainer decision rather than a repository
default.

Secrets are validated by presence without printing values. Signing temporary
files are created only in runner temporary storage and are removed by an
always-running cleanup step.

## Release workflow

1. A maintainer updates the RoleFit package version and changelog/release notes.
2. The full RoleFit check and packaged-runtime smoke pass before tagging.
3. An authorized `rolefit-vX.Y.Z` tag triggers a least-privilege workflow.
4. A validation job checks the tag/version contract, lockfile install, app
   checks, packaging config, and artifact naming rules.
5. Native macOS and Windows jobs import signing material, build from `npm ci`,
   package, sign/notarize, and run packaged smoke checks. Windows additionally
   installs the signed Squirrel setup, runs the same smoke against the installed
   executable, and uninstalls it before upload.
6. Platform jobs upload workflow artifacts; they do not create releases.
7. One Linux release job downloads all artifacts, rejects missing/duplicate
   expected files, creates checksums, and creates the GitHub Release. It
   resolves the remote tag again before draft creation, after draft creation,
   and immediately before publication; any movement from the initially
   validated commit fails the release rather than publishing different code.
8. The release job receives `contents: write`; every earlier job receives only
   `contents: read`.

The unsigned-preview workflow mirrors the ancestry, native packaging, packaged
smoke, Windows installer lifecycle, artifact-set, checksum, tag-movement, and
atomic draft/publication gates. It deliberately omits signing environments,
Apple notarization, Authenticode verification, and every signing secret. It
instead verifies the macOS app's ad-hoc integrity signature and confirms the
Windows installer is not Authenticode-signed. Its only write-capable job uses
the `rolefit-preview-release` environment restricted to
`rolefit-preview-v*` tags.

No pull-request or unsigned-preview workflow receives release secrets. Forked or untrusted code
cannot trigger signing. Release creation is all-or-nothing: one failed platform
job prevents publication.

### Preview preflight and the 0.3.0 recovery lesson

The first 0.3.0 publication attempt required two follow-up pull requests before
the preview could be released. Both failures were useful fail-closed behavior,
but both should have been caught before a tag was created:

1. `rolefit-preview-v0.3.0-beta.8` built the native packages, then every
   packaged-app smoke failed because the health endpoint correctly returned
   `desktopCompatibilityVersion: 2` while
   `desktop/__tests__/packaged-smoke.test.mjs` still asserted the literal value
   `1`. The ordinary RoleFit check passed because it does not run the explicit
   Electron process or matching-native packaged smoke. PR #85 replaced the
   duplicated health versions with the built health-contract constants and
   aligned the renderer smoke with the five-section sidebar and current preload
   bridge.
2. `rolefit-preview-v0.3.0-beta.9` passed source validation and all three native
   platform jobs, but the atomic publisher refused to create a release because
   `docs/releases/0.3.0-beta.9.md` did not exist. PR #86 added the curated notes
   for beta.10, which then passed publication. Release notes are an exact
   tag-specific input, not optional prose that can be added after tagging.

Neither failed tag produced a GitHub Release or downloadable asset. Tags are
immutable, so recovery advanced the preview number instead of moving or
reusing beta.8 or beta.9.

Before creating any preview tag, the maintainer must:

1. Confirm the tag base version exactly matches
   `apps/role-fit-ai/package.json`.
2. Confirm the tagged commit is already on `origin/main`.
3. Create and review
   `apps/role-fit-ai/docs/releases/X.Y.Z-beta.N.md` for the exact intended tag.
4. Run `npm run check --workspace apps/role-fit-ai` and
   `npm run test:rolefit:desktop`; do not treat the first command as coverage
   for the explicit Electron smoke.
5. On a matching native host with Node 22-24, make the package and run
   `test:desktop:packaged` against that fresh output.
6. Run `npm run test:desktop:release --workspace apps/role-fit-ai`, review the
   final tag/notes/version tuple, and only then create the immutable tag.

The native jobs target GitHub environments named `rolefit-macos-signing` and
`rolefit-windows-signing`; the final write-capable job targets
`rolefit-release`. Maintainers must restrict all three to the `rolefit-v*` tag
policy before releasing; required reviewers are a separate optional rule when
an eligible non-initiating reviewer exists. macOS signing expects
`MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `MAC_CSC_IDENTITY`,
`APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Windows
signing currently expects the compatibility secrets
`WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`; do not create
placeholder values. A managed-signing migration must replace that contract and
its Forge integration together. Required secrets fail closed and temporary
certificate/key files are removed by always-running cleanup steps.

## Hosted surface

GitHub Pages builds only `landing/` into `dist-landing/`; it never uploads the
localhost app's `dist/` or adds an SPA fallback. The page presents RoleFit as a
companion-launched browser workbench and states that the installed companion is
required. It never tries to distinguish a closed companion from a missing one.

On load, the page reads the bounded public GitHub Releases list because this
monorepo may publish products other than RoleFit. It prefers the newest
complete non-draft, non-prerelease `rolefit-vX.Y.Z` entry. When none exists, it
may accept the newest complete `rolefit-preview-vX.Y.Z-beta.N` prerelease and
must disclose its unsigned status and expected platform warnings. Both channels
require a canonical release URL and the exact macOS arm64/x64 DMG + ZIP,
Windows x64 EXE, and checksum asset set. A 404-equivalent empty list, rate
limit, network failure, malformed tag, wrong origin, duplicate, unexpected, or
partial asset set leaves all three platform rows visible but links them to the
Releases page instead of constructing a broken asset URL.

## Failure, rollback, and recovery

- Build failure: no release is created; existing releases remain untouched.
- Signing/notarization failure: no unsigned fallback is uploaded publicly.
- Packaged smoke failure: no release is created even if installers were built.
- Bad release discovered after publication: mark it as affected, retain its
  checksums for auditability, publish a fixed patch version, and point download
  guidance to the patch.
- Companion startup failure: show a bounded local error; never fall back to a
  hosted provider service or move the workspace into the install directory.
- Port conflict: keep the existing compatible-server ownership rules; never
  terminate an unrelated process.

## Implementation phases

D0-D4 are implemented in the repository. Local verification can prove the
staged/package layout and native package available on the current host. The
unsigned preview channel proves native cross-platform execution without
claiming platform trust; stable signing/notarization remains blocked until the
tag-restricted environments and signing secrets are configured. D5 is
intentionally not started.

### D0 - Architecture extraction

1. Save this plan and link it from RoleFit engineering documentation.
2. Record the read-only bundle/writable user-data split.
3. Record version, artifact, signing, publication, and rollback contracts.

Acceptance: active documentation has one consistent local/cloud boundary and
the deferred capabilities are explicit.

### D1 - Packaged runtime

1. Add an official Electron Forge configuration and platform makers.
2. Build a production-only server bundle independent of the source workspace.
3. Route packaged workspace persistence to `userData/workspace`.
4. Include only required browser, companion, server, and starter assets.
5. Add packaged-path contract probes and a packaged application smoke.

Acceptance: an unpacked app starts its owned loopback server, serves the
browser UI, exposes no renderer Node globals, writes only under isolated
user-data, and exits without an orphan server.

### D2 - Local artifacts

1. Add root/workspace `package` and `make` commands with architecture input.
2. Produce native non-publicly-trusted artifacts for local inspection.
3. Normalize artifact names and generate checksums without publishing.
4. Ignore generated package/release directories.

Acceptance: clean local builds are repeatable and source, secrets, and personal
workspace data are absent from the package.

### D3 - Signed GitHub release

1. Add tag/version validation and a native platform matrix.
2. Add fail-closed signing/notarization seams and ephemeral secret handling.
3. Run checks and packaged smoke before upload.
4. Publish one release only after every expected artifact is present.

Acceptance: workflow syntax and scripts are locally testable; an actual public
release remains blocked until maintainers configure signing secrets and create
an authorized tag.

### D4 - Hosted download handoff

1. Build a separate static product/download entry, never a hosted Drafting Desk.
2. Show explicit macOS Apple silicon, macOS Intel, and Windows x64 choices.
3. Resolve direct links only from a complete canonical GitHub Release and keep
   the Releases-page fallback in every unavailable/error state.
4. Guard the output marker, entry manifest, and forbidden loopback/API strings.
5. Consider an R2 mirror only after a stable signed release and a measured need.

Acceptance: hosted copy does not imply cloud execution or native-install
detection; the full RoleFit renderer is absent from the Pages artifact; offline
parser probes and real-browser current/mocked-release states pass. A complete
signed release outranks every preview, and an accepted preview is labeled
unsigned in the active status and each format label.

### D5 - Deferred native handoff and updates

Custom `rolefit://` protocol registration, site-to-companion pairing,
auto-update, tray/menu-bar residency, startup-at-login, and production shell
PATH discovery require their own threat model and cross-platform acceptance
tests. Auto-update must not begin until the signed release channel is proven.

## Verification matrix

Run from the repository root:

```bash
npm run check --workspace apps/role-fit-ai
npm run build:rolefit:landing
npm run test:rolefit:desktop
npm run build:rolefit:desktop:package
npm run test:desktop:package-layout --workspace apps/role-fit-ai
npm run package:rolefit:desktop
npm run test:rolefit:desktop:packaged
npm run make:rolefit:desktop
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=arm64 --platform=darwin
npm run test:rolefit:release
git diff --check
```

Use Node 24 for Forge packaging and making. The wrapper accepts Node 22-24,
with Node 24 as the verified runtime, rejects cross-compilation, and supports
only native macOS arm64/x64 or Windows x64 targets. Pass an explicit native
target when needed, for example:

```bash
npm run make:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run test:rolefit:desktop:packaged -- --arch=arm64 --platform=darwin
```

On a native Windows x64 host, normalize the installer and exercise the installed
Squirrel lifecycle as well:

```bash
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=x64 --platform=win32 --checksums=false
npm run test:desktop:windows-installer --workspace apps/role-fit-ai -- --installer=apps/role-fit-ai/.forge/release/RoleFit-AI-0.3.0-windows-x64.exe
```

Generated staging, unpacked applications, maker output, normalized artifacts,
and CI downloads live under `apps/role-fit-ai/.forge/` and are ignored. The
collector writes deterministic names such as
`RoleFit-AI-0.3.0-macos-arm64.dmg` and a local
`SHA256SUMS.txt`; the publication job creates one checksum file over all five
release artifacts.

Inspect the packaged application to confirm it contains no `.env`, ignored
workspace, saved provider vault, source-map secrets, development server, or
unrelated monorepo app. Inspect its running process to confirm numeric-loopback
binding and clean owned-child shutdown.

## Explicitly out of scope

- SQLite or another database;
- RoleFit login, user accounts, teams, billing, or access control;
- cloud workspace or provider synchronization;
- hosted AI execution, API proxying, or hosted credential storage;
- telemetry, analytics ingestion, or crash-upload services;
- broad CORS, public local-service exposure, or hosted-page pairing;
- hosted download changes or an R2 mirror before the explicit D4 phase;
- custom protocol, site pairing, and automatic updates before the explicit D5
  phase and a signed release channel are proven;
- silent CLI installation, package-manager mutation, or provider login forms;
- packaging the full browser product inside an Electron `BrowserWindow`.

## Definition of done

RoleFit can be built into signed-distribution-ready native companion artifacts
without changing its browser-primary architecture or local data ownership. The
packaged companion starts the same trusted loopback server from read-only
resources, persists user data only beneath the operating-system user-data
directory, keeps provider credentials local, and can be published atomically
from an authorized version tag. Cloud infrastructure distributes code only; it
does not receive RoleFit content or become a second application backend.
