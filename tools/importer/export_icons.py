# Export enemy icons (local only, FFG content) to <JIME_WORK>/packs/core-ffg/images/enemies/<EnemyModel id>.png
# and images/enemies/enemies.json: { "<id>": "images/enemies/<id>.png" }. Source: EnemyModel.Icon (Resources path).
# Hero icons and portraits (HeroModel.Icon / Portrait) to images/heroes/<id>_icon.png, <id>.png and
# images/heroes/heroes.json: { "<id>": { "name": NameKey, "icon": path, "portrait": path } }.
import os, json
from jload import *
from prefab import CONT, RA

PACK = os.path.join(ROOT, "packs", "core-ffg")
OUT = os.path.join(PACK, "images", "enemies")
SIZE = int(os.environ.get("JIME_ICON_TEX", "256"))

def res_key(path):
    return path.replace("Assets/Resources/", "").rsplit(".", 1)[0].lower()

def load_res(path):
    ref = CONT.get(res_key(path))
    if not ref: return None
    # container PPtrs are relative to globalgamemanagers (where the ResourceManager lives)
    f = file_of(FILES["globalgamemanagers"], ref["m_FileID"]) if ref.get("m_FileID") else FILES["globalgamemanagers"]
    if f is None: return None
    o = f.objects.get(ref["m_PathID"])
    if o is None: return None
    if o.type.name == "Sprite":
        return sprite_image(o.read())
    if o.type.name == "Texture2D":
        return o.read().image
    return None

def main():
    os.makedirs(OUT, exist_ok=True)
    db = json.load(open(os.path.join(ROOT, "export", "db.json"), encoding="utf-8"))
    found, cache = {}, {}
    for eid, m in db["models"]["EnemyModel"].items():
        p = (m.get("Icon") or {}).get("Path")
        if not p: continue
        if p not in cache:
            img = None
            try: img = load_res(p)
            except Exception as e: print("icon failed", p, e)
            cache[p] = img
        img = cache[p]
        if img is None: continue
        img = img.convert("RGBA")
        img.thumbnail((SIZE, SIZE))
        img.save(os.path.join(OUT, f"{eid}.png"))
        found[eid] = f"images/enemies/{eid}.png"
    with open(os.path.join(OUT, "enemies.json"), "w", encoding="utf-8") as fp:
        json.dump(found, fp, indent=1)
    print(f"enemy icons: {len(found)}/{len(db['models']['EnemyModel'])} -> {OUT}")
    heroes(db)

def heroes(db):
    out = os.path.join(PACK, "images", "heroes")
    os.makedirs(out, exist_ok=True)
    found = {}
    for hid, m in db["models"].get("HeroModel", {}).items():
        e = {"name": m.get("NameKey")}
        for field, suffix, size in (("Icon", "_icon", SIZE), ("Portrait", "", 512)):
            p = (m.get(field) or {}).get("Path")
            try: img = load_res(p) if p else None
            except Exception as ex: print("hero image failed", p, ex); img = None
            if img is None: continue
            img = img.convert("RGBA")
            img.thumbnail((size, size))
            img.save(os.path.join(out, f"{hid}{suffix}.png"))
            e["icon" if field == "Icon" else "portrait"] = f"images/heroes/{hid}{suffix}.png"
        found[hid] = e
    with open(os.path.join(out, "heroes.json"), "w", encoding="utf-8") as fp:
        json.dump(found, fp, indent=1, ensure_ascii=False)
    print(f"heroes: {sum(1 for e in found.values() if 'portrait' in e)}/{len(found)} portraits -> {out}")

if __name__ == "__main__":
    main()
