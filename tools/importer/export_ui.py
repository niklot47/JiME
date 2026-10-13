# Export interface art for the "Original" theme (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/ui/
# and ui.json: { role: path }. The app maps the roles to CSS variables (panel frame, leather, map, paper).
import os, json
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "ui")
# role -> (texture name, max size, format)
WANTED = {
    "frame": ("Dialog_CombatInfo", 1024, "PNG"),       # stone dialog with a silver ornamental frame
    "leather": ("Background_Tile_Overlay", 512, "JPEG"),  # dark leather (table / panels)
    "map": ("Background_Map_MiddleEarth", 1600, "JPEG"),  # map of Middle-earth (menu background)
    "paper": ("Paper_04", 512, "JPEG"),
    # threat bar (UIThreatMeter): frame with the value plate, fill colour ramp, liquid texture, flame
    "threatMeter": ("Threat_Meter", 1024, "PNG"),
    "threatGradient": ("ThreatMeterGradient", 64, "PNG"),
    "threatLiquid": ("Threat_Liquid_DESAT", 256, "PNG"),
    "threatFire": ("ThreatFire", 128, "PNG"),
}

def name_of(o):
    try:
        return o.peek_name()
    except Exception:
        return o.read().m_Name

def main():
    os.makedirs(OUT, exist_ok=True)
    by_name = {v[0]: k for k, v in WANTED.items()}
    found = {}
    for f in FILES.values():
        for o in f.objects.values():
            if o.type.name != "Texture2D":
                continue
            role = by_name.get(name_of(o))
            if not role or role in found:
                continue
            _, size, fmt = WANTED[role]
            img = o.read().image
            img.thumbnail((size, size))
            ext = "png" if fmt == "PNG" else "jpg"
            path = os.path.join(OUT, f"{role}.{ext}")
            (img.convert("RGBA") if fmt == "PNG" else img.convert("RGB")).save(path, fmt, **({"quality": 85} if fmt == "JPEG" else {}))
            found[role] = f"images/ui/{role}.{ext}"
        if len(found) == len(WANTED):
            break
    with open(os.path.join(OUT, "ui.json"), "w", encoding="utf-8") as fp:
        json.dump(found, fp, indent=1)
    print(f"ui: {len(found)}/{len(WANTED)} -> {OUT}")

if __name__ == "__main__":
    main()
