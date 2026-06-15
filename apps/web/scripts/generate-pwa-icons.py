#!/usr/bin/env python3
"""Generate placeholder PWA icons — replace PNGs in public/icons/ when final logo is ready."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"
BG = "#141a24"
ACCENT = "#3b82f6"
TEXT = "#f1f5f9"


def make_icon(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.1875)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)
    cx, cy = size // 2, int(size * 0.38)
    r = int(size * 0.14)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=TEXT)
    pin_h = int(size * 0.42)
    draw.polygon(
        [
            (cx, cy + r),
            (cx - int(size * 0.12), cy + int(size * 0.08)),
            (cx, cy + pin_h),
            (cx + int(size * 0.12), cy + int(size * 0.08)),
        ],
        fill=ACCENT,
    )
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(size * 0.22))
    except OSError:
        font = ImageFont.load_default()
    draw.text((int(size * 0.62), int(size * 0.62)), "w", fill=ACCENT, font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG")


if __name__ == "__main__":
    make_icon(192, ROOT / "icon-192.png")
    make_icon(512, ROOT / "icon-512.png")
    make_icon(180, ROOT / "apple-touch-icon.png")
    make_icon(32, Path(__file__).resolve().parents[1] / "public" / "favicon.png")
    print("Generated placeholder icons in", ROOT)
