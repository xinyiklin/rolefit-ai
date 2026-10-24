"""Generate RoleFit's brand-mark assets from the ribbon-R vector master.

One set of paths feeds the desktop icons (macOS .icns, Windows .ico on a navy
tile), the extension's PNG toolbar icons and the landing page's touch icon on a
light tile, and the light-tile SVG favicon shared by the browser app and the
landing page. Chrome and Edge do not render SVG manifest icons, so the
extension ships PNGs.
It also refreshes the companion window's inline favicon. Requires the pinned
requirements-icons.txt and the system cairo library, for example:
  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \\
    uv run --no-project --with-requirements requirements-icons.txt python generate_icons.py
"""

import re
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import cairosvg
from PIL import Image


HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
SIZE = 1024

# The master mark on a 128-unit canvas (RoleFit brand kit, October 2026).
GRADIENTS = (
    '<linearGradient id="rf-top" x1="0" y1="0" x2="1" y2="1">'
    '<stop stop-color="#60AAFF"/><stop offset="0.42" stop-color="#367EF7"/>'
    '<stop offset="1" stop-color="#2853E9"/></linearGradient>'
    '<linearGradient id="rf-stem" x1="0" y1="0" x2="0.9" y2="1">'
    '<stop stop-color="#3D9BFF"/><stop offset="1" stop-color="#325BEA"/></linearGradient>'
    '<linearGradient id="rf-leg" x1="0" y1="0" x2="0.9" y2="1">'
    '<stop stop-color="#7475F9"/><stop offset="1" stop-color="#3857DE"/></linearGradient>'
)
MARK = (
    '<path d="M24 23C24 14 31 10 39 10H78C100 10 113 24 113 45C113 62 104 73 86 78L70 60'
    'C83 55 90 51 90 44C90 37 85 33 77 33H48C35 33 27 36 24 39Z" fill="url(#rf-top)"/>'
    '<path d="M45 38C26 46 16 57 16 74V104Q16 111 23 111H39Q49 111 49 101V42Q49 37 45 38Z"'
    ' fill="url(#rf-stem)"/>'
    '<path d="M69 62C66 65 63 67 62 72C61 76 64 80 67 84L85 107Q88 111 95 111H113Q119 111'
    ' 115 105L88 64C82 68 77 68 69 62Z" fill="url(#rf-leg)"/>'
)
LIGHT_TILE = ("#FFFFFF", "#E9F1FF")
DARK_TILE = ("#182744", "#080F20")
# The mark spans this share of its tile, centered, for 16px legibility.
MARK_SHARE = 0.68


def tile_svg(view: float, inset: float, radius: float, tile: tuple[str, str], label: str) -> str:
    side = view - 2 * inset
    scale = side * MARK_SHARE / 128
    offset = inset + side * (1 - MARK_SHARE) / 2

    def number(value: float) -> str:
        return f"{value:.2f}".rstrip("0").rstrip(".")

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {number(view)} {number(view)}"'
        f' role="img" aria-label="{label}">'
        f'<defs>{GRADIENTS}<linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">'
        f'<stop stop-color="{tile[0]}"/><stop offset="1" stop-color="{tile[1]}"/></linearGradient></defs>'
        f'<rect x="{number(inset)}" y="{number(inset)}" width="{number(side)}" height="{number(side)}"'
        f' rx="{number(radius)}" fill="url(#tile)"/>'
        f'<g transform="translate({number(offset)} {number(offset)}) scale({number(scale)})">{MARK}</g>'
        "</svg>\n"
    )


def render(svg: str, size: int = SIZE) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=size, output_height=size)
    return Image.open(BytesIO(png)).convert("RGBA")


# macOS draws icons on its own 824px rounded-square grid inside the 1024 canvas.
mac_icon = render(tile_svg(SIZE, inset=100, radius=185, tile=DARK_TILE, label="RoleFit"))
mac_icon.save(HERE / "icon-source.png", format="PNG", optimize=True)
mac_icon.save(HERE / "icon.icns", format="ICNS")
render(tile_svg(SIZE, inset=16, radius=200, tile=DARK_TILE, label="RoleFit")).save(
    HERE / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# iOS rounds the touch icon itself, so it is a full-bleed light tile.
render(tile_svg(SIZE, inset=0, radius=0, tile=LIGHT_TILE, label="RoleFit")).resize(
    (180, 180), Image.LANCZOS
).save(APP / "landing/public/assets/apple-touch-icon.png", format="PNG", optimize=True)

mark = tile_svg(64, inset=0, radius=14, tile=LIGHT_TILE, label="RoleFit")
for size in (16, 32, 48, 128):
    render(mark, size).save(APP / f"extension/icons/icon{size}.png", format="PNG", optimize=True)
for target in (
    APP / "public/favicon.svg",
    APP / "landing/public/assets/favicon.svg",
):
    target.write_text(mark, encoding="utf-8", newline="\n")

companion = APP / "desktop/companion.html"
icon_link = re.compile(r'(<link\s+rel="icon"\s+href=")data:image/svg\+xml,[^"]*(")')
html, count = icon_link.subn(
    lambda match: f"{match.group(1)}data:image/svg+xml,{quote(mark.strip(), safe='')}{match.group(2)}",
    companion.read_text(encoding="utf-8"),
)
if count != 1:
    raise SystemExit("companion.html must carry exactly one inline SVG favicon link")
companion.write_text(html, encoding="utf-8", newline="\n")
