"""Generate RoleFit's deterministic brand-mark assets from an owned font.

One glyph source feeds the desktop icons (macOS .icns, Windows .ico) and the
SVG mark shared by the browser app's and landing page's favicons and the
extension's toolbar icon.
Requires Pillow and fontTools.
"""

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
WORKSPACE = HERE.parents[3]
FONT = WORKSPACE / "packages/engine/fonts/Inter-Bold.ttf"
SIZE = 1024
SUPERSAMPLE = 4

# The browser app's light --accent and --on-accent (src/styles/tokens.css).
TILE = (0, 100, 220, 255)
LABEL = (253, 253, 255, 255)
TILE_HEX = "#0064dc"
LABEL_HEX = "#fdfdff"

# The letter's cap height as a share of the tile, sized for 16px legibility.
CAP_SHARE = 0.54


def render_tile(margin: int, radius: int) -> Image.Image:
    scale = SIZE * SUPERSAMPLE
    image = Image.new("RGBA", (scale, scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = margin * SUPERSAMPLE
    draw.rounded_rectangle(
        (inset, inset, scale - inset - 1, scale - inset - 1),
        radius=radius * SUPERSAMPLE,
        fill=TILE,
    )
    tile = scale - 2 * inset
    probe = ImageFont.truetype(str(FONT), 1000)
    left, top, right, bottom = probe.getbbox("R", anchor="ls")
    font_size = round(1000 * CAP_SHARE * tile / (bottom - top))
    font = ImageFont.truetype(str(FONT), font_size)
    # getbbox spans the advance horizontally, so measure the drawn ink instead.
    # The probe is twice the canvas so a tall letter drawn at its center never clips.
    probe_layer = Image.new("L", (2 * scale, 2 * scale), 0)
    ImageDraw.Draw(probe_layer).text((scale, scale), "R", font=font, fill=255, anchor="ls")
    left, top, right, bottom = probe_layer.getbbox()
    x = scale + (scale - left - right) / 2
    y = scale + (scale - top - bottom) / 2
    draw.text((x, y), "R", font=font, fill=LABEL, anchor="ls")
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def svg_mark() -> str:
    font = TTFont(FONT)
    glyph_set = font.getGlyphSet()
    glyph = glyph_set[font.getBestCmap()[ord("R")]]
    bounds = BoundsPen(glyph_set)
    glyph.draw(bounds)
    x_min, y_min, x_max, y_max = bounds.bounds
    view = 64
    scale = CAP_SHARE * view / (y_max - y_min)
    dx = (view - (x_max - x_min) * scale) / 2 - x_min * scale
    dy = (view + (y_max - y_min) * scale) / 2 + y_min * scale
    path = SVGPathPen(glyph_set, ntos=lambda value: f"{value:.2f}".rstrip("0").rstrip("."))
    glyph.draw(TransformPen(path, (scale, 0, 0, -scale, dx, dy)))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view} {view}" role="img" aria-label="RoleFit AI">\n'
        f'  <rect width="{view}" height="{view}" rx="14" fill="{TILE_HEX}"/>\n'
        f'  <path fill="{LABEL_HEX}" d="{path.getCommands()}"/>\n'
        "</svg>\n"
    )


# macOS draws icons on its own 824px rounded-square grid inside the 1024 canvas.
mac_icon = render_tile(margin=100, radius=185)
mac_icon.save(HERE / "icon-source.png", format="PNG", optimize=True)
mac_icon.save(HERE / "icon.icns", format="ICNS")
render_tile(margin=16, radius=200).save(
    HERE / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

mark = svg_mark()
for target in (
    APP / "public/favicon.svg",
    APP / "landing/public/assets/favicon.svg",
    APP / "extension/icons/icon.svg",
):
    target.write_text(mark, encoding="utf-8", newline="\n")
