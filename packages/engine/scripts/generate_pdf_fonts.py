#!/usr/bin/env python3
"""Derive the PDF-embeddable sfnt fonts from the committed woff2 webfonts.

The browser reads the woff2 files for CSS, but a woff2 byte stream is not a
valid PDF font program, so the client-side "Export PDF" path (pdf-lib +
@pdf-lib/fontkit, see src/typeset/pdf/emit.ts) embeds a decompressed sfnt
sibling per face:

  fonts/<Face>.woff2  ->  fonts/<Face>.otf   (Latin Modern, CFF)
                          fonts/<Face>.ttf   (Source families, glyf)

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
"""

from __future__ import annotations

import glob
import os

from fontTools.ttLib import TTFont

from generate_font_assets import (
    strip_unmodeled_gsub_features,
    strip_unmodeled_kerning,
    strip_unmodeled_ligatures,
)

# Anchored to the package root like generate_font_assets.py, so the script works
# from any working directory.
FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts")


def main() -> None:
    woff2_files = sorted(glob.glob(os.path.join(FONTS_DIR, "*.woff2")))
    if not woff2_files:
        raise SystemExit(f"no woff2 fonts found in {FONTS_DIR}")
    stale = []
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
            stale.append(f"{source}: {removed} unmodeled shaping rules still present")
        extension = "otf" if font.sfntVersion == "OTTO" else "ttf"
        base = os.path.splitext(os.path.basename(source))[0]
        destination = os.path.join(FONTS_DIR, f"{base}.{extension}")
        font.flavor = None  # write a plain sfnt, not woff/woff2
        font.save(destination, reorderTables=True)
        size = os.path.getsize(destination)
        total_bytes += size
        print(f"{base}.{extension}\t{size:>8} B")
    print(f"\n{len(woff2_files)} fonts, {total_bytes / 1024 / 1024:.2f} MB total")
    if stale:
        raise SystemExit(
            "woff2 sources carry ligatures the engine does not model — regenerate them "
            "with scripts/generate_font_assets.py:\n  " + "\n  ".join(stale)
        )


if __name__ == "__main__":
    main()
