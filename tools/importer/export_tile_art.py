# Export tile art for the board view: texture per tile + per-hex mesh (2D vertices in tile space, UVs, triangles).
# Hex order = Tile.Hexes (same as tiles.json geometry), so the app can map each hex to its global cube coords.
# Output (local only, FFG content): <JIME_WORK>/packs/core-ffg/images/tiles/<code>.jpg and scenario/tileart.json
import os, json, re, math
import numpy as np
from jload import *
from prefab import CONT, RA, walk
from proto_extract import world_matrix, comp, mesh_arrays, find_texture
from export_tiles import go_of, mb_on, children

PACK = os.path.join(ROOT, "packs", "core-ffg")
IMG = os.path.join(PACK, "images", "tiles")
os.makedirs(IMG, exist_ok=True)
SIZE = int(os.environ.get("JIME_TILE_TEX", "1024"))

_tex_index = None
def texture(name):
    global _tex_index
    if _tex_index is None:
        _tex_index = {}
        for f in FILES.values():
            for o in f.objects.values():
                if o.type.name == "Texture2D":
                    try: _tex_index.setdefault(o.peek_name() if hasattr(o, "peek_name") else o.read().m_Name, o)
                    except Exception: pass
    return _tex_index.get(name)

def tile_art(f, tile_obj, tm):
    _, t = read_mb(tile_obj)
    tile_go = go_of(tile_obj).read()
    inv = np.linalg.inv(world_matrix(f, comp(f, tile_go, "Transform")))
    hexes = []
    for h in t["Hexes"]:
        _, hd = read_mb(f.objects[h["m_PathID"]])
        hgo = f.objects[hd["m_GameObject"]["m_PathID"]].read()
        uvmap = comp(f, hgo, "MB:HexUVMapping")
        uvs, ud = None, None
        if uvmap is not None:
            _, ud = read_mb(uvmap)
            uvs = [[u["x"], u["y"]] for u in ud.get("UVs") or []]
        # the hex mesh is built at runtime from HexUVMapping.SharedMeshOriginal (+ UVs); fall back to MeshFilter
        ref = (ud or {}).get("SharedMeshOriginal") or {}
        if ref.get("m_PathID"):
            mesh = deref(f, ref["m_FileID"], ref["m_PathID"]).read()
        else:
            mf = comp(f, hgo, "MeshFilter").read()
            mesh = file_of(f, mf.m_Mesh.file_id).objects[mf.m_Mesh.path_id].read()
        V, VT, F = mesh_arrays(mesh)
        if uvs is None or len(uvs) != len(V): uvs = VT.tolist() if VT is not None else [[0, 0]] * len(V)
        W = inv @ world_matrix(f, comp(f, hgo, "Transform"))
        Vw = (W @ np.c_[-V[:, 0], V[:, 1], V[:, 2], np.ones(len(V))].T).T[:, :3]  # OBJ export mirrors X
        center = (W @ np.array([0, 0, 0, 1.0]))[:2]
        hexes.append({"center": np.round(center, 4).tolist(), "verts": np.round(Vw[:, :2], 4).tolist(),
                      "uvs": np.round(np.array(uvs), 5).tolist(), "tris": [list(x) for x in F]})
    return hexes, explore_pos(f, t, inv), space_nodes(f, t, inv), callout_pos(f, t, inv)

def space_nodes(f, t, inv):
    """TileSpace.NodePosition of each space (Tile.Spaces order = tile geometry order): where encounter tokens lie"""
    out = []
    for ref in t.get("Spaces") or []:
        pos = None
        try:
            _, sp = read_mb(f.objects[ref["m_PathID"]])
            np_ref = sp.get("NodePosition") or {}
            if np_ref.get("m_PathID"):
                tr = f.objects[np_ref["m_PathID"]]
                p = inv @ world_matrix(f, tr) @ np.array([0, 0, 0, 1.0])
                pos = np.round(p[:2], 4).tolist()
        except Exception as e:
            print("no node position:", e)
        out.append(pos)
    return out

def explore_pos(f, t, inv):
    """Tile.ExploreNode position in the same tile space as the hexes (where the explore token lies: the printed mark)
    and the mark's turn in that space (degrees), [x, y, angle]"""
    ref = t.get("ExploreNode") or {}
    if not ref.get("m_PathID"): return None
    try:
        node = f.objects[ref["m_PathID"]]
        go = f.objects[read_mb(node)[1]["m_GameObject"]["m_PathID"]].read()
        M = inv @ world_matrix(f, comp(f, go, "Transform"))
        p = M @ np.array([0, 0, 0, 1.0])
        ang = math.degrees(math.atan2(M[1, 0], M[0, 0]))
        return np.round(p[:2], 4).tolist() + [round(ang, 2)]
    except Exception as e:
        print("no explore node position:", e)
        return None

def callout_pos(f, t, inv):
    """Tile.CalloutPosition (where the tile's code is printed: the code callout points there), tile space"""
    ref = t.get("CalloutPosition") or {}
    if not ref.get("m_PathID"): return None
    try:
        p = inv @ world_matrix(f, f.objects[ref["m_PathID"]]) @ np.array([0, 0, 0, 1.0])
        return np.round(p[:2], 4).tolist()
    except Exception as e:
        print("no callout position:", e)
        return None

def save_texture(code, img_path):
    if not img_path: return None
    tex = texture(os.path.splitext(os.path.basename(img_path))[0])
    if tex is None: print("missing texture", img_path); return None
    out = os.path.join(IMG, f"{code}.jpg")
    if not os.path.exists(out):
        img = tex.read().image
        img.thumbnail((SIZE, SIZE))
        img.convert("RGB").save(out, "JPEG", quality=85)
    return f"images/tiles/{code}.jpg"

def models_by_code():
    out = {}
    for o in FILES["sharedassets0.assets"].objects.values():
        if o.type.name == "MonoBehaviour" and script_info(o) and script_info(o)[1] == "FFG.JIME.TileModel":
            _, d = read_mb(o); out[d["_id"]] = d
    return out

if __name__ == "__main__":
    tms = models_by_code()
    l4 = FILES["level4"]
    bucket = None
    for o in l4.objects.values():
        if o.type.name == "MonoBehaviour" and (script_info(o) or (0, ""))[1].endswith("TileBucket"):
            g = go_of(o)
            if g.read().m_Name == "StandardTiles": bucket = g
    art = {"standard": {}, "custom": {}}
    for ch in children(bucket):
        to = mb_on(ch, "FFG.JIME.Tile")
        _, t = read_mb(to)
        code = ch.read().m_Name
        tm = tms.get(code, {})
        hexes, explore, nodes, callout = tile_art(l4, to, tm)
        art["standard"][code] = {"texture": save_texture(code, tm.get("Image", {}).get("Path")), "hexes": hexes, "explore": explore, "nodes": nodes, "callout": callout}
    print("standard", len(art["standard"]))
    db = json.load(open(os.path.join(ROOT, "export", "db.json"), encoding="utf-8"))
    for aid, a in db["models"]["AdventureModel"].items():
        p = (a.get("Prefab") or {}).get("Path", "")
        key = p.replace("Assets/Resources/", "").replace(".prefab", "").lower()
        if not p or key not in CONT: continue
        for depth, name, pid, comps in walk(RA.objects[CONT[key]["m_PathID"]]):
            for co in comps:
                if co.type.name == "MonoBehaviour" and (script_info(co) or (0, ""))[1] == "FFG.JIME.Tile":
                    _, t = read_mb(co)
                    mo = deref(RA, t["Model"]["m_FileID"], t["Model"]["m_PathID"])
                    code = read_mb(mo)[1].get("_id") if mo else name
                    tm = tms.get(code, {})
                    hexes, explore, nodes, callout = tile_art(RA, co, tm)
                    art["custom"].setdefault(aid, {})[str(pid)] = {"code": code, "texture": save_texture(code, tm.get("Image", {}).get("Path")), "hexes": hexes, "explore": explore, "nodes": nodes, "callout": callout}
    print("custom", sum(len(v) for v in art["custom"].values()))
    json.dump(art, open(os.path.join(PACK, "scenario", "tileart.json"), "w"))
    print("->", PACK)
