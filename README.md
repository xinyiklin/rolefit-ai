# Typeset Workspace

An npm-workspaces monorepo containing two resume products over one deterministic
document engine and one reusable editing surface.

```text
@typeset/engine -> @typeset/editor -> Typeset
                                  -> RoleFit AI
```

| Workspace | Responsibility |
| --- | --- |
| [`packages/engine`](packages/engine) | `@typeset/engine`: resume model, strict `.resume` codec, fonts, deterministic layout, DOM/print rendering, and PDF emission. |
| [`packages/editor`](packages/editor) | `@typeset/editor`: direct editing, history/style hooks, document toolbar/popovers, and shared editor styles. |
| [`apps/typeset`](apps/typeset) | **Typeset**: the standalone browser-only editor at [typeset.xinyiklin.com](https://typeset.xinyiklin.com). |
| [`apps/role-fit-ai`](apps/role-fit-ai) | **RoleFit AI**: the companion-launched, browser-primary local job-tailoring workbench with a loopback server, tracker, browser extension, and five-provider manager. |

The packages are private workspace source packages, not independently published
libraries. Apps compose them and own their own product identity, lifecycle, and
host-specific workflows; apps never import from each other.

## Start here

```bash
npm install
npm run dev:typeset  # http://localhost:5186
npm run dev:rolefit  # http://localhost:5181
npm run dev:rolefit:desktop  # supported local companion flow
npm run dev:rolefit:landing  # public product/download page
npm run check        # every workspace's type/build/eval gate
```

Requires Node 22.18 or newer (direct TypeScript execution is enabled by
default); Node 24 matches CI and the Typeset Docker build.

Focused commands:

```bash
npm run build:typeset
npm run build:rolefit
npm run build:rolefit:landing  # isolated public product/download bundle
npm run build:rolefit:desktop  # compile the companion
npm run test:rolefit:desktop   # explicit companion integration smoke
npm run make:rolefit:desktop   # native, non-publicly-trusted test artifacts (Node 24)
npm run test:rolefit:desktop:packaged
npm run check --workspace packages/engine
npm run check --workspace packages/editor
npm run check --workspace apps/typeset
npm run check --workspace apps/role-fit-ai
```

There is intentionally no ambiguous root `dev`, `build`, or `preview` script.
Use the named root command or an explicit workspace command.

## Documentation

- [Architecture and ownership](docs/architecture.md)
- [Development and verification](docs/development.md)
- [Git workflow](docs/git-workflow.md)
- [Typeset product docs](apps/typeset/README.md)
- [RoleFit AI product docs](apps/role-fit-ai/README.md)
- [Agent guidance](AGENTS.md)

## Deployment

- `.github/workflows/deploy-typeset.yml` verifies the engine, editor, and
  Typeset app, then builds `apps/typeset/Dockerfile` for the configured EC2
  host. The public Typeset runtime is static Nginx content.
- `.github/workflows/deploy-pages.yml` publishes the isolated RoleFit product
  and download page. It does not bundle the Drafting Desk or call localhost;
  the installed companion starts the full browser workspace on loopback.
- `.github/workflows/release-rolefit-desktop.yml` validates `rolefit-vX.Y.Z`
  tags and builds signed macOS arm64/x64 plus Windows x64 companion artifacts on
  matching native runners. GitHub Releases is the binary source of truth;
  signing environments fail closed, and no auto-update channel exists yet.

## License

[MIT](LICENSE) © 2026 Xinyi Lin
