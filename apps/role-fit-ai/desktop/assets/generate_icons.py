"""Generate RoleFit's deterministic desktop icon assets from owned fonts."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[3]
FONT = WORKSPACE / "packages/engine/fonts/SourceSerif4-BoldDisplay.ttf"
SIZE = 1024


def build_icon() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (238, 242, 239, 255))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 720)
    # Optical centering keeps the serif mark balanced in small taskbar sizes.
    draw.text(
        (SIZE // 2, 548),
        "R",
        font=font,
        fill=(35, 102, 79, 255),
        anchor="mm",
        stroke_width=0,
    )
    return image


icon = build_icon()
icon.save(HERE / "icon-source.png", format="PNG", optimize=True)
icon.save(
    HERE / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
icon.save(HERE / "icon.icns", format="ICNS")
