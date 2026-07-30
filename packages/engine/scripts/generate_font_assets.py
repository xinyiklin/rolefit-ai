#!/usr/bin/env python3
"""Generate deterministic static webfonts and browser-typesetter metrics.

The source URLs and SHA-256 digests below are the source-of-truth pins. Google
Fonts URLs use immutable repository commits. Latin Modern uses a named CTAN
mirror instead of the proximity redirector, whose selected mirror can vary
between otherwise identical CI jobs; CTAN bytes remain content-pinned because
the archive does not expose immutable file URLs.

Reproducible toolchain:
  Python 3.9+
  fonttools[woff]==4.60.2
  brotli==1.2.0

Run from anywhere:
  python3 scripts/generate_font_assets.py
  python3 scripts/generate_font_assets.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional, Sequence

import brotli
import fontTools
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


REQUIRED_FONTTOOLS_VERSION = "4.60.2"
REQUIRED_BROTLI_VERSION = "1.2.0"

FAMILY_ORDER = (
    "latin-modern",
    "source-serif",
    "source-sans",
    "tinos",
    "arimo",
    "carlito",
)
FACE_ORDER = ("regular", "bold", "italic", "boldItalic", "boldDisplay", "caps")
LIGATURES = ("ffi", "ffl", "ff", "fi", "fl")

# Keep this repertoire aligned with the editor's portable text metrics. Unknown
# characters still use the engine's explicit average-width fallback.
METRIC_CHARACTERS = (
    "0123456789"
    " !\"#$%&'()*+,-./:;<=>?@"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`"
    "abcdefghijklmnopqrstuvwxyz{|}~"
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß"
    "àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
    "–—‘’“”•·…"
)


@dataclass(frozen=True)
class SourceSpec:
    filename: str
    url: str
    sha256: str


GOOGLE_SERIF_COMMIT = "7b203a635ebe80801c80f29633d4fc467cd1214e"
GOOGLE_SANS_COMMIT = "4591e3457ab8be6d70167aa6818922b91e78ab2d"
# ofl/sourceserif4/OFL.txt does not exist at GOOGLE_SERIF_COMMIT (the licenses
# were added to that directory later, 2024-12-17), so the license pins its own
# immutable commit — the newest revision of the file, whose bytes match the
# digest below.
GOOGLE_SERIF_LICENSE_COMMIT = "01aa15d05749e35be9167f3f44e6a243f00cd2fc"
GOOGLE_TINOS_COMMIT = "90d7886db9000c893b9559828bf028aaed5f9c10"
GOOGLE_ARIMO_COMMIT = "903d46673260c1f4c7f7ef67f5190fb03eab5042"
GOOGLE_CARLITO_COMMIT = "3dd78844021e948ceb633d1dcee3f7885561b5d9"
CTAN_MIRROR = "https://ctan.math.illinois.edu"

SOURCES: Mapping[str, SourceSpec] = {
    "source-serif-roman": SourceSpec(
        "SourceSerif4.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SERIF_COMMIT}/"
        "ofl/sourceserif4/SourceSerif4%5Bopsz%2Cwght%5D.ttf",
        "97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b",
    ),
    "source-serif-italic": SourceSpec(
        "SourceSerif4-Italic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SERIF_COMMIT}/"
        "ofl/sourceserif4/SourceSerif4-Italic%5Bopsz%2Cwght%5D.ttf",
        "15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42",
    ),
    "source-serif-license": SourceSpec(
        "SourceSerif4-OFL.txt",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SERIF_LICENSE_COMMIT}/ofl/sourceserif4/OFL.txt",
        "5f94c3fd3a23131a417ab5a0c8452de57e70c3cfb9f604d88241f7065ebf9fd9",
    ),
    "source-sans-roman": SourceSpec(
        "SourceSans3.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SANS_COMMIT}/"
        "ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf",
        "042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9",
    ),
    "source-sans-italic": SourceSpec(
        "SourceSans3-Italic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SANS_COMMIT}/"
        "ofl/sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf",
        "39e3ab05ccd7cb94907c31005bb5bec1d5432f0b096a2b782976e217a540eb6c",
    ),
    "source-sans-license": SourceSpec(
        "SourceSans3-OFL.txt",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_SANS_COMMIT}/ofl/sourcesans3/OFL.txt",
        "09746787287a289323b0ec3cff4d1a4a801331b82b7207c1e186f5d26619a392",
    ),
    "lm-regular": SourceSpec(
        "lmroman10-regular.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmroman10-regular.otf",
        "1aa18cfefa58132c52ce5de70db1fd1154201c19cd2b2cdaffba4906a33e6852",
    ),
    "lm-bold": SourceSpec(
        "lmroman10-bold.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmroman10-bold.otf",
        "102fe06c430a8b681b2bf6876b7cd967ae4d47b4b6b41d915eb7913b726d9fb1",
    ),
    "lm-italic": SourceSpec(
        "lmroman10-italic.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmroman10-italic.otf",
        "c1fce25075567bb8dbf2151658c3b442690041db17a2d49fc9e55905ea5b7169",
    ),
    "lm-bold-italic": SourceSpec(
        "lmroman10-bolditalic.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmroman10-bolditalic.otf",
        "c37a28eed7a6e03f792b98b5e5f637b2fcda378bb4855f99284f1a88fe35f124",
    ),
    "lm-bold-display": SourceSpec(
        "lmroman12-bold.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmroman12-bold.otf",
        "28c8782ac2b6486958b5dc7610ada7800c53546ff7f36bc65909a876e1cd338e",
    ),
    "lm-caps": SourceSpec(
        "lmromancaps10-regular.otf",
        f"{CTAN_MIRROR}/fonts/lm/fonts/opentype/public/lm/lmromancaps10-regular.otf",
        "1ab40332a969892c7ed6cb010193b5276ccef1da6798bcbd1a465fee23d29334",
    ),
    "lm-license": SourceSpec(
        "LatinModern-GUST-FONT-LICENSE.txt",
        f"{CTAN_MIRROR}/fonts/lm/doc/fonts/lm/GUST-FONT-LICENSE.TXT",
        "49ea6cb9257bbee0a3979c48a774cd221550ac1c20c95549efe45fc99cc18050",
    ),
    # Metric-compatible substitutes for the three families resumes are most often
    # asked for. Each keeps the per-character advance widths of the proprietary
    # original, so a document holds its line and page count when it is opened in
    # a word processor that only has the original. The originals themselves are
    # not redistributable; these are.
    #
    # Tinos is pinned at its Apache release rather than the newer OFL one
    # (google/fonts ba95515, 2026-04-27) because that revision ships no license
    # file in the font's directory. Font bytes and license text must be pinned
    # together, so this pin is the last commit where they coexist.
    "tinos-regular": SourceSpec(
        "Tinos-Regular.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_TINOS_COMMIT}/apache/tinos/Tinos-Regular.ttf",
        "1061395ac6775f3cea27dc9ef3d7a3b9cc34c2b4a2d97aa649411294d5165990",
    ),
    "tinos-bold": SourceSpec(
        "Tinos-Bold.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_TINOS_COMMIT}/apache/tinos/Tinos-Bold.ttf",
        "6a0afe87068ba5ddeb6a9bb7b9d0dc41666966c044767df69de3efb7e33f5af8",
    ),
    "tinos-italic": SourceSpec(
        "Tinos-Italic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_TINOS_COMMIT}/apache/tinos/Tinos-Italic.ttf",
        "751c979043c9641dad389ab9c680c2c9ffb0a0c7352153f48b9ebd958e8963d8",
    ),
    "tinos-bold-italic": SourceSpec(
        "Tinos-BoldItalic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_TINOS_COMMIT}/apache/tinos/Tinos-BoldItalic.ttf",
        "52c4d87a988eb1f1c25e1fcb97970d456a2fb252e0fa2116e2b4bb33e7824bda",
    ),
    "tinos-license": SourceSpec(
        "Tinos-LICENSE.txt",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_TINOS_COMMIT}/apache/tinos/LICENSE.txt",
        "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    ),
    "arimo-roman": SourceSpec(
        "Arimo.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_ARIMO_COMMIT}/"
        "ofl/arimo/Arimo%5Bwght%5D.ttf",
        "e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca",
    ),
    "arimo-italic": SourceSpec(
        "Arimo-Italic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_ARIMO_COMMIT}/"
        "ofl/arimo/Arimo-Italic%5Bwght%5D.ttf",
        "a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed",
    ),
    "arimo-license": SourceSpec(
        "Arimo-OFL.txt",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_ARIMO_COMMIT}/ofl/arimo/OFL.txt",
        "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992",
    ),
    "carlito-regular": SourceSpec(
        "Carlito-Regular.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_CARLITO_COMMIT}/ofl/carlito/Carlito-Regular.ttf",
        "f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595",
    ),
    "carlito-bold": SourceSpec(
        "Carlito-Bold.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_CARLITO_COMMIT}/ofl/carlito/Carlito-Bold.ttf",
        "bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db",
    ),
    "carlito-italic": SourceSpec(
        "Carlito-Italic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_CARLITO_COMMIT}/ofl/carlito/Carlito-Italic.ttf",
        "0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c",
    ),
    "carlito-bold-italic": SourceSpec(
        "Carlito-BoldItalic.ttf",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_CARLITO_COMMIT}/ofl/carlito/Carlito-BoldItalic.ttf",
        "b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517",
    ),
    "carlito-license": SourceSpec(
        "Carlito-OFL.txt",
        f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_CARLITO_COMMIT}/ofl/carlito/OFL.txt",
        "58402f82a7c332a700294988fe7554fbb0a63a8d27ccc1ee3bbc640311990a00",
    ),
}


@dataclass(frozen=True)
class FontJob:
    family: str
    face: str
    source: str
    output: str
    internal_family: Optional[str] = None
    subfamily: str = "Regular"
    weight: int = 400
    italic: bool = False
    axes: Optional[Mapping[str, float]] = None
    caps: bool = False


FONT_JOBS: Sequence[FontJob] = (
    FontJob("latin-modern", "regular", "lm-regular", "LMRoman10-Regular.woff2"),
    FontJob("latin-modern", "bold", "lm-bold", "LMRoman10-Bold.woff2", weight=700, subfamily="Bold"),
    FontJob("latin-modern", "italic", "lm-italic", "LMRoman10-Italic.woff2", italic=True, subfamily="Italic"),
    FontJob(
        "latin-modern",
        "boldItalic",
        "lm-bold-italic",
        "LMRoman10-BoldItalic.woff2",
        weight=700,
        italic=True,
        subfamily="Bold Italic",
    ),
    FontJob(
        "latin-modern",
        "boldDisplay",
        "lm-bold-display",
        "LMRoman12-Bold.woff2",
        weight=700,
        subfamily="Bold",
    ),
    FontJob("latin-modern", "caps", "lm-caps", "LMRomanCaps10-Regular.woff2"),
    FontJob(
        "source-serif",
        "regular",
        "source-serif-roman",
        "SourceSerif4-Regular.woff2",
        internal_family="Typeset Serif 4 Regular",
        axes={"wght": 400, "opsz": 10},
    ),
    FontJob(
        "source-serif",
        "bold",
        "source-serif-roman",
        "SourceSerif4-Bold.woff2",
        internal_family="Typeset Serif 4 Bold",
        subfamily="Bold",
        weight=700,
        axes={"wght": 700, "opsz": 10},
    ),
    FontJob(
        "source-serif",
        "italic",
        "source-serif-italic",
        "SourceSerif4-Italic.woff2",
        internal_family="Typeset Serif 4 Italic",
        subfamily="Italic",
        italic=True,
        axes={"wght": 400, "opsz": 10},
    ),
    FontJob(
        "source-serif",
        "boldItalic",
        "source-serif-italic",
        "SourceSerif4-BoldItalic.woff2",
        internal_family="Typeset Serif 4 Bold Italic",
        subfamily="Bold Italic",
        weight=700,
        italic=True,
        axes={"wght": 700, "opsz": 10},
    ),
    FontJob(
        "source-serif",
        "boldDisplay",
        "source-serif-roman",
        "SourceSerif4-BoldDisplay.woff2",
        internal_family="Typeset Serif 4 Bold Display",
        subfamily="Bold",
        weight=700,
        axes={"wght": 700, "opsz": 24},
    ),
    FontJob(
        "source-serif",
        "caps",
        "source-serif-roman",
        "SourceSerif4-Caps.woff2",
        internal_family="Typeset Serif 4 Caps",
        axes={"wght": 400, "opsz": 10},
        caps=True,
    ),
    FontJob(
        "source-sans",
        "regular",
        "source-sans-roman",
        "SourceSans3-Regular.woff2",
        internal_family="Typeset Sans 3 Regular",
        axes={"wght": 400},
    ),
    FontJob(
        "source-sans",
        "bold",
        "source-sans-roman",
        "SourceSans3-Bold.woff2",
        internal_family="Typeset Sans 3 Bold",
        subfamily="Bold",
        weight=700,
        axes={"wght": 700},
    ),
    FontJob(
        "source-sans",
        "italic",
        "source-sans-italic",
        "SourceSans3-Italic.woff2",
        internal_family="Typeset Sans 3 Italic",
        subfamily="Italic",
        italic=True,
        axes={"wght": 400},
    ),
    FontJob(
        "source-sans",
        "boldItalic",
        "source-sans-italic",
        "SourceSans3-BoldItalic.woff2",
        internal_family="Typeset Sans 3 Bold Italic",
        subfamily="Bold Italic",
        weight=700,
        italic=True,
        axes={"wght": 700},
    ),
    FontJob(
        "source-sans",
        "boldDisplay",
        "source-sans-roman",
        "SourceSans3-BoldDisplay.woff2",
        internal_family="Typeset Sans 3 Bold Display",
        subfamily="Bold",
        weight=700,
        axes={"wght": 700},
    ),
    FontJob(
        "source-sans",
        "caps",
        "source-sans-roman",
        "SourceSans3-Caps.woff2",
        internal_family="Typeset Sans 3 Caps",
        axes={"wght": 400},
        caps=True,
    ),
    # The metric-compatible families. Every face is renamed: each one is either
    # instanced from a variable source or has a rewritten cmap, so none of them
    # is the upstream font any more and a PDF should not claim otherwise.
    FontJob(
        "tinos", "regular", "tinos-regular", "Tinos-Regular.woff2",
        internal_family="Typeset Tinos Regular",
    ),
    FontJob(
        "tinos", "bold", "tinos-bold", "Tinos-Bold.woff2",
        internal_family="Typeset Tinos Bold", subfamily="Bold", weight=700,
    ),
    FontJob(
        "tinos", "italic", "tinos-italic", "Tinos-Italic.woff2",
        internal_family="Typeset Tinos Italic", subfamily="Italic", italic=True,
    ),
    FontJob(
        "tinos", "boldItalic", "tinos-bold-italic", "Tinos-BoldItalic.woff2",
        internal_family="Typeset Tinos Bold Italic", subfamily="Bold Italic",
        weight=700, italic=True,
    ),
    FontJob(
        "tinos", "caps", "tinos-regular", "Tinos-Caps.woff2",
        internal_family="Typeset Tinos Caps", caps=True,
    ),
    FontJob(
        "arimo", "regular", "arimo-roman", "Arimo-Regular.woff2",
        internal_family="Typeset Arimo Regular", axes={"wght": 400},
    ),
    FontJob(
        "arimo", "bold", "arimo-roman", "Arimo-Bold.woff2",
        internal_family="Typeset Arimo Bold", subfamily="Bold", weight=700,
        axes={"wght": 700},
    ),
    FontJob(
        "arimo", "italic", "arimo-italic", "Arimo-Italic.woff2",
        internal_family="Typeset Arimo Italic", subfamily="Italic", italic=True,
        axes={"wght": 400},
    ),
    FontJob(
        "arimo", "boldItalic", "arimo-italic", "Arimo-BoldItalic.woff2",
        internal_family="Typeset Arimo Bold Italic", subfamily="Bold Italic",
        weight=700, italic=True, axes={"wght": 700},
    ),
    FontJob(
        "arimo", "caps", "arimo-roman", "Arimo-Caps.woff2",
        internal_family="Typeset Arimo Caps", axes={"wght": 400}, caps=True,
    ),
    FontJob(
        "carlito", "regular", "carlito-regular", "Carlito-Regular.woff2",
        internal_family="Typeset Carlito Regular",
    ),
    FontJob(
        "carlito", "bold", "carlito-bold", "Carlito-Bold.woff2",
        internal_family="Typeset Carlito Bold", subfamily="Bold", weight=700,
    ),
    FontJob(
        "carlito", "italic", "carlito-italic", "Carlito-Italic.woff2",
        internal_family="Typeset Carlito Italic", subfamily="Italic", italic=True,
    ),
    FontJob(
        "carlito", "boldItalic", "carlito-bold-italic", "Carlito-BoldItalic.woff2",
        internal_family="Typeset Carlito Bold Italic", subfamily="Bold Italic",
        weight=700, italic=True,
    ),
    FontJob(
        "carlito", "caps", "carlito-regular", "Carlito-Caps.woff2",
        internal_family="Typeset Carlito Caps", caps=True,
    ),
)

# Faces that are the SAME shipped file as another face of their family.
#
# `boldDisplay` exists because Source ships an optical-size axis: the resume name
# is set from an `opsz: 24` instance so it is not a scaled-up text weight. The
# metric-compatible families are single-design statics with no optical axis, so
# their display bold IS their text bold. Aliasing points both faces at one asset
# and one metrics record instead of shipping identical bytes twice under two
# names, which would also let the two copies drift apart.
FACE_ALIASES: Mapping[str, Mapping[str, str]] = {
    "tinos": {"boldDisplay": "bold"},
    "arimo": {"boldDisplay": "bold"},
    "carlito": {"boldDisplay": "bold"},
}

LICENSE_OUTPUTS = {
    "source-serif-license": "SourceSerif4-OFL.txt",
    "source-sans-license": "SourceSans3-OFL.txt",
    "lm-license": "LatinModern-GUST-FONT-LICENSE.txt",
    "tinos-license": "Tinos-LICENSE.txt",
    "arimo-license": "Arimo-OFL.txt",
    "carlito-license": "Carlito-OFL.txt",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_toolchain() -> None:
    if fontTools.__version__ != REQUIRED_FONTTOOLS_VERSION:
        raise SystemExit(
            f"fontTools {REQUIRED_FONTTOOLS_VERSION} is required; found {fontTools.__version__}. "
            f"Install fonttools[woff]=={REQUIRED_FONTTOOLS_VERSION}."
        )
    if getattr(brotli, "__version__", "") != REQUIRED_BROTLI_VERSION:
        raise SystemExit(
            f"brotli {REQUIRED_BROTLI_VERSION} is required; found {getattr(brotli, '__version__', 'unknown')}."
        )


def ensure_source(spec: SourceSpec, source_dir: Path, offline: bool) -> Path:
    path = source_dir / spec.filename
    if path.exists() and sha256(path) == spec.sha256:
        return path
    if path.exists():
        raise SystemExit(f"Source checksum mismatch: {path}")
    if offline:
        raise SystemExit(f"Missing pinned source in offline mode: {path}")

    source_dir.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(spec.url, headers={"User-Agent": "typeset-font-generator/1"})
    temporary = path.with_suffix(path.suffix + ".download")
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    if sha256(temporary) != spec.sha256:
        temporary.unlink(missing_ok=True)
        raise SystemExit(f"Downloaded source checksum mismatch: {spec.url}")
    temporary.replace(path)
    return path


def feature_lookup_indices(font: TTFont, table_tag: str, feature_tag: str) -> Sequence[int]:
    if table_tag not in font:
        return ()
    feature_list = font[table_tag].table.FeatureList
    if feature_list is None:
        return ()
    indices = {
        index
        for record in feature_list.FeatureRecord
        if record.FeatureTag == feature_tag
        for index in record.Feature.LookupListIndex
    }
    return tuple(sorted(indices))


def lookup_subtables(font: TTFont, table_tag: str, feature_tag: str) -> Iterable[tuple[int, object]]:
    lookup_list = font[table_tag].table.LookupList.Lookup if table_tag in font else ()
    extension_type = 7 if table_tag == "GSUB" else 9
    for index in feature_lookup_indices(font, table_tag, feature_tag):
        lookup = lookup_list[index]
        for subtable in lookup.SubTable:
            if lookup.LookupType == extension_type:
                yield subtable.ExtensionLookupType, subtable.ExtSubTable
            else:
                yield lookup.LookupType, subtable


def remap_small_caps(font: TTFont) -> None:
    """Point lowercase codepoints at the font's own small-cap glyphs.

    A caps face is built by rewriting the cmap rather than by asking a renderer
    for `font-variant: small-caps`: the engine measures whatever the cmap
    resolves to, so the substitution has to be baked into the shipped face for
    the browser, the PDF embedder, and the committed metrics to agree.
    """
    substitutions: dict[str, str] = {}
    for lookup_type, subtable in lookup_subtables(font, "GSUB", "smcp"):
        if lookup_type == 1:
            substitutions.update(subtable.mapping)
    if not substitutions:
        raise SystemExit("The selected caps source has no simple smcp substitutions")

    replacements = 0
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for codepoint, glyph in tuple(table.cmap.items()):
            replacement = substitutions.get(glyph)
            if replacement is not None:
                table.cmap[codepoint] = replacement
                replacements += 1
    if replacements < 26:
        raise SystemExit(f"Small-caps remap replaced only {replacements} cmap entries")


# Synthesised small caps, for families that ship no usable `smcp` lookup.
#
# The construction is a UNIFORM scale of the capitals, which is not an
# approximation of some other design: Latin Modern's own caps face — a genuine
# TeX caps design, and the engine's default family — measures 0.7513 height and
# 0.7522 advance against its capitals, i.e. it IS uniformly scaled capitals.
#
# The ratio is the median real small-cap height of the three bundled families
# (Latin Modern 0.753, Source Sans 0.790, Source Serif 0.845), raised when a
# face's own x-height would otherwise reach past it — small caps have to read as
# taller than lowercase. Arial-metric Arimo needs that: its x-height is 0.768 of
# its cap height (Latin Modern's is 0.631), so the flat ratio alone would put its
# small caps BELOW its own x-height and they would look like broken capitals.
SMALL_CAPS_CAP_RATIO = 0.80
SMALL_CAPS_X_CLEARANCE = 1.06
SMALL_CAPS_MAX_RATIO = 0.88
SYNTHETIC_SMALL_CAP_SUFFIX = ".tssc"


def small_caps_scale(font: TTFont) -> float:
    os2 = font["OS/2"]
    cap_height = int(getattr(os2, "sCapHeight", 0) or 0)
    x_height = int(getattr(os2, "sxHeight", 0) or 0)
    if cap_height <= 0 or x_height <= 0:
        raise SystemExit("Small-caps synthesis needs OS/2 sCapHeight and sxHeight")
    return max(
        SMALL_CAPS_CAP_RATIO,
        min(SMALL_CAPS_MAX_RATIO, x_height * SMALL_CAPS_X_CLEARANCE / cap_height),
    )


def synthesize_small_caps(font: TTFont) -> None:
    """Build a caps face by scaling the capitals into new glyphs.

    Composites (the accented capitals) are decomposed before scaling, because a
    scaled component offset does not compose the same outline. The scaled glyphs
    carry no hinting instructions: the source instructions were written for the
    unscaled outline and would distort it at small sizes.
    """
    if "glyf" not in font:
        raise SystemExit("Small-caps synthesis is implemented for glyf outlines only")
    scale = small_caps_scale(font)
    glyph_set = font.getGlyphSet()
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    transform = Transform().scale(scale)

    # Lowercase codepoint -> the glyph of its uppercase counterpart, taken from
    # the font's own cmap so the repertoire follows the font rather than a list.
    cmap = font.getBestCmap()
    uppercase_of: dict[int, str] = {}
    for codepoint in cmap:
        character = chr(codepoint)
        upper = character.upper()
        if len(upper) != 1 or upper == character:
            continue
        upper_glyph = cmap.get(ord(upper))
        if upper_glyph is not None:
            uppercase_of[codepoint] = upper_glyph
    if len(uppercase_of) < 26:
        raise SystemExit(f"Small-caps synthesis found only {len(uppercase_of)} cased pairs")

    synthesized: dict[str, str] = {}
    for upper_glyph in sorted(set(uppercase_of.values())):
        name = f"{upper_glyph}{SYNTHETIC_SMALL_CAP_SUFFIX}"
        recorder = DecomposingRecordingPen(glyph_set)
        glyph_set[upper_glyph].draw(recorder)
        pen = TTGlyphPen(None)
        recorder.replay(TransformPen(pen, transform))
        glyf[name] = pen.glyph()
        advance, left_side_bearing = hmtx[upper_glyph]
        hmtx[name] = (metric_round(advance * scale), metric_round(left_side_bearing * scale))
        synthesized[upper_glyph] = name

    replacements = 0
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for codepoint in tuple(table.cmap):
            upper_glyph = uppercase_of.get(codepoint)
            if upper_glyph is None:
                continue
            table.cmap[codepoint] = synthesized[upper_glyph]
            replacements += 1
    if replacements < 26:
        raise SystemExit(f"Small-caps synthesis remapped only {replacements} cmap entries")


def build_caps_face(font: TTFont) -> None:
    """Use the font's real small caps when it has them, otherwise synthesise."""
    if feature_lookup_indices(font, "GSUB", "smcp"):
        remap_small_caps(font)
    else:
        synthesize_small_caps(font)


def strip_unmodeled_ligatures(font: TTFont) -> int:
    """Remove standard-`liga` substitutions the browser typesetter does not model.

    Browsers shape document text with every default-on `liga` rule in the font,
    but the engine measures runs with only the LIGATURES advances committed to
    metrics.gen.ts. Any extra rule (Source's `ft`/`fj`, quote/dash ligatures…)
    would paint at a width the engine never reserved, silently diverging the
    editor from the engine and the PDF export. Shipping fonts that carry exactly
    the modeled set makes every shaper — browser, PDF embedder, engine metrics —
    agree by construction.

    A ligature's identity is the base-character string it composes, resolved
    transitively through its components: fonts may stage `ffi` as f+f→ff then
    ff+i→ffi, and ligature output glyphs may sit in the cmap as the precomposed
    U+FB00–FB04 characters, so neither the component spelling nor the cmap char
    alone identifies it. Only the five modeled strings survive. On remapped caps
    faces the f-ligature components are no longer cmap-reachable, so every ligature
    resolves as unknown and is removed — matching both the browser (they can never
    fire) and the metrics (no `lig` entries are extracted for those faces).
    """
    if "GSUB" not in font:
        return 0
    ligature_subtables = [
        subtable
        for lookup_type, subtable in lookup_subtables(font, "GSUB", "liga")
        if lookup_type == 4
    ]
    cmap_char = {glyph: chr(codepoint) for codepoint, glyph in font.getBestCmap().items()}
    components_of: dict[str, list[str]] = {}
    for subtable in ligature_subtables:
        for first, entries in (subtable.ligatures or {}).items():
            for entry in entries:
                components_of.setdefault(entry.LigGlyph, [first] + list(entry.Component))

    resolved: dict[str, Optional[str]] = {}

    def resolve(glyph: str, stack: tuple = ()) -> Optional[str]:
        if glyph in resolved:
            return resolved[glyph]
        if glyph in components_of and glyph not in stack:
            parts = [resolve(component, stack + (glyph,)) for component in components_of[glyph]]
            if all(part is not None for part in parts):
                resolved[glyph] = "".join(parts)  # type: ignore[arg-type]
                return resolved[glyph]
        resolved[glyph] = cmap_char.get(glyph)
        return resolved[glyph]

    removed = 0
    for subtable in ligature_subtables:
        for first in tuple((subtable.ligatures or {})):
            kept = [entry for entry in subtable.ligatures[first] if resolve(entry.LigGlyph) in LIGATURES]
            removed += len(subtable.ligatures[first]) - len(kept)
            if kept:
                subtable.ligatures[first] = kept
            else:
                del subtable.ligatures[first]
    return removed


# Default-on GSUB features (beyond `liga`) whose substitutions the engine does
# not model AT ALL. `ccmp` demonstrably fires on repertoire text in the bundled
# families — Source Sans chain-substitutes Catalan `l·l` with one precomposed
# glyph, and Source Serif swaps `ïï` pairs to a narrow-dieresis variant — each
# changing painted advances the engine never measured. Its remaining purpose,
# combining-mark composition, only applies to text outside the supported
# repertoire, where the metrics make no fidelity promise anyway. calt/clig/rlig
# are absent from the bundled fonts today; stripping them too keeps the invariant
# stable if an upstream font revision ever adds them.
UNMODELED_GSUB_FEATURES = ("ccmp", "calt", "clig", "rlig")


def strip_unmodeled_gsub_features(font: TTFont) -> int:
    """Empty default-on GSUB features the engine has no model for.

    Mirrors strip_unmodeled_kerning: the lookup references are removed from the
    FeatureRecords (not the lookups themselves), so shapers simply never reach
    them and no cross-feature lookup sharing or index renumbering can break.
    Returns the number of lookup references removed.
    """
    if "GSUB" not in font:
        return 0
    table = font["GSUB"].table
    if table.FeatureList is None:
        return 0
    removed = 0
    for record in table.FeatureList.FeatureRecord:
        if record.FeatureTag not in UNMODELED_GSUB_FEATURES:
            continue
        removed += len(record.Feature.LookupListIndex)
        record.Feature.LookupListIndex = []
        record.Feature.LookupCount = 0
    return removed


def strip_unmodeled_kerning(font: TTFont) -> int:
    """Drop `kern`-feature GPOS lookups that are not pure pair positioning.

    extract_metrics flattens exactly the PairPos (type 2) subtables of the
    `kern` feature into the committed character-pair table, so type 2 is the
    entirety of the kerning the engine models. Source Serif also ships a
    chained-context lookup (type 8, Catalan `l·l`: it narrows the middot by
    ~0.3 em) that browsers and the PDF embedder would apply but the engine
    cannot see — text would paint narrower than every measurement, caret
    mapping, and justification computed for it. Dropping the lookup reference
    from the feature leaves the flat pair kerning (which the flattener does
    capture) as the single kerning contract on every surface. Returns the
    number of lookup references removed.
    """
    if "GPOS" not in font:
        return 0
    table = font["GPOS"].table
    if table.FeatureList is None:
        return 0
    lookups = table.LookupList.Lookup

    def is_pure_pairpos(index: int) -> bool:
        lookup = lookups[index]
        for subtable in lookup.SubTable:
            effective = subtable.ExtensionLookupType if lookup.LookupType == 9 else lookup.LookupType
            if effective != 2:
                return False
        return True

    removed = 0
    for record in table.FeatureList.FeatureRecord:
        if record.FeatureTag != "kern":
            continue
        kept = [index for index in record.Feature.LookupListIndex if is_pure_pairpos(index)]
        removed += len(record.Feature.LookupListIndex) - len(kept)
        record.Feature.LookupListIndex = kept
        record.Feature.LookupCount = len(kept)
    return removed


def rename_font(font: TTFont, family: str, subfamily: str) -> None:
    name_table = font["name"]
    name_table.names = [record for record in name_table.names if record.nameID not in {1, 2, 3, 4, 6, 16, 17}]
    full_name = f"{family} {subfamily}" if subfamily != "Regular" else family
    postscript = "".join(character for character in full_name if character.isalnum() or character == "-")
    values = {
        1: family,
        2: subfamily,
        3: f"Typeset Resume:{postscript}:1.0",
        4: full_name,
        6: postscript,
        16: family,
        17: subfamily,
    }
    for name_id, value in values.items():
        name_table.setName(value, name_id, 3, 1, 0x409)
        name_table.setName(value, name_id, 1, 0, 0)


def set_static_style(font: TTFont, weight: int, italic: bool) -> None:
    if "OS/2" in font:
        os2 = font["OS/2"]
        os2.usWeightClass = weight
        os2.fsSelection &= ~((1 << 0) | (1 << 5) | (1 << 6))
        if italic:
            os2.fsSelection |= 1 << 0
        if weight >= 700:
            os2.fsSelection |= 1 << 5
        if not italic and weight == 400:
            os2.fsSelection |= 1 << 6
    font["head"].macStyle &= ~0b11
    if weight >= 700:
        font["head"].macStyle |= 0b1
    if italic:
        font["head"].macStyle |= 0b10


def build_font(job: FontJob, sources: Mapping[str, Path], output: Path) -> None:
    font = TTFont(sources[job.source], recalcTimestamp=False)
    if job.axes:
        font = instantiateVariableFont(font, dict(job.axes), inplace=False, optimize=True, updateFontNames=True)
    if "fvar" in font:
        raise SystemExit(f"Variable axes remain after instancing {job.output}")
    if job.caps:
        build_caps_face(font)
    strip_unmodeled_ligatures(font)
    strip_unmodeled_gsub_features(font)
    strip_unmodeled_kerning(font)
    if job.internal_family:
        rename_font(font, job.internal_family, job.subfamily)
        for table_tag in ("STAT",):
            if table_tag in font:
                del font[table_tag]
    set_static_style(font, job.weight, job.italic)
    font.flavor = "woff2"
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output, reorderTables=True)
    font.close()


def metric_round(value: float) -> int:
    return int(value + 0.5) if value >= 0 else int(value - 0.5)


def scaled(value: float, units_per_em: int) -> int:
    return metric_round(value * 1000 / units_per_em)


def value_x_advance(value_record: object) -> int:
    if value_record is None:
        return 0
    return int(getattr(value_record, "XAdvance", 0) or 0)


def pair_subtable_adjustment(
    subtable: object,
    coverage: Mapping[str, int],
    left: str,
    right: str,
) -> Optional[int]:
    coverage_index = coverage.get(left)
    if coverage_index is None:
        return None
    if subtable.Format == 1:
        pair_set = subtable.PairSet[coverage_index]
        for record in pair_set.PairValueRecord:
            if record.SecondGlyph == right:
                return value_x_advance(record.Value1) + value_x_advance(record.Value2)
        return None
    if subtable.Format == 2:
        class1 = subtable.ClassDef1.classDefs.get(left, 0)
        class2 = subtable.ClassDef2.classDefs.get(right, 0)
        record = subtable.Class1Record[class1].Class2Record[class2]
        return value_x_advance(record.Value1) + value_x_advance(record.Value2)
    return None


def gpos_pair_lookups(font: TTFont) -> Sequence[Sequence[tuple[object, Mapping[str, int]]]]:
    if "GPOS" not in font:
        return ()
    lookup_list = font["GPOS"].table.LookupList.Lookup
    prepared: list[list[tuple[object, Mapping[str, int]]]] = []
    for index in feature_lookup_indices(font, "GPOS", "kern"):
        lookup = lookup_list[index]
        subtables: list[tuple[object, Mapping[str, int]]] = []
        for raw_subtable in lookup.SubTable:
            lookup_type = lookup.LookupType
            subtable = raw_subtable
            if lookup_type == 9:
                lookup_type = raw_subtable.ExtensionLookupType
                subtable = raw_subtable.ExtSubTable
            if lookup_type != 2:
                continue
            glyphs = getattr(getattr(subtable, "Coverage", None), "glyphs", ())
            subtables.append((subtable, {glyph: position for position, glyph in enumerate(glyphs)}))
        if subtables:
            prepared.append(subtables)
    return prepared


def gpos_pair_adjustment(
    lookups: Sequence[Sequence[tuple[object, Mapping[str, int]]]],
    left: str,
    right: str,
) -> Optional[int]:
    total = 0
    matched = False
    for subtables in lookups:
        for subtable, coverage in subtables:
            adjustment = pair_subtable_adjustment(subtable, coverage, left, right)
            if adjustment is not None:
                total += adjustment
                matched = True
                break
    return total if matched else None


def legacy_pair_adjustment(font: TTFont, left: str, right: str) -> int:
    if "kern" not in font:
        return 0
    total = 0
    for table in font["kern"].kernTables:
        total += int(getattr(table, "kernTable", {}).get((left, right), 0))
    return total


def ligature_glyph(font: TTFont, sequence: str, cmap: Mapping[int, str]) -> Optional[str]:
    glyphs = [cmap.get(ord(character)) for character in sequence]
    if any(glyph is None for glyph in glyphs):
        return None
    # Apply liga lookups in font order. Some fonts encode ffi as two staged
    # substitutions (f+f -> ff, then ff+i -> ffi) instead of one three-glyph
    # ligature record, so a direct lookup of the original sequence is incomplete.
    for lookup_type, subtable in lookup_subtables(font, "GSUB", "liga"):
        if lookup_type != 4:
            continue
        index = 0
        while index < len(glyphs):
            matched = False
            for ligature in subtable.ligatures.get(glyphs[index], ()):
                components = list(ligature.Component)
                if glyphs[index + 1 : index + 1 + len(components)] != components:
                    continue
                glyphs[index : index + 1 + len(components)] = [ligature.LigGlyph]
                matched = True
                break
            index += 1 if not matched else 0
    return glyphs[0] if len(glyphs) == 1 else None


def glyph_bbox(glyph_set: object, glyph_name: str, units_per_em: int) -> Optional[list[int]]:
    pen = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    if pen.bounds is None:
        return None
    _, y_min, _, y_max = pen.bounds
    return [scaled(y_min, units_per_em), scaled(y_max, units_per_em)]


def extract_metrics(path: Path) -> dict[str, object]:
    font = TTFont(path, recalcTimestamp=False)
    units_per_em = font["head"].unitsPerEm
    cmap = font.getBestCmap() or {}
    hmtx = font["hmtx"].metrics
    glyph_set = font.getGlyphSet()
    gpos_lookups = gpos_pair_lookups(font)

    adv: dict[str, int] = {}
    bbox: dict[str, list[int]] = {}
    supported: list[tuple[str, str]] = []
    for character in METRIC_CHARACTERS:
        glyph = cmap.get(ord(character))
        if glyph is None:
            continue
        supported.append((character, glyph))
        adv[character] = scaled(hmtx[glyph][0], units_per_em)
        bounds = glyph_bbox(glyph_set, glyph, units_per_em)
        if bounds is not None:
            bbox[character] = bounds

    kern: dict[str, int] = {}
    for left_character, left_glyph in supported:
        for right_character, right_glyph in supported:
            adjustment = gpos_pair_adjustment(gpos_lookups, left_glyph, right_glyph)
            if adjustment is None:
                adjustment = legacy_pair_adjustment(font, left_glyph, right_glyph)
            value = scaled(adjustment, units_per_em)
            if value:
                kern[left_character + right_character] = value

    lig: dict[str, int] = {}
    for sequence in LIGATURES:
        glyph = ligature_glyph(font, sequence, cmap)
        if glyph is not None:
            lig[sequence] = scaled(hmtx[glyph][0], units_per_em)

    os2 = font["OS/2"]
    metrics = {
        "ascent": scaled(font["hhea"].ascent, units_per_em),
        "descent": scaled(font["hhea"].descent, units_per_em),
        "capHeight": scaled(getattr(os2, "sCapHeight", 0), units_per_em),
        "xHeight": scaled(getattr(os2, "sxHeight", 0), units_per_em),
        "adv": adv,
        "kern": kern,
        "lig": lig,
        "bbox": bbox,
    }
    font.close()
    return metrics


def metrics_source(metrics: Mapping[str, Mapping[str, object]]) -> str:
    payload = json.dumps(metrics, ensure_ascii=False, separators=(",", ":"))
    face_union = " | ".join(f'"{face}"' for face in FACE_ORDER)
    family_union = " | ".join(f'"{family}"' for family in FAMILY_ORDER)
    return f"""// GENERATED by scripts/generate_font_assets.py — do not edit by hand.
// Metrics are extracted from the exact static WOFF2 files under fonts/.
// Every value is normalized to 1000 units/em for deterministic browser layout.

export type FaceMetrics = {{
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  adv: Record<string, number>;
  kern: Record<string, number>;
  lig: Record<string, number>;
  bbox: Record<string, [number, number]>;
}};

export type FaceName = {face_union};
export type MetricFamilyId = {family_union};

export const FONT_METRICS: Record<MetricFamilyId, Record<FaceName, FaceMetrics>> = {payload};

// Compatibility export for callers being migrated to the family registry.
export const LM_METRICS = FONT_METRICS["latin-modern"];
"""


def generate(source_dir: Path, output_root: Path, offline: bool) -> Sequence[Path]:
    sources = {key: ensure_source(spec, source_dir, offline) for key, spec in SOURCES.items()}
    generated: list[Path] = []
    metrics: dict[str, dict[str, object]] = {family: {} for family in FAMILY_ORDER}

    for job in FONT_JOBS:
        output = output_root / "fonts" / job.output
        build_font(job, sources, output)
        metrics[job.family][job.face] = extract_metrics(output)
        generated.append(output)

    for family, aliases in FACE_ALIASES.items():
        for face, source_face in aliases.items():
            metrics[family][face] = metrics[family][source_face]

    # Emit faces in FACE_ORDER so the payload does not depend on FONT_JOBS order
    # or on where an alias was filled in.
    for family, faces in metrics.items():
        missing = [face for face in FACE_ORDER if face not in faces]
        if missing:
            raise SystemExit(f"Family {family} is missing faces: {', '.join(missing)}")
        metrics[family] = {face: faces[face] for face in FACE_ORDER}

    for source_key, filename in LICENSE_OUTPUTS.items():
        output = output_root / "fonts" / filename
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(sources[source_key], output)
        generated.append(output)

    metrics_output = output_root / "src" / "typeset" / "metrics.gen.ts"
    metrics_output.parent.mkdir(parents=True, exist_ok=True)
    with metrics_output.open("w", encoding="utf-8", newline="\n") as output:
        output.write(metrics_source(metrics))
    generated.append(metrics_output)
    return generated


def run_check(source_dir: Path, repository_root: Path, offline: bool) -> None:
    with tempfile.TemporaryDirectory(prefix="typeset-fonts-") as temporary:
        temporary_root = Path(temporary)
        generated = generate(source_dir, temporary_root, offline)
        mismatches: list[str] = []
        for temporary_path in generated:
            relative = temporary_path.relative_to(temporary_root)
            committed = repository_root / relative
            if not committed.exists() or committed.read_bytes() != temporary_path.read_bytes():
                mismatches.append(str(relative))
        if mismatches:
            raise SystemExit("Generated font outputs are stale: " + ", ".join(mismatches))
        print(f"Verified {len(generated)} generated files against pinned sources.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("/tmp/typeset-fonts"),
        help="cache for pinned upstream font sources",
    )
    parser.add_argument("--offline", action="store_true", help="never download missing sources")
    parser.add_argument("--check", action="store_true", help="verify committed outputs without replacing them")
    args = parser.parse_args()

    check_toolchain()
    repository_root = Path(__file__).resolve().parent.parent
    if args.check:
        run_check(args.source_dir, repository_root, args.offline)
        return

    generated = generate(args.source_dir, repository_root, args.offline)
    total_bytes = sum(path.stat().st_size for path in generated)
    print(f"Generated {len(generated)} files ({total_bytes:,} bytes).")
    for path in generated:
        print(f"{path.relative_to(repository_root)}  {path.stat().st_size:,}  {sha256(path)}")


if __name__ == "__main__":
    main()
