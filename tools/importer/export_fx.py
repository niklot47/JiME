# Export board effect textures (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/fx/ and fx.json:
# clouds / smoke for the fog around the explored map, dust for the explore burst, the location highlight (yellow arrows
# turning around where enemies are to be placed, GameViewHighlightManager.PoolLocationHighlights) and its glow.
import os, json
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "fx")
SIZE = int(os.environ.get("JIME_FX_TEX", "256"))
# role -> texture name in the game assets
WANTED = {"cloud": "cloud_type_a", "smoke": "smoketex", "dust": "part_dust", "ember": "ThreatFire",
          "highlight": "ArrowCircle4", "highlightGlow": "TargetReticle_Glow"}

def name_of(o):
    try:
        return o.peek_name()
    except Exception:
        return o.read().m_Name

def main():
    os.makedirs(OUT, exist_ok=True)
    by_name = {v: k for k, v in WANTED.items()}
    found = {}
    for f in FILES.values():
        for o in f.objects.values():
            if o.type.name not in ("Texture2D", "Sprite"):
                continue
            n = name_of(o)
            role = by_name.get(n)
            if not role or role in found:
                continue
            img = (sprite_image(o.read()) if o.type.name == "Sprite" else o.read().image).convert("RGBA")
            img.thumbnail((SIZE, SIZE))
            img.save(os.path.join(OUT, f"{role}.png"))
            found[role] = f"images/fx/{role}.png"
        if len(found) == len(WANTED):
            break
    with open(os.path.join(OUT, "fx.json"), "w", encoding="utf-8") as fp:
        json.dump(found, fp, indent=1)
    print(f"fx: {len(found)}/{len(WANTED)} -> {OUT}")

if __name__ == "__main__":
    main()
