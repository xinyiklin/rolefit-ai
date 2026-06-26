# jakeforge

A local-first **Jake's-style resume editor**. Edit a resume directly on the page
— the same single-column, ATS-friendly layout from
[Jake Gutierrez's LaTeX template](https://github.com/jakegut/resume) — and export
it as a clean browser PDF, a Tectonic-compiled LaTeX PDF, or `.tex` source.

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
  reload keeps your work. Nothing leaves your machine.

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

## Architecture

```
src/
  lib/            resume data model + parse/serialize/LaTeX-extract helpers
  hooks/          useResumeEditor · useDocStyle · useTemplates · useResumeExport
  components/     reusable Modal shell + ImportModal
  sections/
    editor/       the editable on-page resume (sections, entries, bullets, skills)
    Resume*.tsx   read-only document + off-screen print layer
  styles/         design tokens, resume document/editor CSS, app shell
public/
  favicon.svg     forge brand mark (anvil app-icon, also the sidebar lockup)
  fonts/          embedded LM Roman faces for PDF-faithful on-page rendering
  CNAME           GitHub Pages custom-domain config (jakeforge.xinyiklin.com)
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

Local-only and personal. The resume lives in `localStorage` and is sent solely to
the local LaTeX endpoints on your own machine for rendering. There is no account,
network upload, or third-party service.
