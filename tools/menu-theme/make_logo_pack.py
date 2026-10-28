"""Build a personal pack that replaces only the menus' logo.

    python tools/menu-theme/make_logo_pack.py [image.png] [--id my-logo] [--name "My logo"]

Without an image it takes the logo of the imported game (data/packs/core-ffg/images/ui/tex/sharedassets0_27.png),
so the menus look like the original. The pack goes to data/packs/<id>/ (gitignored, never committed): it holds
images/ui-skin/logo.png (the image with its transparent border trimmed) and a skin.json with just
{"regions": {"logo": {"src": ...}}}, which the app merges over the bundled theme's skin per region.
Any proportions work: the title screen keeps the image's aspect ratio (a long 4:1 logo is drawn wider, not taller).
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL = ROOT / "data/packs/core-ffg/images/ui/tex/sharedassets0_27.png"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?", type=Path, default=ORIGINAL)
    ap.add_argument("--id", default="my-logo")
    ap.add_argument("--name", default="Логотип / Logo")
    ap.add_argument("--priority", type=int, default=90)
    a = ap.parse_args()
    if not a.image.is_file():
        sys.exit(f"{a.image}: no such image (import the game first, or pass your own PNG)")

    im = Image.open(a.image).convert("RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if box:
        im = im.crop(box)
    # keep the file reasonable: the menu draws it at most ~620 px wide (x2 for HiDPI)
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)

    out = ROOT / "data/packs" / a.id
    skin_dir = out / "images/ui-skin"
    skin_dir.mkdir(parents=True, exist_ok=True)
    im.save(skin_dir / "logo.png", optimize=True)
    (skin_dir / "skin.json").write_text(json.dumps(
        {"regions": {"logo": {"src": "images/ui-skin/logo.png"}}}, indent=1), encoding="utf-8")
    (out / "pack.json").write_text(json.dumps({
        "formatVersion": 1,
        "id": a.id,
        "name": {"ru": a.name, "en": a.name, "it": a.name},
        "description": "Personal menu logo. Local only, do not redistribute if the image is not yours.",
        "version": "0.1.0",
        "priority": a.priority,
        "origin": "user",
        "contents": [{"type": "theme", "path": "images"}],
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out}: logo {im.width}x{im.height} (aspect {im.width / im.height:.2f})")


if __name__ == "__main__":
    main()
