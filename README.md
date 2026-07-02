# jakeforge

A **Jake's-style resume editor**, live at
[jakeforge.xinyiklin.com](https://jakeforge.xinyiklin.com). Edit a resume
directly on the page — the same single-column, ATS-friendly layout from
[Jake Gutierrez's LaTeX template](https://github.com/jakegut/resume) — and export
it as a clean browser PDF, a Tectonic-compiled LaTeX PDF, or `.tex` source.

The app is deployed on EC2 behind Caddy (HTTPS), but stays private by design:
your resume lives in your browser's `localStorage` and is sent only to the
app's own LaTeX endpoints for rendering — never stored server-side.

It's a focused extraction of the resume editor from the `role-fit-ai` sibling
project: the structured editor, live document, and LaTeX pipeline, with the AI
tailoring, job tracker, and applications stripped out.

## Features

- **On-page editing** — name, contact chips, and Education / Experience /
  Projects / Skills / Summary sections. Add, remove, and drag-reorder sections,
  entries, and bullets inline (`@dnd-kit`, pointer + keyboard).
- **Faithful Jake's styling** — serif document, ruled section headings, bold
  titles with right-aligned dates, italic subtitles, automatic multi-page
  pagination that keeps headings with their first entry.
- **Layout & spacing controls** — page zoom (also ⌘/Ctrl +/- / 0),
  Compact/Normal/Relaxed presets, and fine sliders for line height and
  header/section/entry/list gaps tucked behind a "Fine-tune spacing" disclosure.
  Save the current spacing as a reusable **Custom** preset. Settings persist to
  `localStorage`.
- **Typography controls** — grouped by element (Headings / Entries / Skills /
  Contact): section-heading **case** (small caps / uppercase / normal) plus bold
  and underline; bold titles, italic subtitles; bold skill labels; and a
  configurable contact divider (quick-pick glyphs or custom 1-2 char input).
  One-click reset to Jake's defaults.
- **Exports** (each download opens a rename dialog pre-filled with a
  resume-derived file name)
  - **PDF - LaTeX** — the resume rendered through the Jake's template and compiled
    by [Tectonic](https://tectonic-typesetting.github.io/). Requires Tectonic.
  - **LaTeX source (`.tex`)** — download the rendered template source.
  - **Clean PDF** — press Cmd+P / Ctrl+P; the print CSS isolates the resume into
    a selectable, ATS-readable page (choose Save as PDF). No dependencies.
- **Import** — drag-and-drop or browse for a file (`.txt`, `.md`, `.tex`,
  `.docx`) directly from the sidebar. LaTeX is auto-detected. PDF import is
  intentionally unsupported — it extracts too poorly to be useful.
- **In-app PDF preview** — compile and view the LaTeX PDF without downloading.
- **Autosave** — the structured resume is persisted to `localStorage`, so a
  reload keeps your work. Rendering only calls the app's own LaTeX endpoints.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5186
```

`npm run dev` runs `server.mjs`, which serves the Vite app and the LaTeX API from
one process.

### Optional: LaTeX PDF output

Clean PDF via Cmd+P / Ctrl+P works out of the box. For the high-fidelity
**PDF - LaTeX** export and the in-app preview, install Tectonic:

```bash
brew install tectonic
```

Then restart the dev server. Without it, those buttons are disabled and the
sidebar shows the clean-print hint.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server (frontend + LaTeX API) on port 5186 |
| `npm run build` | Typecheck (`tsc`) + production build to `dist/` |
| `npm run preview` | Serve the production build (`NODE_ENV=production`) |

## Deploying (Docker)

The `Dockerfile` builds a self-contained image: the production bundle,
`server.mjs`, Tectonic (arch-matched, so LaTeX PDF works in the container), and
`unzip` for DOCX import.

```bash
docker build -t jakeforge .
docker run -p 5186:5186 -e ALLOWED_HOSTS=resume.example.com,203.0.113.7 jakeforge
```

`ALLOWED_HOSTS` is required: a comma-separated list of every hostname or IP the
app is reached by. It backs the same-origin/Host guard on the API, and the
server refuses to start without it when bound beyond loopback. Loopback names
(`localhost`, `127.0.0.1`) are always allowed, so on-box smoke tests and
container health checks work regardless.

A single small instance (e.g. an EC2 `t3.micro`) is plenty — the server is one
Node process with no database.

For a small EC2 deployment, bind the container to loopback and put an HTTPS
reverse proxy (e.g. [Caddy](https://caddyserver.com/)) in front:

```bash
docker run -d \
  --name jakeforge \
  --restart unless-stopped \
  -p 127.0.0.1:5186:5186 \
  -e ALLOWED_HOSTS=jakeforge.example.com,203.0.113.7,localhost,127.0.0.1 \
  jakeforge
```

Caddy handles HTTPS, automatic Let's Encrypt certificates, and HTTP→HTTPS
redirects. A minimal Caddyfile:

```
jakeforge.example.com {
    reverse_proxy 127.0.0.1:5186
}
```

Run Caddy as a Docker container on the same host:

```bash
docker run -d \
  --name caddy \
  --restart unless-stopped \
  --network host \
  -v caddy_data:/data \
  -v /path/to/Caddyfile:/etc/caddy/Caddyfile \
  caddy:2
```

To smoke-test on the host, hit the loopback binding directly
(`curl -I http://127.0.0.1:5186`). Publishing the container on port 80
(`-p 80:5186`) only works before Caddy is installed — once Caddy owns 80/443,
that mapping fails with "address already in use".

### GitHub Actions deploy to EC2

The workflow in `.github/workflows/deploy.yml` keeps pull requests as CI-only
builds. Pushes to `main` SSH into the EC2 host, copy the source archive, build
the Docker image on the instance, and restart the `jakeforge` container bound to
`127.0.0.1:5186`. A separately managed Caddy container owns ports 80/443 and
reverse-proxies to the app.

Configure these repository secrets before enabling the deploy job:

| Secret | Value |
| --- | --- |
| `EC2_HOST` | Public IPv4 address or DNS name of the EC2 instance |
| `EC2_USER` | SSH user, typically `ec2-user` on Amazon Linux |
| `EC2_SSH_KEY` | Private key contents for the EC2 key pair |
| `ALLOWED_HOSTS` | Comma-separated public hostnames/IPs, e.g. `jakeforge.xinyiklin.com,100.60.78.4,ec2-100-60-78-4.compute-1.amazonaws.com` |

The EC2 instance must already have Docker and Caddy running (see the Caddy
setup above). The workflow uses plain `docker` when available, or passwordless
`sudo docker` on default Amazon Linux setups.

## Architecture

```
src/
  lib/            resume data model + parse/serialize/LaTeX-extract helpers
  hooks/          useResumeEditor · useDocStyle · useTemplates · useResumeExport
  components/     reusable Modal shell, ImportModal, and SectionNav
  sections/
    editor/       the editable on-page resume (sections, entries, bullets, skills)
    Resume*.tsx   read-only document + off-screen print layer
  styles/         design tokens, resume document/editor CSS, app shell
public/
  favicon.svg     forge brand mark (anvil app-icon, also the sidebar lockup)
  fonts/          embedded LM Roman faces for PDF-faithful on-page rendering
server/
  latex/          Jake's template renderer, resume parser, Tectonic wrapper
  docx.mjs        DOCX text extractor (zero-dep; shells to unzip)
server.mjs        serves the app + /api/{templates,render-resume-latex,import-resume-tex,import-resume-docx}
```

The editor holds a **structured resume model** (`ResumeData`). LaTeX exports
render straight from that model through the template — the same path the preview
uses — so downloads match what you see. Plain-text serialization backs the
clean-print mirror.

## Privacy

Local-first and personal. The resume lives in `localStorage` and is sent solely
to the app's own LaTeX endpoints for rendering — on your machine when running
locally, or on your own server when self-hosting the Docker image. There is no
account, no database, and no third-party service.
