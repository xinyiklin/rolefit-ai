# Bundled document fonts

Typeset and RoleFit share 30 locally bundled families. The canonical ids, labels,
and menu order live in `../src/lib/fontFamilies.ts`; the original six and Latin
Modern default are retained. New fonts appear alphabetically after them:

Crimson Pro, DM Sans, Fira Sans, IBM Plex Sans, IBM Plex Serif, Inter, Lato,
Libre Baskerville, Libre Franklin, Lora, Merriweather, Merriweather Sans,
Montserrat, Noto Sans, Noto Serif, Nunito, Nunito Sans, Open Sans, PT Sans,
PT Serif, Raleway, Roboto, Rubik, and Work Sans.

Each family has regular, bold, italic, bold italic, display-bold, and small-caps
roles. The additions alias display-bold to bold. Small caps use the upstream
`smcp` substitutions when available, otherwise the existing scaled-capital
construction. Italic slopes follow the shipped font's `post` table. Variable
sources are instantiated at weights 400/700 and their upstream defaults for
other axes; only static files ship. New-family vertical metrics also enclose
the fixed supported Latin repertoire: upstream line boxes can exclude accented
capitals. This keeps header placement stable without clipping accents. Original
family metrics retain their existing values.

## Sources and licenses

The original pins remain in `../scripts/generate_font_assets.py`. The additions
and their SIL Open Font License texts are pinned together in
`../scripts/additional-fonts.json` at Google Fonts commit
[`67bc647ce1910e92f461bcc82aae30f21d21a9cc`](https://github.com/google/fonts/tree/67bc647ce1910e92f461bcc82aae30f21d21a9cc).
Every source is SHA-256 checked before use. Each family ships its copyright and
license text in this directory. Modified additional fonts use neutral internal
`Typeset Document <id>` names to respect upstream Reserved Font Names; the menu
labels identify their source designs.

The generator applies the same modeled ligatures, substitutions, kerning, and
caps construction to browser WOFF2 assets, PDF TrueType siblings, and committed
metrics. Apps mirror these assets through their existing predev/prebuild step.
New-family metrics also retain explicit kerning at ligature glyph boundaries,
including zero adjustments, instead of treating a ligature as its last letter.
Duplicate kerning lookup references are removed so default-script punctuation
cannot receive the same adjustment twice. The new families also compile the
five modeled ligatures into one longest-first lookup, matching engine ordering
when sequences overlap (for example, `fffi`).
Their ligature glyphs receive standard Unicode presentation-form mappings so
full PDF embedding includes glyph widths and a searchable ToUnicode layer.
They do not fetch fonts from a third-party service at runtime. The renderer loads
only families used by the layout (including inline overrides)
before document paint, and primes their browser baseline metrics after loading.
Menu previews also load regular faces when opened; unrelated bold/italic/caps
assets wait until that family is used. A collapsed caret also loads its chosen
next-typing family before measuring the caret; unloaded face measurements are
never cached. Failed loads surface in the editor, and obsolete completions
cannot replace a newer caret or document.

Font ids persist in document-wide style and inline overrides. Older app builds
reject files using a family they do not support; existing files keep their
fonts and defaults. File shapes and schema versions are unchanged.

## Reproduce and verify

From the repository root, using the pinned `.font-tools` environment:

```bash
.font-tools/bin/python packages/engine/scripts/generate_font_assets.py
.font-tools/bin/python packages/engine/scripts/generate_pdf_fonts.py
npm run fonts:check --workspace packages/engine
npm run check --workspace packages/engine
npm run check --workspace packages/editor
npm run check --workspace apps/typeset
npm run check --workspace apps/role-fit-ai
npm run test:editor:browser
```

On Windows use `.font-tools/Scripts/python.exe` for generation. The npm checks
resolve the platform interpreter themselves. Retain rendered browser and PDF
samples when changing fonts; builds and text extraction alone do not prove
visual fidelity.
