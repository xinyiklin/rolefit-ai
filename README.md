# Typeset

Typeset is a resume editor with the familiarity of a focused word processor,
hosted at [typeset.xinyiklin.com](https://typeset.xinyiklin.com). Edit the
rendered page directly, adjust typography and spacing, save an editable
`.resume` file, and export the finished document to a pixel-faithful PDF that the
app renders itself.

Typeset runs entirely in your browser. The structured resume model and browser
typesetting engine are the source of truth, and there is no application backend,
account, analytics service, or document conversion pipeline — the site serves
static assets, and your resume content never leaves your device.

## Features

- **Direct page editing** — select text and type on the rendered resume instead
  of filling out a separate form.
- **Familiar document toolbar** — New, Open, Save, Export PDF, undo, redo,
  selection formatting, a spell-check toggle, compact text/page panels, and
  zoom stay close at hand.
- **Structured editing** — add, remove, and reorder sections, entries, bullets,
  skill rows, summary paragraphs, and contact items without losing document
  structure.
- **Deterministic layout** — the editor, browser print layer, and dedicated PDF
  emitter share the same structured input, bundled fonts, committed metrics,
  page geometry, and pagination.
- **Print-aware typography** — choose Latin Modern, Source Serif 4, or Source
  Sans 3; open common sizes from the centered editable value, enter a custom
  6–48 pt value, or step it with adjacent 1 pt minus/plus controls.
- **Flexible page margins** — start from Narrow, Normal, or Wide, or enter
  independent top, right, bottom, and left margins from 0.25–1.5 inches.
- **Focused spacing controls** — choose a common or custom line height
  independently from Compact, Balanced, Spacious, and custom page-gap presets.
- **Portable source files** — `.resume` preserves editable content and every
  print-affecting style setting.
- **Real undo and redo** — text and structural edits share bounded history with
  typing coalescing and caret restoration.
- **Browser autosave** — status sits directly beside the filename, and the
  current document is restored from browser storage on the same browser and origin.
- **Private by design** — resume content stays in the browser and is never sent
  to an application service, even though the app is served from a hosted site.

## Files and PDF output

`.resume` is the only editable file format accepted by Typeset. It is a
versioned JSON document with:

- `format: "typeset-resume"`
- `schemaVersion: 1`
- structured resume content
- print-affecting typography, alignment, margin, and spacing settings

Disposable editor ids are regenerated when a file opens, and zoom and the
spell-check toggle are kept as local viewing preferences rather than written
into the document. Imports are validated field by field and limited to 2 MB. Other source-document formats are
not accepted. Version 1 is the first and only schema; pre-release prototype
formats are intentionally unsupported.

Use **Save** to download a reopenable `.resume` file. Use **Export PDF** to
download a finished `.pdf`: the owned typeset engine renders the pages and the app
serializes them to PDF entirely in your browser (embedded fonts, vector rules, and
clickable links), with no print dialog, document upload, or server-side conversion.
PDF is final output, not an editable source format.

Autosave is a recovery convenience, not a replacement for saving a `.resume`
file that can be backed up or moved to another device.

The filename field expands with its content. Leaving it blank resets it to
`Untitled resume` when editing finishes.

## Typography, spacing, and alignment

Selecting text enables the toolbar family, editable point-size, and paragraph
alignment controls. Clicking the size value opens common document sizes; the
field also accepts a custom value from 6–48 pt, while adjacent minus and plus
buttons step it by exactly 1 pt. Family and size apply only to that selection;
alignment applies to the selected field/paragraph. With only a caret, the
toolbar reports and changes the typing font, size, bold, italic, and underline
state at that location. Family, size, bold, italic, and underline changes on a
range restore its exact start and end after toolbar interaction. The browser
typesetter automatically detects email addresses and web links. Selected text
can also receive a custom destination from the Link control, where detected or
explicit links can be edited or persistently removed. The typesetter measures
mixed runs with committed metrics before it breaks lines, so the editable page,
browser print layer, and dedicated PDF output stay aligned. Typography stays in
the direct toolbar; selecting all text is the explicit way to restyle the entire
resume. Paragraph owns document-wide body, header, and heading alignment plus
independent persisted entry start and end indents. Styles owns heading case and
rule treatment plus per-role font, size, and emphasis for headings, entry
columns, skill labels, and contact text. Those field controls reflect manual
inline changes and can reapply or remove formatting across every matching
field. The dedicated Spacing menu keeps unitless line height separate from
physical point-based page gaps.

Saved page-spacing controls also use physical points. `em` is useful when a gap
should grow automatically with nearby text, but it makes a print-layout control
change meaning when the font size changes. A point value instead represents a
stable distance on the page. Application chrome still uses normal screen-oriented
CSS units; this rule applies to the resume's print geometry.

The toolbar offers left, center, right, and justified alignment for the selected
paragraph. The Paragraph menu's body, header, and section-heading alignment controls
remain document-wide defaults. A global option is active only while every field
in its scope resolves to that alignment; a local override clears the active
state, and choosing a global option clears conflicting local overrides. Entry
alignment uses the available column between the start and end indents.
Unformatted paired title/date and subtitle/location rows keep their left and
right anchors; a local alignment override intentionally moves that selected row
as a group within those indent boundaries.

## Run from source

Typeset is hosted at [typeset.xinyiklin.com](https://typeset.xinyiklin.com); no
install is needed to use it. To work on it locally:

Requirements:

- Node.js 24 recommended (matches CI and the Docker build); 22.6 is the hard
  floor, since the evals run TypeScript directly via
  `--experimental-strip-types`
- npm

```bash
npm install
npm run dev
```

Open [http://localhost:5186](http://localhost:5186). The port is fixed; if it is
already bound, use the running app instead of starting another instance.

Useful checks — all from the repository root:

```bash
npm run check        # every workspace's own gate (build + evals)
npm run build
npm run preview

# focused evals are app-scoped
npm run eval:resume-file     --workspace apps/typeset
npm run eval:editor          --workspace apps/typeset
npm run eval:pdf-font-parity --workspace apps/typeset
```

`npm run check` is the local and CI verification gate: it runs the TypeScript
production build and all three deterministic evals. The focused eval commands
are faster iteration targets for the `.resume` codec, direct-editing adapter,
and PDF-font shaping contract respectively. `npm run preview` serves the latest
production build on port 5186. There is no separate lint command.

## Architecture

This repository is an npm-workspaces monorepo. The root owns the lockfile,
shared tooling, and the deployment pipeline; `apps/typeset` is the editor and
the only app today. `packages/` is reserved for the shared typesetting engine
once it is extracted.

```text
package.json                       workspace root (workspaces, root scripts)
Dockerfile                         builds apps/typeset from the workspace root
apps/typeset/
  index.html                       Vite entry document
  vite.config.ts / tsconfig.json   app build + typecheck config
  PRODUCT.md / DESIGN.md           product and visual contracts
  src/
    main.tsx                       React entry point
    App.tsx                        file lifecycle, autosave, toolbar, workspace
    sampleResume.ts                starter document
    components/
      Modal.tsx                    dialog shell (focus trap, Escape, backdrop)
      Popover.tsx                  accessible anchored-popover primitive
      toolbar/                     editor toolbar, style popovers, zoom controls
    hooks/
      useResumeEditor.ts           structured reducer, history, edit actions
      useDocStyle.ts               persistence/state adapter for style + view prefs
    lib/
      resumeData.ts                canonical model, constructors, session ids
      documentStyle.ts             pure persisted style contract, defaults, bounds
      documentTypography.ts        shared deterministic document-size scale
      resumeFile.ts                strict `.resume` v1 codec and validation
      inlineMarksText.ts           inline-mark grammar + emphasis/font/size helpers
      styleFieldFormatting.ts      bulk/effective formatting across field roles
      links.ts                     safe link normalization and auto-detection
      pageMargins.ts               page-margin presets, bounds, normalization
      download.ts                  shared browser file-download side effect
    sections/
      ResumePrintLayer.tsx         off-screen browser-print document
      editor/                      direct input, caret mapping, commands, overlay
    typeset/
      schema.ts                    exact layout input + sole ResumeData adapter
      blocks.ts                    model to vertical line stream + page constants
      linebreak.ts                 deterministic paragraph breaking
      layout.ts                    page breaking and geometry
      fontRegistry.ts              bundled family and face registry
      measure.ts / metrics.gen.ts  committed measurements for all document fonts
      render/dom.tsx               selectable editor and print renderer
      pdf/emit.ts                  embedded-font PDF serializer
    styles/                        tokens, shell, toolbar, popovers, document, print
  public/
    fonts/                         bundled web/PDF fonts and their licenses
  scripts/
    generate_font_assets.py        pinned webfont and metric generator
    generate_pdf_fonts.py          derives PDF-embeddable OTF/TTF siblings
packages/                          shared packages (reserved; engine extraction)
```

`ResumeData` is the canonical in-memory model. The layout conversion carries
temporary provenance ids into the painted output so selections and structure
controls map back to the correct field. `apps/typeset/src/typeset/schema.ts` is
the sole adapter into that renderer-ready input. The `.resume` codec removes
session ids on save and creates fresh ones on open.

Vite is used for local development and static compilation only. All production
runtime behavior is browser-side.

### Font assets

`apps/typeset/scripts/generate_font_assets.py` builds the static WOFF2 files in
`apps/typeset/public/fonts/` and regenerates `src/typeset/metrics.gen.ts` from
pinned, checksum-verified sources. Its header records the reproducible Python
tooling; run it with `--check` to verify those committed outputs.
`generate_pdf_fonts.py` beside it derives the matching OTF/TTF files consumed by
the client-side PDF emitter. Both anchor their paths to the app root, so they
run from any working directory. After a font-pipeline change, regenerate both
formats and run the font-parity eval. Source Serif 4 and Source Sans 3
use the SIL Open Font License stored in `public/fonts/SourceSerif4-OFL.txt` and
`public/fonts/SourceSans3-OFL.txt`. Latin Modern's GUST Font License is stored in
`public/fonts/LatinModern-GUST-FONT-LICENSE.txt`.

## Privacy model

Resume content is stored only in browser `localStorage` and in files the user
explicitly opens or downloads. **Export PDF** lays out and serializes the
document in the page with the dedicated pdf-lib emitter; it does not invoke the
browser print dialog or send document content over the network. Manual browser
printing remains available through the separate off-screen print layer. Fonts
and application assets are bundled with the site.

The app makes no resume-data requests and includes no third-party analytics,
hosted AI, accounts, or remote persistence. A static host receives ordinary
asset requests; it does not receive the document being edited.

## Static hosting

Typeset is deployed at [typeset.xinyiklin.com](https://typeset.xinyiklin.com).
Because the build is a static site, any static host can serve the contents of
`dist/`:

```bash
npm ci
npm run build
```

For self-hosting with the checked-in Docker image:

```bash
docker build -t typeset .
docker run --rm -p 127.0.0.1:5186:8080 typeset
```

The multi-stage image builds with Node and serves only the compiled assets from
unprivileged Nginx. It has no runtime environment variables or application API.
Put the loopback-bound container behind an HTTPS reverse proxy when exposing it
publicly.

Example Caddy site:

```caddy
resume.example.com {
  reverse_proxy 127.0.0.1:5186
}
```

The GitHub workflow runs `npm run check` for pull requests. On configured pushes
to `main`, it rebuilds and restarts the same static Nginx container on the EC2
host that serves [typeset.xinyiklin.com](https://typeset.xinyiklin.com).

## Viewport support

Typeset targets modern desktop and tablet browsers. A focused small-screen
gate is preferable to degrading the document editor into a compromised phone UI.

## License

[MIT](LICENSE) © 2026 Xinyi Lin
