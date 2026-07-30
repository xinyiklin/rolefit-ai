#!/usr/bin/env python3
"""Derive the PDF-embeddable sfnt fonts from the committed woff2 webfonts.

The browser reads the woff2 files for CSS, but a woff2 byte stream is not a
valid PDF font program, so the client-side "Export PDF" path (pdf-lib +
@pdf-lib/fontkit, see src/typeset/pdf/emit.ts) embeds a decompressed sfnt
sibling per face:

  fonts/<Face>.woff2  ->  fonts/<Face>.ttf

The web assets keep their original outline flavour. PDF siblings are always
TrueType: pdf-lib otherwise labels a name-keyed OpenType/CFF program as a
CIDFontType2/FontFile2 resource, while correcting that declaration after the
fact creates a CID-keyed/font-program mismatch that newer PDF.js releases
render as missing or remapped glyphs. Converting the six Latin Modern faces
from cubic CFF outlines to quadratic glyf outlines preserves glyph order and
metrics while giving every viewer one unambiguous PDF font contract.

Ligatures: the woff2 sources are already filtered to the engine's five modeled
f-ligatures by scripts/generate_font_assets.py (strip_unmodeled_ligatures), so
every shaper — the browser, @pdf-lib/fontkit, and the engine's committed
metrics — shares one ligature contract. This script re-applies the same filter
as a consistency check: it must remove 0 ligatures, and fails loudly if the
woff2 ever regress to an unfiltered state instead of silently papering over it.

Reproducible toolchain (same pins as generate_font_assets.py):
  Python 3.9+
  fonttools[woff]==4.60.2
  brotli==1.2.0

Run (any working directory — paths are anchored to the repository):
  python3 scripts/generate_pdf_fonts.py
  python3 scripts/generate_pdf_fonts.py --check
"""

from __future__ import annotations

import argparse
import glob
from io import BytesIO
import os

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

from generate_font_assets import (
    strip_unmodeled_gsub_features,
    strip_unmodeled_kerning,
    strip_unmodeled_ligatures,
)

# Anchored to the package root like generate_font_assets.py, so the script works
# from any working directory.
FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")


def convert_cff_to_truetype(font: TTFont) -> None:
    if "CFF " not in font:
        return

    glyph_set = font.getGlyphSet()
    glyph_order = font.getGlyphOrder()
    units_per_em = font["head"].unitsPerEm
    glyphs = {}
    for glyph_name in glyph_order:
        pen = TTGlyphPen(None)
        quadratic_pen = Cu2QuPen(
            pen,
            max_err=units_per_em / 1000,
            reverse_direction=True,
        )
        glyph_set[glyph_name].draw(quadratic_pen)
        glyphs[glyph_name] = pen.glyph()

    glyf = newTable("glyf")
    glyf.glyphs = glyphs
    glyf.glyphOrder = glyph_order
    font["glyf"] = glyf
    font["loca"] = newTable("loca")

    maxp = newTable("maxp")
    maxp.tableVersion = 0x00010000
    maxp.numGlyphs = len(glyph_order)
    for field in (
        "maxPoints",
        "maxContours",
        "maxCompositePoints",
        "maxCompositeContours",
        "maxZones",
        "maxTwilightPoints",
        "maxStorage",
        "maxFunctionDefs",
        "maxInstructionDefs",
        "maxStackElements",
        "maxSizeOfInstructions",
        "maxComponentElements",
        "maxComponentDepth",
    ):
        setattr(maxp, field, 0)
    font["maxp"] = maxp
    del font["CFF "]
    font.sfntVersion = "\x00\x01\x00\x00"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify committed OTF/TTF siblings without replacing them",
    )
    args = parser.parse_args()

    woff2_files = sorted(glob.glob(os.path.join(FONTS_DIR, "*.woff2")))
    if not woff2_files:
        raise SystemExit(f"no woff2 fonts found in {FONTS_DIR}")
    problems = []
    total_bytes = 0
    for source in woff2_files:
        # recalcTimestamp=False keeps head.modified from the source so reruns
        # are byte-stable (matching the generate_font_assets.py convention).
        font = TTFont(source, recalcTimestamp=False)
        removed = (
            strip_unmodeled_ligatures(font)
            + strip_unmodeled_gsub_features(font)
            + strip_unmodeled_kerning(font)
        )
        if removed:
            problems.append(f"{source}: {removed} unmodeled shaping rules still present")
        was_cff = "CFF " in font
        convert_cff_to_truetype(font)
        base = os.path.splitext(os.path.basename(source))[0]
        destination = os.path.join(FONTS_DIR, f"{base}.ttf")
        legacy_destination = os.path.join(FONTS_DIR, f"{base}.otf") if was_cff else None
        font.flavor = None  # write a plain sfnt, not woff/woff2
        output = BytesIO()
        font.save(output, reorderTables=True)
        font.close()
        payload = output.getvalue()
        if args.check:
            matches_committed = False
            if os.path.exists(destination):
                with open(destination, "rb") as destination_file:
                    matches_committed = destination_file.read() == payload
            if not matches_committed:
                problems.append(f"{destination}: generated PDF font is stale")
            if legacy_destination and os.path.exists(legacy_destination):
                problems.append(f"{legacy_destination}: legacy CFF PDF font must be removed")
        else:
            with open(destination, "wb") as destination_file:
                destination_file.write(payload)
            if legacy_destination and os.path.exists(legacy_destination):
                os.remove(legacy_destination)
        size = len(payload)
        total_bytes += size
        print(f"{base}.ttf\t{size:>8} B")
    verb = "Verified" if args.check else "Generated"
    print(f"\n{verb} {len(woff2_files)} fonts, {total_bytes / 1024 / 1024:.2f} MB total")
    if problems:
        raise SystemExit(
            "PDF font verification failed. Regenerate the webfonts first when shaping "
            "rules changed, then regenerate the PDF siblings:\n  " + "\n  ".join(problems)
        )


if __name__ == "__main__":
    main()
