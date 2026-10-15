# Export the game's NGUI UI atlas sprites (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/ui/atlas/<name>.png
# and atlas.json: { "<sprite name>": { "file", "w", "h", "border": [left, right, top, bottom] } }.
# Source: UIAtlas MonoBehaviours (mSprites: x, y, width, height in pixels from the texture's top-left; border = 9-slice).
import os, re, json
from jload import *

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "ui", "atlas")

def safe(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")

def atlas_texture(af, mat_ref):
    mat = deref(af, mat_ref["m_FileID"], mat_ref["m_PathID"])
    if mat is None: return None
    m = mat.read()
    for k, v in m.m_SavedProperties.m_TexEnvs:
        if k == "_MainTex" and v.m_Texture.path_id:
            t = deref(mat.assets_file, v.m_Texture.file_id, v.m_Texture.path_id)
            return t.read().image if t is not None else None
    return None

def main():
    os.makedirs(OUT, exist_ok=True)
    found = {}
    for o in mbs_of("UIAtlas"):
        _, d = read_mb(o)
        if not d or not d.get("mSprites") or not d.get("material"): continue
        img = atlas_texture(o.assets_file, d["material"])
        if img is None: continue
        img = img.convert("RGBA")
        for s in d["mSprites"]:
            name = s["name"]
            if name in found or s["width"] <= 0 or s["height"] <= 0: continue
            crop = img.crop((s["x"], s["y"], s["x"] + s["width"], s["y"] + s["height"]))
            fn = f"{safe(name)}.png"
            crop.save(os.path.join(OUT, fn))
            found[name] = {"file": f"images/ui/atlas/{fn}", "w": s["width"], "h": s["height"],
                           "border": [s["borderLeft"], s["borderRight"], s["borderTop"], s["borderBottom"]]}
            # UISpriteData padding: transparent margins trimmed from the atlas (the widget draws the sprite inside them)
            pad = [s.get("paddingLeft", 0), s.get("paddingRight", 0), s.get("paddingTop", 0), s.get("paddingBottom", 0)]
            if any(pad):
                found[name]["pad"] = pad
    with open(os.path.join(OUT, "atlas.json"), "w", encoding="utf-8") as fp:
        json.dump(found, fp, indent=1, ensure_ascii=False)
    print(f"ui atlas: {len(found)} sprites -> {OUT}")

if __name__ == "__main__":
    main()
