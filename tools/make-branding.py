#!/usr/bin/env python3
"""Ayomide Studio branding generator.

Usage:
    python3 tools/make-branding.py ICON_SOURCE LOGO_SOURCE

- ICON_SOURCE  → app icon (center-cropped square): icons/logo.png (1024 master),
  icon-512.png, icon-192.png, apple-touch-icon.png (180), favicon-64.png,
  icon-maskable-512.png (content at 78% safe zone on edge-sampled background).
- LOGO_SOURCE  → in-app brand logo: icons/brand.png (max 520px long side,
  aspect preserved, PNG).

Re-run this any time you have new artwork, then bump the service worker
VERSION in sw.js so installed apps refresh their cache.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / 'icons'


def center_crop_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def make_icon(src: Path) -> None:
    img = Image.open(src).convert('RGB')
    sq = center_crop_square(img)
    master = sq.resize((1024, 1024), Image.LANCZOS)
    master.save(ICONS / 'logo.png', optimize=True)
    for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'),
                       (180, 'apple-touch-icon.png'), (64, 'favicon-64.png')]:
        master.resize((size, size), Image.LANCZOS).save(ICONS / name, optimize=True)

    # maskable: 78% content on a background sampled from the artwork edges
    big = master.resize((512, 512), Image.LANCZOS)
    inner = big.resize((400, 400), Image.LANCZOS)
    bg_color = big.getpixel((5, 5))
    bg = Image.new('RGB', (512, 512), bg_color)
    bg.paste(inner, (56, 56))
    bg.save(ICONS / 'icon-maskable-512.png', optimize=True)
    print(f'icon  ✓ from {src.name} (edge bg #{bg_color[0]:02x}{bg_color[1]:02x}{bg_color[2]:02x})')


def make_brand(src: Path) -> None:
    img = Image.open(src).convert('RGBA')
    w, h = img.size
    scale = min(1.0, 520 / max(w, h))
    img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    img.save(ICONS / 'brand.png', optimize=True)
    ratio = img.size[0] / img.size[1]
    hint = 'wide — shown next to the app name' if ratio >= 1.4 else 'compact — stacked layout'
    print(f'brand ✓ {img.size[0]}x{img.size[1]} ({hint})')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    ICONS.mkdir(exist_ok=True)
    make_icon(Path(sys.argv[1]))
    make_brand(Path(sys.argv[2]))
    print('\nDone. Remember to bump sw.js VERSION to bust the cache.')
