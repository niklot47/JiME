# Export tile geometry for the map generator: hexes (cube coords), spaces, edges (traits) per tile,
# standard tiles in StandardTiles bucket order (= FFG shuffle input order), custom tiles per adventure,
# and JIME_Database product order. Output: <JIME_WORK>/export/tiles.json
import json, os
from jload import *
from prefab import CONT, RA, walk

OUT = os.path.join(ROOT, "export", "tiles.json")


def go_of(o):
    fid, pid = struct.unpack_from("<iq", o.get_raw_data(), 0)
    return deref(o.assets_file, fid, pid)


def mb_on(go_obj, cls):
    """MonoBehaviour of class `cls` on a GameObject (component PPtrs live in the same file)"""
    f = go_obj.assets_file
    for c in go_obj.read().m_Component:
        co = f.objects.get(c.component.path_id)
        if co is not None and co.type.name == "MonoBehaviour":
            si = script_info(co)
            if si and si[1] == cls:
                return co
    return None


def children(go_obj):
    f = go_obj.assets_file
    for c in go_obj.read().m_Component:
        co = f.objects.get(c.component.path_id)
        if co is not None and co.type.name == "Transform":
            return [f.objects[f.objects[x.path_id].read().m_GameObject.path_id] for x in co.read().m_Children]
    return []


def tile_geometry(f, tile_obj, models_by_pid=None):
    _, t = read_mb(tile_obj)
    hex_ids = [h["m_PathID"] for h in t["Hexes"]]
    sp_ids = [s["m_PathID"] for s in t["Spaces"]]
    hexes = []
    for hid in hex_ids:
        _, h = read_mb(f.objects[hid])
        c = h["TileCoords"]
        hexes.append({"x": c["X"], "y": c["Y"], "z": c["Z"], "space": -1})
    spaces = []
    for si, spid in enumerate(sp_ids):
        _, s = read_mb(f.objects[spid])
        hs = [hex_ids.index(x["m_PathID"]) for x in s.get("Hexes", []) if x["m_PathID"] in hex_ids]
        for hi in hs:
            hexes[hi]["space"] = si
        sp = {"traits": s["Traits"], "hexes": hs,
              "connected": [sp_ids.index(c["m_PathID"]) if c["m_PathID"] in sp_ids else -1 for c in s["ConnectedSpaces"]]}
        if s.get("HasDarkness"):
            sp["darkness"] = True  # TileSpace.HasDarkness: fear from darkness while the tile is explored
        spaces.append(sp)
    edges = []
    for eid in [e["m_PathID"] for e in t["Edges"]]:
        _, e = read_mb(f.objects[eid])
        edges.append({"hex": hex_ids.index(e["Hex"]["m_PathID"]) if e["Hex"]["m_PathID"] in hex_ids else -1,
                      "dir": e["Direction"], "traits": e["Traits"], "open": bool(e["IsPassageOpen"])})
    return {"hexes": hexes, "spaces": spaces, "edges": edges}, t


def model_code(f, ref):
    o = deref(f, ref["m_FileID"], ref["m_PathID"])
    if o is None: return None
    _, m = read_mb(o)
    return m.get("m_Name") if m else None


def export_standard():
    l4 = FILES["level4"]
    bucket = None
    for o in l4.objects.values():
        if o.type.name == "MonoBehaviour":
            si = script_info(o)
            if si and si[1].endswith("TileBucket"):
                g = go_of(o)
                if g.read().m_Name == "StandardTiles": bucket = g
    out = []
    for ch in children(bucket):
        to = mb_on(ch, "FFG.JIME.Tile")
        geo, t = tile_geometry(l4, to)
        out.append({"code": model_code(l4, t["Model"]), **geo})
    return out


def export_custom(adv_models):
    res = {}
    for aid, a in adv_models.items():
        p = (a.get("Prefab") or {}).get("Path", "")
        key = p.replace("Assets/Resources/", "").replace(".prefab", "").lower()
        if not p or key not in CONT: continue
        tiles = {}
        for depth, name, pid, comps in walk(RA.objects[CONT[key]["m_PathID"]]):
            for co in comps:
                if co.type.name == "MonoBehaviour" and (script_info(co) or (0, ""))[1] == "FFG.JIME.Tile":
                    geo, t = tile_geometry(RA, co)
                    tiles[str(pid)] = {"code": model_code(RA, t["Model"]) or name, **geo}
        if tiles: res[aid] = tiles
    return res


def export_products():
    for o in FILES["sharedassets0.assets"].objects.values():
        if o.type.name == "MonoBehaviour":
            si = script_info(o)
            if si and si[1].endswith("JIME_Database"):
                _, d = read_mb(o)
                ids = []
                for p in d["Products"]:
                    _, pm = read_mb(FILES["sharedassets0.assets"].objects[p["m_PathID"]])
                    ids.append(pm["Id"] if "Id" in pm else pm.get("_id"))
                return ids


if __name__ == "__main__":
    db = json.load(open(os.path.join(ROOT, "export", "db.json"), encoding="utf-8"))
    std = export_standard()
    print("standard tiles", len(std), [t["code"] for t in std[:6]])
    custom = export_custom(db["models"]["AdventureModel"])
    print("adventures with custom tiles", len(custom), "tiles", sum(len(v) for v in custom.values()))
    products = export_products()
    print("product order", products)
    json.dump({"standard": std, "custom": custom, "products": products}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", OUT)
