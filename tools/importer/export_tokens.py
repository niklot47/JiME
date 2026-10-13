# Export board token art (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/tokens/<TokenTypes id>.png
# and images/tokens/tokens.json: { "<Token3DType id>": "images/tokens/<id>.png" }. Ids: Token3DManager.TokenTypes.
import os, json, math
from PIL import Image, ImageDraw
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "tokens")
# Top face of the "Round" token mesh in UV space: center (0.5, 0.53), radius 0.448 (v from the bottom)
FACE_C, FACE_R = (0.5, 0.53), 0.448
HEXAGON = {31, 32, 33}
# The explore token is square (mesh "Explore"): face = full width, top 86 % of the texture, rounded corners
SQUARE = {1}

def square_face(img):
    w, h = img.size
    side = round(0.86 * h)
    x0 = (w - side) // 2
    out = img.crop((x0, 0, x0 + side, side))
    mask = Image.new("L", out.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=round(side * 0.09), fill=255)
    out.putalpha(mask)
    return out

def face(img, hexagon):
    """Cut the token's top face out of its texture: circle, or flat-top hexagon for Hexagon_* tokens"""
    w, h = img.size
    cx, cy, r = FACE_C[0] * w, (1 - FACE_C[1]) * h, FACE_R * w
    box = (round(cx - r), round(cy - r), round(cx + r), round(cy + r))
    out = img.crop(box)
    mask = Image.new("L", out.size, 0)
    d = ImageDraw.Draw(mask)
    s = out.size[0]
    if hexagon:
        d.polygon([(s / 2 + s / 2 * math.cos(math.radians(60 * k)), s / 2 + s / 2 * math.sin(math.radians(60 * k))) for k in range(6)], fill=255)
    else:
        d.ellipse((0, 0, s - 1, s - 1), fill=255)
    out.putalpha(mask)
    return out
# texture name -> TokenTypes ids that use it
TEXTURES = {
    "Explore-Token": [1], "Search-Token": [2], "Threat-Token": [3],
    "Dwarf-Token": [4], "Elf-Token": [5], "Hobbit-Token": [6], "Human-Token": [7],
    "Darkness-Token": [31], "Difficult Terrain Token": [32], "Fortified Token": [33],
}

def name_of(o):
    try:
        return o.peek_name()
    except Exception:
        return o.read().m_Name

def main():
    os.makedirs(OUT, exist_ok=True)
    found = {}
    f = FILES["resources.assets"]
    for o in f.objects.values():
        if o.type.name != "Texture2D" or name_of(o) not in TEXTURES:
            continue
        img = o.read().image.convert("RGBA")
        for tid in TEXTURES[name_of(o)]:
            (square_face(img) if tid in SQUARE else face(img, tid in HEXAGON)).save(os.path.join(OUT, f"{tid}.png"))
            found[str(tid)] = f"images/tokens/{tid}.png"
    with open(os.path.join(OUT, "tokens.json"), "w", encoding="utf-8") as fp:
        json.dump(dict(sorted(found.items(), key=lambda kv: int(kv[0]))), fp, indent=1)
    print(f"tokens: {len(found)} -> {OUT}")

if __name__ == "__main__":
    main()
