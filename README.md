# Typeset Workspace

One npm-workspaces monorepo, two apps over a shared deterministic resume
typesetting engine. The layering is `engine → editor → apps`.

| Workspace | What it is |
| --- | --- |
| [`packages/engine`](packages/engine) | `@typeset/engine` — deterministic layout (measure → linebreak → blocks → layout), the resume model, the strict `.resume` codec, DOM + PDF backends, bundled fonts and committed metrics. |
| [`packages/editor`](packages/editor) | `@typeset/editor` — the direct-edit contenteditable page, formatting toolbar and popovers, history/style hooks, styles. |
| [`apps/typeset`](apps/typeset) | **Typeset** — the standalone local-first resume editor, deployed at [typeset.xinyiklin.com](https://typeset.xinyiklin.com). |
| [`apps/role-fit-ai`](apps/role-fit-ai) | **RoleFit AI** — a local-first resume tailoring workbench: job intake, AI polish/review, application tracker, browser extension. Runs on your own machine. |

Each app has its own README, product docs, and deploy pipeline
(`deploy-typeset.yml` → EC2/nginx behind Caddy; `deploy-pages.yml` → a
static UI demo on GitHub Pages).

## Run

```bash
npm install          # one install for every workspace
npm run dev:typeset  # the editor on http://localhost:5186
npm run dev:rolefit  # the workbench on http://localhost:5181
npm run check        # every workspace's gate: builds, typechecks, evals
```

Requires Node ≥ 22.6 (the evals run TypeScript via
`--experimental-strip-types`); CI and Docker use Node 24.

## License

[MIT](LICENSE) © 2026 Xinyi Lin
