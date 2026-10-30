"""
Hero portraits from the user's print-and-play scans of the hero sheets (scans/IT/IT/01_TLotR_JiME_Big_cards.pdf: each
hero sheet is one embedded picture, landscape: the portrait on the left, the stats on the right) into a private pack
data/packs/scans-heroes/ (gitignored: FFG art, never committed or shipped).

The pack overrides only the heroes' "portrait" and "icon" in images/heroes/heroes.json, so the app's own menus (hero
cards, rest, starting gear) show the sheets' tall art. Heroes are recognised by the name printed on the sheet.

    python tools/scans/extract_heroes.py [path/to/Big_cards.pdf]
"""
import hashlib
import io
import json
import os
import sys

import pymupdf as fz
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "scans", "IT", "IT", "01_TLotR_JiME_Big_cards.pdf")
OUT = os.path.join(REPO, "data", "packs", "scans-heroes")
# HeroModel ids of the core box's heroes by the name on their sheet
HEROES = {"Aragorn": 1, "Beravor": 2, "Bilbo": 3, "Elena": 4, "Gimli": 5, "Legolas": 6}
# where each sheet lies in oxygen710's PnP file (its names are drawn in the pictures, not text)
PLACES = {(0, 20, 20): 5, (0, 20, 374): 3, (0, 232, 20): 2, (0, 232, 374): 4, (2, 20, 20): 1, (2, 232, 20): 6}
# the portrait's place on a sheet (fractions of the sheet picture): left, top, right, bottom
PORTRAIT = (0.058, 0.17, 0.426, 0.88)
# the face for the round icon: centre x, centre y, size (fractions of the portrait)
ICON = (0.5, 0.36, 0.62)


def main():
    if not os.path.exists(PDF):
        sys.exit(f"{PDF}: no such file")
    d = fz.open(PDF)
    seen = set()
    found = {}
    for page in d:
        # the hero's name: the text of the page drawn over the sheet's picture
        words = page.get_text("words")
        for img in page.get_images(full=True):
            x = d.extract_image(img[0])
            h = hashlib.md5(x["image"]).hexdigest()
            if h in seen or x["width"] < x["height"]:
                continue
            seen.add(h)
            rects = page.get_image_rects(img[0])
            names = {w[4] for r in rects for w in words if fz.Rect(w[:4]).intersects(r)}
            hero = next((HEROES[n] for n in names if n in HEROES), None)
            if hero is None and rects:
                # the names are part of the pictures: the sheets' places in this PDF (page, left, top in points)
                hero = PLACES.get((page.number, round(rects[0].x0), round(rects[0].y0)))
            if hero is not None:
                found[hero] = x["image"]
    os.makedirs(os.path.join(OUT, "images", "heroes"), exist_ok=True)
    art = {}
    for hero, data in sorted(found.items()):
        sheet = Image.open(io.BytesIO(data)).convert("RGB")
        W, H = sheet.size
        l, t, r, b = PORTRAIT
        p = sheet.crop((round(l * W), round(t * H), round(r * W), round(b * H)))
        p.save(os.path.join(OUT, "images", "heroes", f"{hero}.webp"), "WEBP", quality=88)
        cx, cy, s = ICON
        side = round(s * p.width)
        x0, y0 = round(cx * p.width - side / 2), round(cy * p.height - side / 2)
        p.crop((x0, y0, x0 + side, y0 + side)).resize((192, 192), Image.LANCZOS).save(
            os.path.join(OUT, "images", "heroes", f"{hero}_icon.webp"), "WEBP", quality=88)
        art[str(hero)] = {"portrait": f"images/heroes/{hero}.webp", "icon": f"images/heroes/{hero}_icon.webp"}
    with open(os.path.join(OUT, "images", "heroes", "heroes.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(art, f, indent=1)
    manifest = {"formatVersion": 1, "id": "scans-heroes",
                "name": {"ru": "Портреты героев со сканов", "en": "Hero portraits from scans", "it": "Ritratti degli eroi dalle scansioni"},
                "description": "Local only: art from the user's own scans (FFG). Do not redistribute.",
                "version": "0.1.0", "priority": 5, "origin": "user", "contents": [{"type": "theme", "path": "images"}]}
    with open(os.path.join(OUT, "pack.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"{OUT}: heroes {sorted(found)}; missing {sorted(set(HEROES.values()) - set(found))}")


if __name__ == "__main__":
    main()
